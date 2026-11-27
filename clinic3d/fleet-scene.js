// Dynamic actors are separate from the reusable architectural GLB.
(() => {
  "use strict";
  const T = THREE;
  const mat = (color,metalness=.06) => new T.MeshStandardMaterial({color,metalness,roughness:.62});
  function robotModel(profile, size) {
    const body = new T.Group();
    const ivory=mat(0xe8eee9), graphite=mat(0x293633), accent=mat(profile.color), rubber=mat(0x202b2b), metal=mat(0xabb8b8,.45);
    const screen=mat(0x223f49), boxMat=mat(0xc5a177), light=mat(0x91eac4);
    let [length,width,height]=size;
    if(profile.shape==="pod") {length=.76;width=.58;height=.83;}
    if(profile.shape==="shelves") {length=.98;width=.68;height=1.18;}
    function part(geom,material,x,y,z) {
      const m=new T.Mesh(geom,material);m.position.set(x,y,z);body.add(m);return m;
    }
    function box(w,h,d,x,y,z,material) {return part(new T.BoxGeometry(w,h,d),material,x,y,z);}
    function shell(w,h,d,y,material,r=.065) {
      const s=new T.Shape(),a=-w/2,b=-d/2;
      r=Math.min(r,w/3,d/3);s.moveTo(a+r,b);s.lineTo(-a-r,b);s.quadraticCurveTo(-a,b,-a,b+r);
      s.lineTo(-a,-b-r);s.quadraticCurveTo(-a,-b,-a-r,-b);s.lineTo(a+r,-b);s.quadraticCurveTo(a,-b,a,-b-r);
      s.lineTo(a,b+r);s.quadraticCurveTo(a,b,a+r,b);s.closePath();
      const m=part(new T.ExtrudeGeometry(s,{depth:h,bevelEnabled:true,bevelThickness:.008,bevelSize:.008,
        bevelSegments:1,curveSegments:3}),material,0,y,0);
      m.rotation.x=-Math.PI/2;return m;
    }
    function puck(r,h,x,y,z,material) {return part(new T.CylinderGeometry(r,r,h,16),material,x,y,z);}
    for(const x of [-1,1]) for(const z of [-1,1]){
      const wheel=puck(.088,.053,x*(width/2-.018),.095,z*length*.28,rubber);wheel.rotation.z=Math.PI/2;
      const hub=puck(.039,.008,x*(width/2+.013),.095,z*length*.28,metal);hub.rotation.z=Math.PI/2;
    }
    shell(width,.17,length,.12,graphite);shell(width*.99,.052,length*.99,.27,accent);
    const front=length/2;
    box(width*.46,.029,.018,0,.23,front+.008,screen);
    for (const x of [-1,1]) box(.055,.016,.012,x*width*.33,.26,front+.008,light);
    if(profile.shape==="cabinet"){
      shell(width*.89,height-.51,length*.83,.33,ivory);
      box(width*.75,.019,.014,0,height*.50,front*.84,metal);
      box(width*.56,.14,.023,0,height*.77,front*.85,screen);
      box(width*.32,.013,.009,0,height*.78,front*.89,light);
      shell(width*.91,.06,length*.85,height-.17,accent);
      puck(.095,.087,0,height-.058,-.13,graphite);
    }else if(profile.shape==="pod"){
      shell(width*.93,.26,length*.88,.33,ivory,.10);
      shell(width*.86,.11,length*.77,.59,accent,.11);
      box(width*.59,.023,.06,0,.72,-.02,graphite);
      puck(.076,.075,0,.755,-.19,metal);
    }else{
      for(const x of [-1,1])for(const z of [-1,1])box(.036,.77,.036,x*width*.42,.72,z*length*.405,metal);
      for(const y of [.37,.72,1.08])shell(width*.91,.034,length*.88,y,accent,.035);
      box(.24,.22,.34,-.12,.52,-.09,boxMat);box(.20,.19,.31,.13,.505,.12,ivory);
      box(.35,.22,.32,.02,.865,.03,boxMat);
    }
    return body;
  }

  function thumbnails(units) {
    let iconRenderer;
    try {
      iconRenderer=new T.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});
      iconRenderer.setSize(132,100,false);iconRenderer.setClearColor(0xffffff,0);
      const scene=new T.Scene(), camera=new T.PerspectiveCamera(32,1.32,.03,20);
      const light=new T.DirectionalLight(0xffffff,2.5);light.position.set(3,5,4);
      scene.add(new T.HemisphereLight(0xffffff,0xbbbca8,1.7),light);
      for(const unit of units.values()){
        const clone=unit.body.clone(),bounds=new T.Box3().setFromObject(clone);
        const center=bounds.getCenter(new T.Vector3()),h=bounds.getSize(new T.Vector3()).y;
        camera.position.copy(center).addScaledVector(new T.Vector3(.98,.54,1.25).normalize(),Math.max(2.15,h*2.35));
        camera.lookAt(center);scene.add(clone);iconRenderer.render(scene,camera);
        unit.thumbnail=iconRenderer.domElement.toDataURL("image/png");scene.remove(clone);
      }
    }catch {/* The roster also has a text identifier for every robot. */}
    finally{if(iconRenderer){iconRenderer.dispose();iconRenderer.forceContextLoss();}}
  }

  window.makeFleetScene = function({scene,camera,controls,canvas,frame,network,schedule,setFloor,onFocus}) {
    const layer=new T.Group();scene.add(layer);
    const pins=document.getElementById("robot-markers"), floor=document.getElementById("model-floor");
    const followButton=document.getElementById("fleet-follow"), units=new Map();
    const v=new T.Vector3(), delta=new T.Vector3();
    const ray=new T.Raycaster(), pointer=new T.Vector2();
    const goalPin=document.createElement("span");
    goalPin.className="goal-pin";goalPin.hidden=true;pins.append(goalPin);
    let down=null;
    let chosen="RX-01",follow=false,tracked=null,last=null,needSnap=true;
    const floorVisible = k => floor.value==="both" || floor.value===k;
    function add(r) {
      const root=new T.Group(),body=robotModel(r,network.courierSize);
      root.userData.robot=r.id;
      const shadow=new T.Mesh(new T.CircleGeometry(.5,28),new T.MeshBasicMaterial({
        color:0x30443c,transparent:true,opacity:.22,depthWrite:false}));
      shadow.rotation.x=-Math.PI/2;shadow.scale.set(.70,1.0,1);shadow.position.y=.012;
      root.add(shadow,body);layer.add(root);
      const ring=new T.Mesh(new T.RingGeometry(.68,.755,44),
        new T.MeshBasicMaterial({color:r.color,side:T.DoubleSide,transparent:true,opacity:.9,depthWrite:false}));
      ring.rotation.x=-Math.PI/2;ring.position.y=.035;root.add(ring);
      const pin=document.createElement("button");pin.type="button";pin.className="unit-pin";pin.textContent=r.id;
      pin.dataset.robot=r.id;pin.style.setProperty("--unit",r.color);pin.setAttribute("aria-label","Select "+r.id);
      pin.addEventListener("click",()=>window.dispatchEvent(new CustomEvent("clinicfleet:pick",{detail:r.id})));pins.appendChild(pin);
      const start=new T.Vector3(r.pose.x,r.pose.y,r.pose.z);root.position.copy(start);root.rotation.y=r.pose.yaw;
      const unit={root,body,ring,pin,from:start.clone(),to:start.clone(),startYaw:r.pose.yaw,
        yaw:r.pose.yaw,updated:performance.now(),key:"",route:null,r,height:r.shape==="cabinet"?1.5:1.2};
      units.set(r.id,unit);
    }
    function pathMesh(unit) {
      const r=unit.r, key=[r.at,r.path.join("|"),floor.value,chosen,r.state].join(":");
      if(key===unit.key)return;unit.key=key;
      if(unit.route){layer.remove(unit.route);unit.route.geometry.dispose();unit.route.material.dispose();unit.route=null;}
      if(!r.mission || !r.path.length || r.isolated || r.alert || r.paused)return;
      const points=[r.at,...r.path].map(n=>network.nodes[n]), vertices=[];
      for(let i=1;i<points.length;i++){
        const a=points[i-1],b=points[i];if(a.floor!==b.floor||!floorVisible(a.floor))continue;
        const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);if(len<.001)continue;
        const half=r.id===chosen?.092:.063, ox=-dz/len*half, oz=dx/len*half,y=a.y+.047;
        const p=[a.x+ox,y,a.z+oz],q=[a.x-ox,y,a.z-oz],s=[b.x+ox,y,b.z+oz],t=[b.x-ox,y,b.z-oz];
        vertices.push(...p,...s,...q,...s,...t,...q);
      }
      if(!vertices.length)return;
      const g=new T.BufferGeometry();g.setAttribute("position",new T.Float32BufferAttribute(vertices,3));
      const m=new T.MeshBasicMaterial({color:r.color,side:T.DoubleSide,transparent:true,
        opacity:r.id===chosen?.9:.55,depthWrite:false});
      unit.route=new T.Mesh(g,m);layer.add(unit.route);
    }
    function setFollowing(active,focus=false) {
      follow=active;tracked=null;followButton.setAttribute("aria-pressed",String(follow));
      followButton.textContent=follow?"Following "+chosen:"Follow robot";
      const u=units.get(chosen);
      if(!follow||!u){schedule();return;}
      onFocus();
      if(!floorVisible(u.r.pose.floor))setFloor(u.r.pose.floor,true);
      const aim=u.root.position.clone();aim.y+=.65;
      if(focus){
        controls.target.copy(aim);
        camera.position.copy(aim).add(new T.Vector3(.66,1.55,1.0).normalize().multiplyScalar(7.6));
        controls.update();
      }
      tracked=aim;schedule();
    }
    function select(id) {
      chosen=id;
      const u=units.get(id);
      if(u&&!floorVisible(u.r.pose.floor))setFloor(u.r.pose.floor,follow);
      if(follow)setFollowing(true,true);
      units.forEach(pathMesh);schedule();
    }
    function update(snapshot) {
      last=snapshot;const now=performance.now(),first=!units.size;
      for(const r of snapshot.robots){
        if(!units.has(r.id))add(r);
        const u=units.get(r.id);u.r=r;
        u.from.copy(u.root.position);u.startYaw=u.root.rotation.y;
        u.to.set(r.pose.x,r.pose.y,r.pose.z);u.yaw=r.pose.yaw;u.updated=now;
        if(needSnap){u.from.copy(u.to);u.root.position.copy(u.to);u.startYaw=u.yaw;}
        pathMesh(u);
      }
      if(first){
        followButton.disabled=false;
        thumbnails(units);
        window.dispatchEvent(new CustomEvent("clinicfleet:thumbnails",{detail:Object.fromEntries([...units].map(([k,u])=>[k,u.thumbnail]))}));
      }
      needSnap=false;
      const selected=units.get(chosen);
      if(follow && selected && !floorVisible(selected.r.pose.floor))setFloor(selected.r.pose.floor,true);
      schedule();
    }
    function paint(now) {
      if(!last)return false;
      let animating=false;
      for(const u of units.values()){
        const f=Math.max(0,Math.min(1,(now-u.updated)/125));
        const turn=Math.atan2(Math.sin(u.yaw-u.startYaw),Math.cos(u.yaw-u.startYaw));
        u.root.position.lerpVectors(u.from,u.to,f);u.root.rotation.y=u.startYaw+turn*f;
        const shown=floorVisible(u.r.pose.floor);
        u.root.visible=shown;u.ring.visible=u.r.id===chosen||!!u.r.alert;
        u.ring.material.color.set(u.r.alert?"#ce4926":u.r.color);
        if(shown && f<1 && (u.from.distanceToSquared(u.to)>.00001 || Math.abs(turn)>.002))animating=true;
      }
      if(follow && tracked && units.has(chosen)){
        const here=v.copy(units.get(chosen).root.position);here.y+=.65;delta.subVectors(here,tracked);
        if(delta.lengthSq()>1e-10){camera.position.add(delta);controls.target.add(delta);tracked.copy(here);controls.update();}
      }
      camera.updateMatrixWorld();
      const used=[];
      const free=(left,top,width,height)=>used.every(b=>left+width+3<b.left || left>b.right+3 ||
        top+height+3<b.top || top>b.bottom+3);
      for(const u of [...units.values()].sort((a,b)=>Number(b.r.id===chosen)-Number(a.r.id===chosen))){
        v.copy(u.root.position);v.y+=u.height;v.project(camera);
        const w=frame.clientWidth,h=frame.clientHeight;
        const show=u.root.visible && v.z>=-1&&v.z<=1&&Math.abs(v.x)<1.02&&Math.abs(v.y)<1.04;
        u.pin.hidden=!show;if(!show)continue;
        u.pin.setAttribute("aria-pressed",String(u.r.id===chosen));u.pin.classList.toggle("alerting",!!u.r.alert);
        const width=u.pin.offsetWidth,height=u.pin.offsetHeight;
        const x=T.MathUtils.clamp((v.x*.5+.5)*w,width/2+2,w-width/2-2),left=x-width/2;
        const base=T.MathUtils.clamp((-v.y*.5+.5)*h-10,height+2,h-2);
        const y=[0,-1,1,-2,2,-3,3].map(step=>base+step*(height+4))
          .find(bottom=>bottom>=height+2 && bottom<=h-2 && free(left,bottom-height,width,height)) ?? base;
        used.push({left,right:left+width,top:y-height,bottom:y});
        u.pin.style.transform="translate("+x.toFixed(1)+"px,"+y.toFixed(1)+"px) translate(-50%,-100%)";
      }
      const r=units.get(chosen)?.r;
      const dest=r?.mission && network.stations[r.mission.dest];
      let marker=dest && network.nodes[dest.node], label=dest?.name;
      if(marker && !floorVisible(marker.floor)){
        const landing=(r.path || []).find(n=>network.cabins.includes(n) && floorVisible(network.nodes[n].floor));
        label="Lift 1 → "+marker.floor;marker=landing && network.nodes[landing];
      }
      goalPin.hidden=true;
      if(marker && r.path.length && floorVisible(marker.floor)){
        v.set(marker.x,marker.y+.28,marker.z).project(camera);
        if(v.z>=-1 && v.z<=1 && Math.abs(v.x)<.91 && Math.abs(v.y)<.93){
          goalPin.textContent=label;goalPin.hidden=false;
          const width=goalPin.offsetWidth,height=goalPin.offsetHeight;
          const x=T.MathUtils.clamp((v.x*.5+.5)*frame.clientWidth,width/2+2,frame.clientWidth-width/2-2);
          const y=(-v.y*.5+.5)*frame.clientHeight+7;
          goalPin.hidden=!free(x-width/2,y,width,height) || y+height>frame.clientHeight;
          if(!goalPin.hidden)goalPin.style.transform="translate("+x.toFixed(1)+"px,"+y.toFixed(1)+"px) translateX(-50%)";
        }
      }
      return animating;
    }
    canvas.addEventListener("pointerdown",e=>{down=e.isPrimary && e.button===0 ? [e.clientX,e.clientY] : null;});
    canvas.addEventListener("pointercancel",()=>{down=null;});
    canvas.addEventListener("pointerup",e=>{
      if(!down || !e.isPrimary || Math.hypot(e.clientX-down[0],e.clientY-down[1])>4){down=null;return;}
      down=null;
      const rect=canvas.getBoundingClientRect();
      pointer.set((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2);
      ray.setFromCamera(pointer,camera);
      const bodies=[...units.values()].filter(u=>u.root.visible).map(u=>u.body);
      let hit=ray.intersectObjects(bodies,true)[0]?.object;
      while(hit && !hit.userData.robot)hit=hit.parent;
      if(hit)window.dispatchEvent(new CustomEvent("clinicfleet:pick",{detail:hit.userData.robot}));
    });
    followButton.addEventListener("click",()=>setFollowing(!follow,true));
    window.addEventListener("clinicfleet:state",e=>update(e.detail));
    window.addEventListener("clinicfleet:selection",e=>select(e.detail));
    window.addEventListener("clinicfleet:focus",()=>setFollowing(true,true));
    if(window.fleetConsole?.snapshot){chosen=window.fleetConsole.selected;update(window.fleetConsole.snapshot);}
    return {paint, floorChanged(){units.forEach(pathMesh);schedule();}, stopFollowing(){setFollowing(false);},
      visibility(visible){if(!visible)needSnap=true;else schedule();}};
  };
})();
