"""Build the offline Clinic World viewer from the project files or the simulation kit."""

import ast
import base64
import hashlib
import json
import math
import os
import re
import struct
import tempfile
import zipfile
from collections import Counter
from html import escape
from pathlib import Path


HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent
OUT = PROJECT / "output" / "visualizations"
KIT = PROJECT / "output" / "simulation" / "Smart-RoboWard-simulation-data.zip"
SOURCE = "https://github.com/open-rmf/rmf_demos/tree/main/rmf_demos_maps/maps/clinic"
WALL_SOURCE = "https://github.com/open-rmf/rmf_traffic_editor/blob/main/rmf_building_map_tools/building_map/wall.py"


def mapping_block(text, key, indent):
    match = re.search(r"^" + " " * indent + re.escape(key)
                      + r": *\n(.*?)(?=^ {0," + str(indent) + r"}\S|\Z)", text, re.M | re.S)
    if not match:
        raise ValueError(f"Missing map section {key}")
    return match[1]


def inline_number(text, name):
    return float(re.search(r"\b" + name + r": ([-+.\deE]+)(?=[,}\s]|$)", text)[1])


def read_level(mapping, name):
    """Read the pinned traffic-editor reference-image map's numeric geometry."""
    level = mapping_block(mapping, name, 2)
    vertex_rows = mapping_block(level, "vertices", 4).splitlines()
    points = [tuple(map(float, re.match(r"\s*- \[([^,]+),\s*([^,]+),", row).groups())) for row in vertex_rows]
    floors = []
    for line in mapping_block(level, "floors", 4).splitlines():
        if "texture_name:" in line:
            texture = re.search(r"texture_name: \[1, ([^\]]+)", line)[1]
        elif "vertices:" in line:
            floors.append((texture, ast.literal_eval(line.split("vertices:")[1].strip())))
    def edges(key):
        return [(int(m[1]), int(m[2]), m[3]) for row in mapping_block(level, key, 4).splitlines()
                for m in [re.fullmatch(r"\s*- \[(\d+), (\d+), (\{.*\})\]", row)] if m]
    measurements = edges("measurements")
    scales = [float(re.search(r"distance: \[3, ([^\]]+)", params)[1]) / math.dist(points[i], points[j])
              for i, j, params in measurements]
    models = []
    for row in mapping_block(level, "models", 4).splitlines():
        source_name = re.search(r'model_name: "?([^,"]+)', row)[1].rsplit("/", 1)[-1]
        models.append((source_name, *(inline_number(row, k) for k in ("x", "y", "z", "yaw"))))
    return dict(name=name, elevation=inline_number(level, "elevation"), points=points, vertex_rows=vertex_rows, lanes=edges("lanes"),
                floors=floors, walls=edges("walls"), doors=edges("doors"), models=models,
                scale=sum(scales) / len(scales))


def read_lifts(mapping):
    result = []
    section = mapping_block(mapping, "lifts", 0)
    for name in re.findall(r"^  (\w+):\s*$", section, re.M):
        block = mapping_block(section, name, 2)
        def prop(key):
            return re.search(r"^    " + key + r": ([^\n]+)$", block, re.M)[1]
        result.append((name, *(float(prop(k)) for k in ("x", "y", "yaw", "width", "depth")),
                       prop("plugins") == "true"))
    return result


def cross2(a, b, c):
    return (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0])


def area(points):
    return sum(p[0]*q[1] - p[1]*q[0] for p, q in zip(points, points[1:] + points[:1])) / 2


def triangulate(outline):
    """Ear clipping preserves the concave footprint and its entrance recesses."""
    points = list(outline)
    if area(points) < 0:
        points.reverse()
    left = list(range(len(points)))
    triangles = []
    while len(left) > 3:
        for at, b in enumerate(left):
            a, c = left[at-1], left[(at+1) % len(left)]
            p, q, r = points[a], points[b], points[c]
            turn = cross2(p, q, r)
            if abs(turn) < 1e-9:
                left.pop(at)
                break
            if turn <= 0:
                continue
            if any(cross2(p,q,points[i]) >= -1e-9 and cross2(q,r,points[i]) >= -1e-9
                   and cross2(r,p,points[i]) >= -1e-9 for i in left if i not in (a,b,c)):
                continue
            triangles.append((a,b,c))
            left.pop(at)
            break
        else:
            raise ValueError("Cannot triangulate the floor outline")
    triangles.append(tuple(left))
    covered = sum(cross2(points[a],points[b],points[c])/2 for a,b,c in triangles)
    if not math.isclose(covered, area(points), rel_tol=1e-7, abs_tol=1e-6):
        raise ValueError("Triangulation changed the footprint area")
    return points, triangles


def linear_rgb(hex_value):
    rgb = bytes.fromhex(hex_value.lstrip("#"))
    def linear(byte):
        v = byte / 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055)/1.055)**2.4
    return tuple(round(255*linear(x)) for x in rgb)


class Mesh:
    def __init__(self):
        self.positions, self.normals, self.colors, self.indices = [], [], [], []
        self.lookup = {}

    def face(self, vertices, color):
        p, q, r = vertices[:3]
        a, b = [tuple(v[i]-p[i] for i in range(3)) for v in (q, r)]
        n = (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
        mag = math.hypot(*n)
        if mag < 1e-9:
            return
        normal = tuple(round(v/mag, 6) for v in n)
        rgb = linear_rgb(color)
        face = []
        for v in vertices:
            point = tuple(round(x, 6) for x in v)
            key = (point, normal, rgb)
            if key not in self.lookup:
                self.lookup[key] = len(self.positions)
                self.positions.append(point)
                self.normals.append(normal)
                self.colors.append(rgb)
            face.append(self.lookup[key])
        for i in range(1, len(face)-1):
            self.indices.extend((face[0], face[i], face[i+1]))

    def prism(self, outline, bottom, height, color, top=None):
        points, triangles = triangulate(outline)
        lower = [(x, bottom, z) for x,z in points]
        upper = [(x, bottom+height, z) for x,z in points]
        for a,b,c in triangles:
            self.face([lower[a], lower[b], lower[c]], color)
            self.face([upper[c], upper[b], upper[a]], top or color)
        for i in range(len(points)):
            j = (i+1) % len(points)
            self.face([lower[i],upper[i],upper[j],lower[j]], color)

    def box(self, x, y, z, w, h, d, color, yaw=0, top=None):
        """Center x/z, bottom y; dimensions in meters and heading about +Y."""
        ca, sa = math.cos(yaw), math.sin(yaw)
        corners = [(-w/2,-d/2),(w/2,-d/2),(w/2,d/2),(-w/2,d/2)]
        self.prism([(x+u*ca+v*sa, z-u*sa+v*ca) for u,v in corners], y,h,color,top)

    def rounded(self, x,y,z,w,h,d,r,color,top=None):
        r=min(r,w/2,d/2)
        outline=[]
        for u,v,angle in [(w/2-r,d/2-r,0),(-w/2+r,d/2-r,90),(-w/2+r,-d/2+r,180),(w/2-r,-d/2+r,270)]:
            for i in range(4):
                a=math.radians(angle+30*i)
                outline.append((x+u+r*math.cos(a),z+v+r*math.sin(a)))
        self.prism(outline,y,h,color,top)

    def post(self,x,y,z,r,h,color):
        self.prism([(x+r*math.cos(i*math.tau/12),z+r*math.sin(i*math.tau/12)) for i in range(12)],y,h,color)


METAL="89989d"
STEEL="626f75"
WHITE="eef0e8"
WOOD="bc9875"
TEAL="64a8a4"


def furniture(kind):
    m=Mesh()
    def legs(w,d,top,foot=.055):
        for x in (-w/2,w/2):
            for z in (-d/2,d/2):
                m.box(x,0,z,foot,top,foot,STEEL)
    if kind in ("chair","office_chair","waiting_chair"):
        seat = {"chair":"678e8b","office_chair":"708691","waiting_chair":"8babae"}[kind]
        if kind=="office_chair":
            m.post(0,.06,0,.055,.4,STEEL)
            for theta in (0,math.pi/3,-math.pi/3):
                m.box(0,.045,0,.52,.05,.055,STEEL,theta)
        else:
            legs(.35,.34,.43,.035)
        m.rounded(0,.43,0,.49,.075,.47,.065,seat)
        m.rounded(0,.49,.195,.47,.34,.075,.032,seat)
    elif kind in ("desk","large_table","table","low_table","nurse_desk"):
        w,d,h={"desk":(1.38,.68,.83),"large_table":(1.85,.91,.82),"table":(1.16,.76,.74),
               "low_table":(.9,.52,.44),"nurse_desk":(1.72,.8,.99)}[kind]
        legs(w-.17,d-.15,h-.065)
        m.rounded(0,h-.065,0,w,.065,d,.055,WOOD,"d6bf9b")
        if kind in ("desk","nurse_desk"):
            m.box(w*.29,.08,.02,w*.25,h-.18,d*.78,"c3c8b9")
            m.box(w*.29,h*.63,-d*.375,.13,.026,.03,STEEL)
    elif kind=="monitor":
        m.box(0,0,.03,.24,.025,.16,STEEL)
        m.box(0,.02,.04,.065,.16,.055,STEEL)
        m.box(0,.15,.04,.47,.31,.047,"465a62")
        m.box(0,.174,.012,.435,.26,.01,"6d919e")
        m.box(0,.005,-.19,.33,.022,.11,"65747a")
    elif kind=="bed":
        m.box(0,.12,0,.65,.30,1.50,METAL)
        m.rounded(0,.41,0,.90,.12,2.02,.07,"bac4c3")
        m.rounded(0,.53,0,.84,.14,1.94,.08,"99bbb9","cadbd3")
        m.rounded(0,.67,-.68,.57,.085,.32,.065,WHITE)
        m.rounded(0,.44,.99,.90,.37,.075,.026,"8da9ab")
        m.rounded(0,.45,-.99,.90,.45,.075,.026,"8da9ab")
        for x in (-.45,.45):
            m.box(x,.63,-.15,.035,.12,.67,METAL)
    elif kind in ("cart","mop_cart"):
        legs(.51,.37,.83,.034)
        for h in (.22,.8):
            m.box(0,h,0,.63,.045,.46,METAL)
        m.box(0,.26,0,.44,.29,.35,"83aaa6" if kind=="mop_cart" else "b9c9cb")
    elif kind in ("cabinet","vending"):
        w,h,d=(.9,1.78,.5) if kind=="cabinet" else (.95,1.85,.78)
        m.box(0,0,0,w,h,d,"a5b4b2")
        m.box(0,.12,-d/2-.008,w*.82,h*.86,.022,"cdd4cc" if kind=="cabinet" else "516c78")
        m.box(w*.29,.79,-d/2-.034,.035,.22,.032,STEEL)
    elif kind=="iv":
        m.post(0,.035,0,.19,.055,STEEL); m.post(0,.08,0,.022,1.68,METAL)
        m.box(0,1.72,0,.45,.025,.03,METAL)
        m.box(.15,1.40,0,.10,.22,.055,"c0d8d7")
    elif kind=="bin":
        m.post(0,0,0,.16,.47,"8fa49e"); m.post(0,.47,0,.166,.03,STEEL)
    elif kind=="toilet":
        m.rounded(0,0,0,.43,.40,.62,.14,WHITE)
        m.box(0,.32,.23,.43,.43,.17,WHITE)
    elif kind=="wheelchair":
        m.box(0,.42,0,.43,.075,.44,"648493");m.box(0,.48,.18,.42,.40,.07,"648493")
        for x in (-.27,.27):
            m.box(x,.11,0,.07,.49,.48,STEEL)
            m.box(x,.61,0,.05,.045,.39,METAL)
    else:
        raise ValueError(kind)
    return m


KINDS = {
    "PotatoChipChair":"waiting_chair","OfficeChairGrey":"office_chair","DeskChair":"chair",
    "NurseTable":"desk","MainTable":"large_table","Table":"table","CoffeeTable":"low_table","NurseDesk":"nurse_desk",
    "MonitorAndKeyboard":"monitor","CGMVanguard":"bed","SurgicalTrolleyMed":"cart","MopCart2":"mop_cart",
    "MetalCabinet":"cabinet","VendingMachine":"vending","IVStand":"iv","LitterBin":"bin","Toilet":"toilet",
    "PatientWheelChair":"wheelchair",
}


def build_shell(level, coords):
    m=Mesh()
    for texture,indices in level["floors"]:
        surface="acccd1" if texture=="blue_linoleum" else "bc9d7b"
        m.prism([coords[i] for i in indices],-.17,.17,"a0aeb2",surface)
    for i,j,_ in level["walls"]:
        (ax,az),(bx,bz)=coords[i],coords[j]
        span=math.hypot(bx-ax,bz-az)
        if span<1e-6:continue
        yaw=-math.atan2(bz-az,bx-ax)
        cx,cz=(ax+bx)/2,(az+bz)/2
        # These are the upstream building-map generator's metric wall defaults.
        m.box(cx,0,cz,span,2.5,.10,"e3e5d9",yaw,"99aaa3")
        m.box(cx,0,cz,span,.115,.112,"8caaa4",yaw)
    for i,j,props in level["doors"]:
        (ax,az),(bx,bz)=coords[i],coords[j]
        span=math.hypot(bx-ax,bz-az)
        if span<.12:continue
        cx,cz=(ax+bx)/2,(az+bz)/2
        yaw=-math.atan2(bz-az,bx-ax)
        model_type=re.search(r"\btype: \[1, ([^\]]+)",props)[1]
        for x,z in ((ax,az),(bx,bz)):
            m.box(x,0,z,.055,2.12,.12,"839493",yaw)
        m.box(cx,2.04,cz,span,.09,.13,"839493",yaw)
        tone="91b3b3" if "sliding" in model_type else "c3a886"
        m.box(cx,.015,cz,span-.07,2.025,.05,tone,yaw)
        if "double" in model_type:
            m.box(cx,.015,cz,.025,2.015,.061,"6c8181",yaw)
        m.box(cx,1.28,cz,(span-.07)*.44,.42,.061,"b4d3d3",yaw)
    return m


def lift_landing(w,d,active):
    m=Mesh()
    metal="688a88" if active else "8e9997"
    m.box(0,.005,0,w,.045,d,"adbfbd")
    m.box(0,.05,d/2,w,2.22,.07,metal)
    for x in (-w/2,w/2):
        m.box(x,.05,0,.07,2.22,d,metal)
    m.box(0,2.12,-d/2,w,.15,.09,metal)
    for sign in (-1,1):
        m.box(sign*(w/4+.35),.05,-d/2,w/2-.7,2.07,.075,"93aaa8")
    return m


class Gltf:
    def __init__(self):
        self.bin=bytearray()
        self.doc={"asset":{"version":"2.0","generator":"Smart RoboWard Clinic World cutaway",
                           "extras":{"source":SOURCE,"wallDefaults":WALL_SOURCE,"units":"meters",
                                     "furnishings":"Simplified fixtures at the source map poses."}},
                  "scene":0,"scenes":[{"name":"Clinic World","nodes":[]}],"nodes":[],"meshes":[],
                  "materials":[{"name":"Clinic architectural materials","pbrMetallicRoughness":
                                {"baseColorFactor":[1,1,1,1],"metallicFactor":0,"roughnessFactor":.87}}],
                  "accessors":[],"bufferViews":[],"buffers":[]}

    def accessor(self, rows, code, gl_type, shape, target, bounds=False, normalized=False):
        # The four-byte color stride also permits GPU uploads without re-packing RGB.
        while len(self.bin)%4:self.bin.append(0)
        offset=len(self.bin)
        width=len(rows[0])
        record=struct.Struct("<"+code*width)
        for row in rows:self.bin.extend(record.pack(*row))
        view=len(self.doc["bufferViews"])
        self.doc["bufferViews"].append({"buffer":0,"byteOffset":offset,"byteLength":len(self.bin)-offset,"target":target})
        a={"bufferView":view,"componentType":gl_type,"count":len(rows),"type":shape}
        if bounds:
            a.update(min=[min(c) for c in zip(*rows)],max=[max(c) for c in zip(*rows)])
        if normalized:a["normalized"]=True
        self.doc["accessors"].append(a)
        return len(self.doc["accessors"])-1

    def add_mesh(self,name,m):
        attrs={"POSITION":self.accessor(m.positions,"f",5126,"VEC3",34962,True),
               "NORMAL":self.accessor(m.normals,"f",5126,"VEC3",34962),
               "COLOR_0":self.accessor([(*rgb,255) for rgb in m.colors],"B",5121,"VEC4",34962,normalized=True)}
        code,ctype=("H",5123) if len(m.positions)<65536 else ("I",5125)
        indices=self.accessor([(i,) for i in m.indices],code,ctype,"SCALAR",34963)
        self.doc["meshes"].append({"name":name,"primitives":[{"attributes":attrs,"indices":indices,"material":0}]})
        return len(self.doc["meshes"])-1

    def node(self,**values):
        self.doc["nodes"].append(values)
        return len(self.doc["nodes"])-1

    def export(self):
        self.bin.extend(b"\0"*((-len(self.bin))%4))
        self.doc["buffers"]=[{"byteLength":len(self.bin)}]
        meta=json.dumps(self.doc,separators=(",",":"),ensure_ascii=True).encode()
        meta+=b" "*((-len(meta))%4)
        return (struct.pack("<4sII",b"glTF",2,28+len(meta)+len(self.bin))
                +struct.pack("<I4s",len(meta),b"JSON")+meta
                +struct.pack("<I4s",len(self.bin),b"BIN\0")+self.bin)


def map_origin(levels):
    verts=[levels[0]["points"][i] for _,poly in levels[0]["floors"] for i in poly]
    return [(min(axis)+max(axis))/2 for axis in zip(*verts)]


def fleet_network(levels, fixture):
    """Directed lanes and the shared lift in the same metric frame as the GLB."""
    ox, oz = map_origin(levels)
    nodes, edges, names, cabins = {}, set(), {}, []
    lift = fixture["demo_world"]["shared_lift_id"]
    for level in levels:
        floor = level["name"]
        used = set()
        for a, b, attrs in level["lanes"]:
            if "graph_idx: [2, 0]" not in attrs:
                continue
            akey, bkey = f"{floor}/{a}", f"{floor}/{b}"
            edges.add((akey, bkey))
            if "bidirectional: [4, true]" in attrs:
                edges.add((bkey, akey))
            used.update((a, b))
        for i in sorted(used):
            key, row = f"{floor}/{i}", level["vertex_rows"][i]
            x, z = level["points"][i]
            nodes[key] = {"x": round((x-ox)*level["scale"], 5), "y": level["elevation"],
                          "z": round((z-oz)*level["scale"], 5), "floor": floor}
            name = re.match(r'\s*- \[[^,]+,[^,]+,[^,]+,\s*([^,\]]+)', row)[1].strip('"')
            if name:
                names[name] = key
            if f"lift_cabin: [1, {lift}]" in row:
                cabins.append(key)
    if len(cabins) != 2:
        raise ValueError("Expected one shared-lift landing per floor")
    edges.update((tuple(cabins), tuple(reversed(cabins))))
    aliases = fixture["demo_world"]["station_aliases"]
    stations = {key: {"name": label, "node": names[aliases[key]["waypoint"]]}
                for key, label in [("PHARMACY", "Pharmacy"), ("WARD-A", "Ward A"), ("WARD-B", "Ward B")]}
    for key, label, waypoint in [("COLLECTION", "Specimen desk", "L1_left_nurse_center"),
                                 ("STORES", "Supply store", "L1_right_treatment"),
                                 ("LAB", "Lab intake", "L2_north_counter")]:
        stations[key] = {"name": label, "node": names[waypoint]}
    return {"nodes": nodes, "edges": sorted(edges), "cabins": cabins, "stations": stations,
            "courierSize": [x/1000 for x in fixture["published_reference"]["dimensions_as_reported_mm"]]}


def create_model(levels, lifts, license_text):
    ox,oz=map_origin(levels)
    gltf=Gltf()
    gltf.doc["asset"]["extras"]["sourceLicense"]={"id":"Apache-2.0","text":license_text}
    prototypes={}
    for level in levels:
        scale=level["scale"]
        def xy(x,y):
            return ((x-ox)*scale,(y-oz)*scale)
        coords=[xy(x,y) for x,y in level["points"]]
        name=level["name"]
        shell=build_shell(level,coords)
        floor_mesh=gltf.add_mesh(name+" architecture",shell)
        children=[gltf.node(name=name+" floor, walls and doors",mesh=floor_mesh)]
        def place(label,mesh,x,y,z,yaw):
            px,pz=xy(x,y)
            children.append(gltf.node(name=label,mesh=mesh,translation=[round(px,6),z,round(pz,6)],
                                      rotation=[0,round(math.sin(yaw/2),9),0,round(math.cos(yaw/2),9)]))
        counts=Counter()
        for model,x,y,z,yaw in level["models"]:
            kind=KINDS.get(model)
            if not kind:continue
            if kind not in prototypes:prototypes[kind]=gltf.add_mesh(kind,furniture(kind))
            counts[model]+=1
            place(f"{model} {counts[model]}",prototypes[kind],x,y,z,yaw)
        for lift,x,y,yaw,w,d,active in lifts:
            key=(w,d,active)
            if key not in prototypes:prototypes[key]=gltf.add_mesh("Lift landing",lift_landing(w,d,active))
            place(lift,prototypes[key],x,y,0,yaw)
        idx=gltf.node(name=name,children=children,translation=[0,level["elevation"],0],
                      extras={"sourceLevel":name,"wallSegments":len(level["walls"]),"doorways":len(level["doors"]),
                              "floorPolygons":len(level["floors"]),"fixtures":sum(counts.values()),"metersPerPixel":scale})
        gltf.doc["scenes"][0]["nodes"].append(idx)
    return gltf.export()


def atomic_write(path,data):
    with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as temp:
        staging=Path(temp.name)
    try:
        staging.write_bytes(data)
        os.replace(staging,path)
    finally:
        staging.unlink(missing_ok=True)


def vendor_scripts():
    vendor=HERE/"vendor"
    three=(vendor/"three.min.js").read_text(encoding="utf-8")
    controls=(vendor/"OrbitControls.js").read_text(encoding="utf-8")
    controls,n=re.subn(r"import \{(.*?)\} from 'three';",r"const {\1} = THREE;",controls,flags=re.S)
    if n!=1 or "export { OrbitControls };" not in controls:raise ValueError("Unexpected OrbitControls module")
    controls=controls.replace("export { OrbitControls };","THREE.OrbitControls = OrbitControls;")
    notice=(vendor/"THREE-LICENSE.txt").read_text(encoding="utf-8")
    return [f"/* Three.js r160 and OrbitControls, MIT.\n{notice}\n*/\n"+three,"(() => {\n"+controls+"\n})();"]


MODEL_GUIDE = """## View Clinic World

Open `Clinic-World.html` in a WebGL-capable browser. The fleet console runs offline from this file. Select a robot in the roster or on the model. Choose a destination, select **Dispatch**, then **Follow robot**. Drag to orbit, right-drag to pan, and scroll or pinch to zoom. Switch floors or use **Full screen** to expand the map. With the canvas focused, use the arrow keys to rotate, +/− to zoom and Home to return to the floor overview.

RX-01 carries pharmacy deliveries, LAB-02 carries specimens and SUP-03 carries supplies. LAB-02 starts on a trip to lab intake. The robots travel on directed lanes from Open-RMF graph 0 and reserve shared space and Lift 1. A stopped robot keeps its occupied space. Use **Pause mission** and **Resume mission** to control travel. On arrival, **Confirm ward receipt** closes the delivery. The speed selector changes simulated time. Robot speeds, deliveries and sensor observations are fictional.

In **Security monitor**, select a robot and run an example. Unexpected spin compares measured rotation with the commanded turn. Heartbeat loss measures silence against the simulated one-second reporting interval. Wrong lift floor compares a request with the assigned mission. An alert records the expected and observed values and holds the affected robot. Select **Isolate robot**, then **End example**. After a fresh heartbeat and stable motion, select **Restore access** and, for an active mission, **Resume mission**. The communication log keeps the alert evidence after recovery. These examples model signals that can also occur during equipment faults.

The browser console and its worker exchange commands, acknowledgements and snapshots locally. The ZIP includes the readable controller in `fleet/fleet.js` and its map in `fleet/network.json`. Coordinates and distances are in meters. The devices and lift replies are simulated in the browser. Run `node --test fleet/fleet.test.cjs` with Node.js 20 or newer to check traffic, receipts, alerts and recovery against the same map.

`Clinic-World.glb` contains the reusable glTF 2.0 architecture. It uses the clinic floor footprints, wall and door endpoints, lift landings, map scale and floor elevations (0 m and 10 m). Wall dimensions use the Open-RMF generator defaults. Simplified furniture occupies the mapped positions and headings. The viewer adds the moving robot models at runtime. [Open-RMF clinic map](https://github.com/open-rmf/rmf_demos/tree/main/rmf_demos_maps/maps/clinic) · [Wall generator](https://github.com/open-rmf/rmf_traffic_editor/blob/main/rmf_building_map_tools/building_map/wall.py)

The **Open-RMF demo** tab plays the upstream recordings over the internet. **Case replay** runs A01 or U02 offline on both floor plans. In U02 the robot stays outside the lift and the ward confirms the porter's delivery. Travel between the recorded events is illustrated.

The browser renderer includes Three.js r160 and OrbitControls under the MIT license. The notice is embedded in the viewer and provided in `licenses/three-MIT.txt`. The clinic map uses the Apache-2.0 license in `open-rmf/LICENSE`.

"""


def update_kit(viewer, model, network):
    with zipfile.ZipFile(KIT) as archive:
        contents = {name: archive.read(name) for name in archive.namelist()}
    guide = contents["README.md"].decode("utf-8")
    guide, count = re.subn(r"^## View Clinic World\n.*?(?=^## |\Z)", lambda _: MODEL_GUIDE, guide,
                           count=1, flags=re.M | re.S)
    if count != 1:
        raise ValueError("Cannot find the clinic viewer section in the kit README")
    guide = guide.replace("## Add robot movement", "## Run the native Open-RMF demo")
    contents.update({"Clinic-World.html": viewer, "Clinic-World.glb": model, "README.md": guide.encode("utf-8"),
                     "fleet/fleet.js": (HERE / "fleet.js").read_bytes(),
                     "fleet/fleet.test.cjs": (HERE / "fleet.test.cjs").read_bytes(),
                     "fleet/network.json": json.dumps(network, indent=2).encode("utf-8"),
                     "licenses/three-MIT.txt": (HERE / "vendor" / "THREE-LICENSE.txt").read_bytes()})
    with tempfile.NamedTemporaryFile(dir=KIT.parent, delete=False, suffix=".zip") as handle:
        staging = Path(handle.name)
    try:
        with zipfile.ZipFile(staging, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for name, raw in contents.items():
                archive.writestr(name, raw)
        with zipfile.ZipFile(staging) as archive:
            if archive.testzip() or any(archive.read(name) != raw for name, raw in contents.items()):
                raise ValueError("The packaged viewer failed verification")
        os.replace(staging, KIT)
    finally:
        staging.unlink(missing_ok=True)


def main():
    simulation = PROJECT / "simulation"
    team_layout = (simulation / "open-rmf").is_dir()
    if not team_layout:
        simulation = KIT.parent
    map_dir = simulation / "open-rmf"
    unpacked = map_dir.is_dir()
    if unpacked:
        mapping = (map_dir / "clinic.building.yaml").read_bytes()
        drawing = (map_dir / "clinic.png").read_bytes()
        license_text = (map_dir / "LICENSE").read_bytes().decode("utf-8")
        fixture = json.loads((simulation / "smart-roboward-scenarios.json").read_bytes())
    else:
        with zipfile.ZipFile(KIT) as kit:
            mapping = kit.read("open-rmf/clinic.building.yaml")
            drawing = kit.read("open-rmf/clinic.png")
            license_text = kit.read("open-rmf/LICENSE").decode("utf-8")
            fixture = json.loads(kit.read("smart-roboward-scenarios.json"))
    blob=hashlib.sha1(b"blob "+str(len(mapping)).encode()+b"\0"+mapping).hexdigest()
    if blob!=fixture["sources"]["open_rmf"]["map_git_blob_sha1"]:
        raise ValueError("Unexpected source map revision")
    source = mapping.decode()
    levels = [read_level(source, name) for name in ("L1", "L2")]
    model=create_model(levels,read_lifts(source),license_text)
    network=fleet_network(levels,fixture)
    output = PROJECT / "demo" if team_layout else OUT
    output.mkdir(parents=True, exist_ok=True)
    destination = output / "Clinic-World.html"
    html = (HERE / "clinic-template.html").read_text(encoding="utf-8")
    for marker, content in {
        "<!-- fleet-panel -->": (HERE / "fleet-panel.html").read_text(encoding="utf-8"),
        "{{MAP_PNG_BASE64}}": base64.b64encode(drawing).decode("ascii"),
        "{{MAP_LICENSE}}": escape(license_text),
    }.items():
        if html.count(marker) != 1:
            raise ValueError(f"Expected one {marker} in the clinic page template")
        html = html.replace(marker, content)
    start="<!-- clinic-3d-assets:start -->"
    end="<!-- clinic-3d-assets:end -->"
    if html.count(start)!=1 or html.count(end)!=1:raise ValueError("Missing viewer embed slots")
    scripts=vendor_scripts()+[(HERE/name).read_text(encoding="utf-8") for name in ("fleet-scene.js","viewer.js","fleet-ui.js")]
    tags=[f'<script id="clinic-glb" type="application/octet-stream">{base64.b64encode(model).decode()}</script>']
    tags.append('<script id="fleet-network" type="application/json">'+json.dumps(network,separators=(",",":"))+'</script>')
    worker=(HERE/"fleet.js").read_text(encoding="utf-8")
    tags.append('<script id="fleet-worker-source" type="text/plain">\n'+worker+'\n</script>')
    tags.append('<style>\n'+(HERE/"fleet.css").read_text(encoding="utf-8")+'\n</style>')
    for script in scripts:
        tags.append("<script>\n"+re.sub(r"</script",r"<\\/script",script,flags=re.I)+"\n</script>")
    html=html[:html.index(start)+len(start)]+"\n"+"\n".join(tags)+"\n"+html[html.index(end):]
    atomic_write(output/"Clinic-World.glb",model)
    viewer = html.encode("utf-8")
    atomic_write(destination, viewer)
    if unpacked:
        atomic_write(HERE / "network.json", json.dumps(network, indent=2).encode("utf-8"))
    if not team_layout and KIT.is_file():
        update_kit(viewer, model, network)
    print(f"Wrote {destination.name} and {len(model):,} bytes of glTF 2.0 geometry.")


if __name__=="__main__":
    main()
