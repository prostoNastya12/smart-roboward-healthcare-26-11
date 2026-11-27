"use strict";
// The demo's 3D layer, drawn into the fleet console's own Three.js scene (clinic meters):
// the hacker, the nurse workstation, the gate, attack packets, task tags above the robots, and the "robot zone cut off" box.
// It only draws what app.js tells it. All allow/block decisions come from the real gate code.
const DemoLayer = (function () {
  const T = THREE, V = T.Vector3;
  const reduce = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const GREEN = 0x1fbf6b, RED = 0xe5384f, ORANGE = 0xff9f1c, BLUE = 0x2aa8e0, NEON = 0x39ff88;
  const P = {nurse: new V(-14, 0, 29), gate: new V(4, 0, 24), hacker: new V(22, 0, 31), entrance: new V(4, 0, 15.5)};
  const VIEWS = {   // target, direction from the target to the camera, distance (meters)
    overview: {t: [2, 4, 4], dir: [0.3, 0.66, 0.69], d: 72},
    nurse: {t: [-14, 2.6, 28], dir: [0.45, 0.35, 0.82], d: 14},
    gate: {t: [4, 2.2, 24], dir: [0.15, 0.45, 0.85], d: 24},
    hacker: {t: [22, 3.2, 30], dir: [-0.5, 0.3, 0.8], d: 10}
  };
  const AMBER = 0xf0a020, TAG = {nurse: "rgba(23,103,76,.95)", auto: "rgba(74,98,92,.92)", hacker: "rgba(170,30,45,.95)", operator: "rgba(40,95,145,.95)"};
  let env, root, hacker, nurse, gateObj, zone, zoneLabel, cable, ready = false, isolated = false, hackerTyping = false, hackerBubble = null, nurseBubble = null;
  const tags = new Map();   // robot id -> {sprite, key}: the job tag floating above each robot
  let hackerGlass = null, shake = 0;   // shared glasses material, and the head shake while the hacker rages
  let labels = [], tweens = [], runners = 0, active = false, camTween = null, last = 0, time = 0, frame = 0, adjacency = null;

  const tmp = new V();
  const M = c => new T.MeshLambertMaterial({color: c});
  const B = (c, o) => new T.MeshBasicMaterial(Object.assign({color: c, toneMapped: false}, o || {}));
  const mesh = (g, m, x, y, z) => { const o = new T.Mesh(g, m); o.position.set(x || 0, y || 0, z || 0); return o; };
  // Object3D.add() returns the PARENT, so rotation must be set on the child before adding it.
  const rotX = (o, v) => { o.rotation.x = v; return o; }, rotZ = (o, v) => { o.rotation.z = v; return o; };
  function roundRect(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
  function label(text, opt) {
    const o = Object.assign({size: 44, color: "#ffffff", bg: "rgba(13,17,23,.84)", pad: 14, scale: 0.017}, opt || {});
    const c = document.createElement("canvas"), x = c.getContext("2d"), font = "700 " + o.size + "px system-ui, Segoe UI, sans-serif";
    x.font = font;
    const w = Math.ceil(x.measureText(text).width) + o.pad * 2, h = Math.ceil(o.size * 1.4) + o.pad;
    c.width = w; c.height = h; x.font = font;
    if (o.bg) { x.fillStyle = o.bg; roundRect(x, 0, 0, w, h, 16); x.fill(); }
    x.fillStyle = o.color; x.textBaseline = "middle"; x.textAlign = "center"; x.fillText(text, w / 2, h / 2 + 2);
    const tex = new T.CanvasTexture(c); if (T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;   // keep the label colours as drawn
    const s = new T.Sprite(new T.SpriteMaterial({map: tex, transparent: true, depthWrite: false, depthTest: !o.overlay, toneMapped: false}));
    if (o.overlay) s.renderOrder = 10;   // always drawn on top, like the console's own robot pins
    s.scale.set(w * o.scale, h * o.scale, 1); s.userData.base = [w * o.scale, h * o.scale]; labels.push(s);
    return s;
  }
  function dispose(o) { o.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material) { if (n.material.map) n.material.map.dispose(); n.material.dispose(); } }); }
  const tween = (dur, fn, done) => tweens.push({t: 0, dur, fn, done});

  // ---------- characters ----------
  // glasses=true is the hacker: angry slanted brows, red glowing glasses, a snarl with fangs and no blush.
  // glasses=false is the nurse: friendly smile and blush.
  function face(group, z, glasses) {
    const white = B(0xffffff), black = B(0x10131c);
    if (glasses) hackerGlass = B(RED);   // one shared material, so the glasses can flash when the hacker rages
    for (const s of [-1, 1]) {
      group.add(mesh(new T.SphereGeometry(0.2, 16, 12), white, s * 0.32, 0.12, z));
      group.add(mesh(new T.SphereGeometry(0.1, 12, 10), black, s * 0.32, 0.12, z + 0.17));
      if (glasses) {
        group.add(mesh(new T.TorusGeometry(0.27, 0.045, 8, 24), hackerGlass, s * 0.32, 0.12, z + 0.04));
        group.add(rotZ(mesh(new T.BoxGeometry(0.62, 0.13, 0.1), black, s * 0.33, 0.43, z - 0.05), s * 0.5));   // inner ends point down: angry
      } else {
        const ch = mesh(new T.CircleGeometry(0.12, 16), B(0xff8fab, {transparent: true, opacity: 0.8}), s * 0.55, -0.16, z - 0.07); ch.rotation.y = s * 0.55; group.add(ch);
      }
    }
    if (glasses) {
      group.add(rotZ(mesh(new T.CylinderGeometry(0.03, 0.03, 0.2, 6), hackerGlass, 0, 0.14, z + 0.06), Math.PI / 2));
      group.add(mesh(new T.BoxGeometry(0.52, 0.07, 0.06), black, 0, -0.3, z + 0.05));                              // snarl
      for (const s of [-1, 1]) group.add(rotZ(mesh(new T.ConeGeometry(0.06, 0.16, 4), B(0xffffff), s * 0.14, -0.38, z + 0.05), Math.PI));   // fangs
    } else group.add(rotZ(mesh(new T.TorusGeometry(0.24, 0.045, 8, 20, Math.PI), black, 0, -0.2, z + 0.06), Math.PI));
  }
  function makeHacker() {
    const g = new T.Group(), hood = M(0x232842), skin = M(0xffd1a6);
    const body = mesh(new T.SphereGeometry(1, 24, 16), hood, 0, 1, 0); body.scale.set(1.05, 1, 0.9); g.add(body);
    for (const s of [-1, 1]) g.add(mesh(new T.CylinderGeometry(0.04, 0.04, 0.55, 6), B(NEON), s * 0.28, 1.15, 0.9));   // neon hoodie drawstrings
    const head = new T.Group(); head.position.y = 2.5; g.add(head);
    head.add(mesh(new T.SphereGeometry(1.1, 24, 16), hood, 0, 0.05, -0.28));
    const fc = mesh(new T.SphereGeometry(0.9, 24, 16), skin, 0, -0.05, 0.2); fc.scale.z = 0.9; head.add(fc);
    for (const s of [-1, 1]) {                                                     // cat ears on the hood
      head.add(rotZ(mesh(new T.ConeGeometry(0.34, 0.6, 4), hood, s * 0.68, 1.05, -0.15), -s * 0.35));
      head.add(rotZ(mesh(new T.ConeGeometry(0.2, 0.4, 4), B(0xff8fab), s * 0.68, 1.02, -0.02), -s * 0.35));
    }
    const fg = new T.Group(); head.add(fg); face(fg, 0.95, true);
    const arms = [];
    for (const s of [-1, 1]) {
      const sh = new T.Group(); sh.position.set(s * 1.0, 1.5, 0.2); g.add(sh);
      sh.add(mesh(new T.CylinderGeometry(0.17, 0.17, 1.0, 10), hood, 0, -0.45, 0));
      sh.add(mesh(new T.SphereGeometry(0.2, 12, 10), skin, 0, -1.0, 0));
      sh.rotation.x = -1.0; arms.push(sh);
    }
    g.add(mesh(new T.BoxGeometry(3.4, 0.9, 1.7), M(0x161a2b), 0, 0.45, 2.5));                    // desk
    g.add(mesh(new T.BoxGeometry(1.9, 0.08, 1.2), M(0xb8bfd0), 0, 0.95, 2.5));                    // laptop base
    const scr = new T.Group(); scr.position.set(0, 0.99, 2.95); scr.rotation.x = 0.35; g.add(scr);
    scr.add(mesh(new T.BoxGeometry(1.9, 1.2, 0.06), M(0xb8bfd0), 0, 0.6, 0));
    const lc = document.createElement("canvas"); lc.width = 128; lc.height = 128; const lx = lc.getContext("2d");
    lx.fillStyle = "#39ff88"; lx.font = "700 72px monospace"; lx.textAlign = "center"; lx.textBaseline = "middle"; lx.fillText("</>", 64, 66);
    scr.add(mesh(new T.PlaneGeometry(0.8, 0.8), B(0xffffff, {map: new T.CanvasTexture(lc), transparent: true}), 0, 0.6, 0.04));   // glowing back logo
    const glow = mesh(new T.PlaneGeometry(1.7, 1.0), B(NEON, {transparent: true, opacity: 0.25}), 0, 0.6, -0.04); glow.rotation.y = Math.PI; scr.add(glow);
    g.userData = {head, arms, glow};
    return g;
  }
  function makeNurse() {
    const g = new T.Group(), cloth = M(BLUE), skin = M(0xffd9b8);
    const body = mesh(new T.SphereGeometry(1, 24, 16), cloth, 0, 1, 0); body.scale.set(0.95, 1.05, 0.8); g.add(body);
    const head = new T.Group(); head.position.y = 2.45; g.add(head);
    head.add(mesh(new T.SphereGeometry(0.95, 24, 16), skin));
    const cap = mesh(new T.SphereGeometry(0.98, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), M(0xffffff), 0, 0.1, -0.05); cap.rotation.x = -0.25; head.add(cap);
    const cross = new T.Group(); cross.position.set(0, 0.62, 0.78); cross.rotation.x = -0.5; head.add(cross);
    cross.add(mesh(new T.BoxGeometry(0.34, 0.1, 0.03), B(0xe5383b))); cross.add(mesh(new T.BoxGeometry(0.1, 0.34, 0.03), B(0xe5383b)));
    const fg = new T.Group(); fg.position.y = -0.1; head.add(fg); face(fg, 0.86, false);
    const arm = new T.Group(); arm.position.set(1.0, 1.6, 0.1); g.add(arm);
    arm.add(mesh(new T.CylinderGeometry(0.16, 0.16, 0.95, 10), cloth, 0, -0.45, 0)); arm.add(mesh(new T.SphereGeometry(0.19, 12, 10), skin, 0, -0.98, 0));
    arm.rotation.z = -0.3;
    const arm2 = arm.clone(); arm2.position.x = -1.0; arm2.rotation.z = 0.3; g.add(arm2);
    g.userData = {arm, head};
    return g;
  }

  // ---------- world ----------
  function build() {
    root = new T.Group(); env.scene.add(root);
    const add = o => { root.add(o); return o; };
    add(mesh(new T.BoxGeometry(78, 0.12, 24), M(0xd4dcd6), 4, -0.07, 29.5));                              // pavement south of the clinic
    add(mesh(new T.BoxGeometry(11, 0.25, 8), M(0xa9d3df), P.nurse.x, 0.05, P.nurse.z));                   // nurse workstation pad
    nurse = makeNurse(); nurse.position.set(P.nurse.x, 0.2, P.nurse.z); nurse.rotation.y = 0.35; nurse.scale.setScalar(0.85); add(nurse);
    const nl = label("Nurse workstation", {size: 38}); nl.position.set(P.nurse.x, 6.2, P.nurse.z); add(nl);
    add(mesh(new T.CylinderGeometry(6, 6.3, 0.5, 40), M(0x2a1233), P.hacker.x, 0.25, P.hacker.z));        // hacker island
    add(rotX(mesh(new T.TorusGeometry(6.1, 0.12, 8, 60), B(RED), P.hacker.x, 0.52, P.hacker.z), Math.PI / 2));
    const hl = label("OUTSIDE NETWORK", {size: 38, color: "#ffc9cf", bg: "rgba(130,20,40,.9)"}); hl.position.set(P.hacker.x, 8.4, P.hacker.z); add(hl);
    hacker = makeHacker(); hacker.position.set(P.hacker.x, 0.5, P.hacker.z - 0.8); hacker.rotation.y = -0.31; hacker.scale.setScalar(0.95); add(hacker);
    gateObj = new T.Group(); gateObj.position.copy(P.gate); add(gateObj);
    for (const x of [-3.3, 3.3]) gateObj.add(mesh(new T.BoxGeometry(0.8, 4.2, 0.8), M(0x3b4a66), x, 2.1, 0));
    gateObj.add(mesh(new T.BoxGeometry(7.4, 0.8, 0.9), M(0x3b4a66), 0, 4.3, 0));
    const ring = mesh(new T.TorusGeometry(1.9, 0.18, 12, 40), B(GREEN), 0, 2.3, 0), shield = mesh(new T.CircleGeometry(1.8, 32), B(GREEN, {transparent: true, opacity: 0.14, side: T.DoubleSide}), 0, 2.3, 0);
    gateObj.add(ring, shield);
    const gl = label("GATE (checks every request)", {size: 36}); gl.position.set(0, 6.2, 0); gateObj.add(gl);
    gateObj.userData = {ring, shield};
    const line = (a, b, c) => { const l = new T.Line(new T.BufferGeometry().setFromPoints([a, b]), new T.LineDashedMaterial({color: c, dashSize: 0.8, gapSize: 0.5, toneMapped: false})); l.computeLineDistances(); add(l); return l; };
    line(new V(P.nurse.x + 4, 0.6, P.nurse.z - 1), new V(P.gate.x - 3.3, 0.6, P.gate.z), BLUE);
    line(new V(P.hacker.x - 6, 0.6, P.hacker.z - 2), new V(P.gate.x + 3.3, 0.6, P.gate.z), RED);
    cable = line(new V(P.gate.x, 0.6, P.gate.z - 0.8), new V(P.entrance.x, 0.6, P.entrance.z), GREEN);
    const box = new T.BoxGeometry(52, 13, 40);                                                            // shows the robot zone being cut off
    zone = new T.Group(); zone.position.set(2, 6.5, -3);
    zone.add(mesh(box, B(RED, {transparent: true, opacity: 0.07, side: T.DoubleSide, depthWrite: false})));
    zone.add(new T.LineSegments(new T.EdgesGeometry(box), new T.LineBasicMaterial({color: RED, toneMapped: false})));
    zone.visible = false; add(zone);
    zoneLabel = label("ROBOT ZONE CUT OFF", {size: 44, color: "#ffe1e5", bg: "rgba(170,20,40,.92)"}); zoneLabel.position.set(2, 15, -3); zoneLabel.visible = false; add(zoneLabel);
    env.controls.addEventListener("start", () => { camTween = null; });
  }

  // ---------- effects ----------
  function pop(text, color, pos, big) {
    const s = label(text, {size: big ? 46 : 36, color: color || "#fff"}); s.position.copy(pos); root.add(s);
    const y0 = pos.y;
    tween(1.6, p => { s.position.y = y0 + p * 3; s.material.opacity = p < 0.7 ? 1 : (1 - p) / 0.3; }, () => { root.remove(s); dispose(s); });
  }
  function burst(pos, color) {
    if (reduce) return;
    const mat = B(color, {transparent: true}), parts = [];
    for (let i = 0; i < 12; i++) { const m = mesh(new T.SphereGeometry(0.2, 6, 6), mat, pos.x, pos.y, pos.z); const a = Math.random() * Math.PI * 2; m.userData.v = new V(Math.cos(a) * 5, Math.random() * 4 + 1, Math.sin(a) * 5); root.add(m); parts.push(m); }
    tween(0.7, p => { for (const m of parts) { m.position.addScaledVector(m.userData.v, 0.016); m.userData.v.y -= 0.2; } mat.opacity = 1 - p; }, () => { for (const m of parts) { root.remove(m); m.geometry.dispose(); } mat.dispose(); });
  }
  function gateColor(c) { gateObj.userData.ring.material.color.setHex(c); gateObj.userData.shield.material.color.setHex(c); }
  const gateBase = () => isolated ? ORANGE : GREEN;
  function gateFlash(c) {
    gateColor(c); const g = gateObj.userData;
    tween(0.5, p => g.ring.scale.setScalar(1 + Math.sin(p * Math.PI) * (reduce ? 0 : 0.3)), () => { g.ring.scale.setScalar(1); gateColor(gateBase()); });
  }
  function packet(from, to, color, dur, cb, size) {
    const s = mesh(new T.SphereGeometry(size || 0.5, 12, 8), B(color), from.x, from.y, from.z); root.add(s);
    tween(dur, p => { s.position.lerpVectors(from, to, p); s.position.y += Math.sin(p * Math.PI) * Math.min(4, from.distanceTo(to) * 0.12); }, () => { root.remove(s); s.geometry.dispose(); s.material.dispose(); if (cb) cb(); });
  }
  function moveAlong(obj, pts, speed, done) {
    const seg = [], total = pts.slice(1).reduce((acc, p, i) => { const d = p.distanceTo(pts[i]); seg.push(d); return acc + d; }, 0);
    tween(Math.max(0.05, total / speed), p => {
      let d = p * total, i = 0; while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; }
      const a = pts[i], b = pts[i + 1], k = seg[i] ? Math.min(1, d / seg[i]) : 1;
      obj.position.lerpVectors(a, b, k); const dx = b.x - a.x, dz = b.z - a.z; if (dx || dz) obj.rotation.y = Math.atan2(dx, dz);
    }, done);
  }
  function robotPos(id) {
    const s = window.fleetConsole && window.fleetConsole.snapshot, r = s && s.robots.find(x => x.id === id);
    return r ? new V(r.pose.x, r.pose.y + 1.2, r.pose.z) : new V(P.entrance.x, 1.5, P.entrance.z);
  }
  function route(fromNode, toNode) {   // shortest walking path over the clinic's mapped nodes (breadth-first search)
    const net = env.network;
    if (!adjacency) { adjacency = new Map(Object.keys(net.nodes).map(k => [k, []])); for (const [a, b] of net.edges) { adjacency.get(a).push(b); adjacency.get(b).push(a); } }
    const prev = new Map([[fromNode, null]]), queue = [fromNode];
    while (queue.length) { const n = queue.shift(); if (n === toNode) break; for (const m of adjacency.get(n)) if (!prev.has(m)) { prev.set(m, n); queue.push(m); } }
    if (!prev.has(toNode)) return null;
    const path = []; for (let n = toNode; n; n = prev.get(n)) path.unshift(n);
    return path.map(n => new V(net.nodes[n].x, net.nodes[n].y, net.nodes[n].z));
  }

  // ---------- public API ----------
  const api = {
    get ready() { return ready; },
    init(e) {
      if (ready) return true;
      env = e; build(); ready = true;
      requestAnimationFrame(loop); return true;
    },
    setActive(b) { active = b; },
    // A request travels from "nurse" or "hacker" to the gate. passed=false: stopped at the gate. passed=true: goes on to the robot.
    request(o) {
      if (!ready) { if (o.arrive) o.arrive(); return; }
      const hk = o.from === "hacker", from = hk ? new V(P.hacker.x - 1.6, 3, P.hacker.z - 0.5) : new V(P.nurse.x + 1.8, 3, P.nurse.z - 0.5);
      const gate = new V(P.gate.x, 2.4, P.gate.z + 0.5), color = hk ? (o.color || RED) : (o.hold ? AMBER : GREEN), k = o.fast ? 0.5 : 1;
      packet(from, gate, color, Math.max(0.5, from.distanceTo(gate) / 24) * k, () => {
        if (o.hold) { gateFlash(AMBER); pop(o.text || "NEEDS AUTHORIZATION", "#ffd28a", new V(P.gate.x, 6.8, P.gate.z)); if (o.arrive) o.arrive(); return; }
        if (!o.passed) { gateFlash(RED); if (!o.quiet) { burst(new V(P.gate.x, 2.4, P.gate.z + 0.8), RED); pop(o.text || "BLOCKED", "#ff9aa6", new V(P.gate.x, 6.8, P.gate.z)); } if (o.arrive) o.arrive(); return; }
        gateFlash(hk ? RED : GREEN);
        if (o.noRobot) { if (!o.quiet) pop(o.text || "OK", hk ? "#ff9aa6" : "#8dffbe", new V(P.gate.x, 6.8, P.gate.z)); if (o.arrive) o.arrive(); return; }
        const to = robotPos(o.target);
        packet(gate, to, color, Math.max(0.7, gate.distanceTo(to) / 22) * k, () => { if (o.arrive) o.arrive(); });
      });
    },
    // A held task was authorized: it continues from the gate to the robot.
    gateToRobot(target, cb) {
      if (!ready) { if (cb) cb(); return; }
      const gate = new V(P.gate.x, 2.4, P.gate.z + 0.5), to = robotPos(target);
      gateFlash(GREEN); pop("AUTHORIZED", "#8dffbe", new V(P.gate.x, 6.8, P.gate.z));
      packet(gate, to, GREEN, Math.max(0.7, gate.distanceTo(to) / 22), cb);
    },
    // The job tag above a robot. kind: nurse | auto | hacker | operator. text=null removes it.
    setTask(id, text, kind) {
      if (!ready) return;
      const old = tags.get(id), key = text ? kind + "|" + text : null;
      if (old && old.key === key) return;
      if (old) { root.remove(old.sprite); dispose(old.sprite); tags.delete(id); }
      if (!text) return;
      const s = label(text, {size: 40, color: "#ffffff", bg: TAG[kind] || TAG.auto, pad: 14, overlay: true, scale: 0.03}); root.add(s);
      tags.set(id, {sprite: s, key});
    },
    nurseSay(text) {
      if (!ready) return;
      if (nurseBubble) { root.remove(nurseBubble); dispose(nurseBubble); }
      const s = label(text, {size: 36, color: "#14202b", bg: "rgba(255,255,255,.96)"}); s.position.set(P.nurse.x, 8.6, P.nurse.z); root.add(s); nurseBubble = s;
      tween(2.2, p => { if (p > 0.85) s.material.opacity = (1 - p) / 0.15; }, () => { if (nurseBubble === s) nurseBubble = null; root.remove(s); dispose(s); });
    },
    // A message coming BACK from the (possibly hacked) robot. passed=true means the gate let the bad message in.
    robotMessage(o) {
      if (!ready) { if (o.arrive) o.arrive(); return; }
      const gate = new V(P.gate.x, 2.4, P.gate.z + 0.5);
      packet(robotPos(o.target), gate, RED, 1.6, () => {
        gateFlash(o.passed ? RED : GREEN);
        if (!o.passed) burst(new V(P.gate.x, 2.4, P.gate.z + 0.8), GREEN);
        pop(o.passed ? "WARD RECORDS CORRUPTED" : "DROPPED", o.passed ? "#ff9aa6" : "#8dffbe", new V(P.gate.x, 6.8, P.gate.z));
        if (o.arrive) o.arrive();
      });
    },
    // A person carries a delivery by hand along the clinic's mapped corridors (used while the robots are cut off).
    manualDeliver(fromStation, toStation) {
      if (!ready || runners >= 3) return;
      const st = env.network.stations, pts = st[fromStation] && st[toStation] && route(st[fromStation].node, st[toStation].node);
      if (!pts || pts.length < 2) return;
      runners++;
      const g = new T.Group();
      g.add(mesh(T.CapsuleGeometry ? new T.CapsuleGeometry(0.3, 0.7, 4, 10) : new T.CylinderGeometry(0.3, 0.3, 1.0, 10), M(0xffa94d), 0, 0.85, 0));
      g.add(mesh(new T.SphereGeometry(0.26, 12, 10), M(0xffd9b8), 0, 1.65, 0)); g.add(mesh(new T.BoxGeometry(0.4, 0.3, 0.4), M(0xd9a441), 0, 1.0, 0.4));
      const t = label("by hand", {size: 30, color: "#ffd9a0"}); t.position.y = 2.6; g.add(t);
      g.position.copy(pts[0]); root.add(g);
      moveAlong(g, pts, 4.5, () => tween(0.6, () => {}, () => { root.remove(g); dispose(g); runners--; }));
    },
    setIsolated(b) {
      if (b === isolated) return; isolated = b; if (!ready) return;
      zone.visible = b; zoneLabel.visible = b; cable.material.color.setHex(b ? 0x777c88 : GREEN); gateColor(gateBase());
    },
    hackerSay(text) {
      if (!ready) return;
      if (hackerBubble) { root.remove(hackerBubble); dispose(hackerBubble); }
      const s = label(text, {size: 40, color: "#14202b", bg: "rgba(255,255,255,.96)"}); s.position.set(P.hacker.x - 3, 11.5, P.hacker.z); root.add(s); hackerBubble = s;
      tween(1.9, p => { if (p > 0.85) s.material.opacity = (1 - p) / 0.15; }, () => { if (hackerBubble === s) hackerBubble = null; root.remove(s); dispose(s); });
    },
    hackerTyping(b) { hackerTyping = b; },
    // The gate stopped an attack: the hacker flashes white-hot, then red, and shakes his head with rage.
    hackerRage() {
      if (!ready || !hackerGlass) return;
      tween(0.8, p => { hackerGlass.color.setHex(p < 0.45 ? 0xffffff : RED); shake = reduce ? 0 : Math.sin(p * 45) * 0.16 * (1 - p); }, () => { hackerGlass.color.setHex(RED); shake = 0; });
    },
    nurseWave() { if (ready) tween(0.9, p => { nurse.userData.arm.rotation.z = -2.4 + Math.sin(p * 18) * 0.4 * (1 - p); }, () => { nurse.userData.arm.rotation.z = -0.3; }); },
    view(name) {
      const v = VIEWS[name]; if (!ready || !v) return;
      const to = new V(...v.t), pos = to.clone().addScaledVector(new V(...v.dir).normalize(), v.d);
      camTween = {t: 0, dur: reduce ? 0.01 : 1.1, p0: env.camera.position.clone(), t0: env.controls.target.clone(), p1: pos, t1: to};
    },
    reset() { if (ready) { runners = 0; for (const id of [...tags.keys()]) api.setTask(id, null); } api.setIsolated(false); }
  };

  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now; time += dt; frame++;
    for (let i = tweens.length - 1; i >= 0; i--) { const tw = tweens[i]; tw.t += dt; const p = Math.min(1, tw.t / tw.dur); tw.fn(p); if (p >= 1) { tweens.splice(i, 1); if (tw.done) tw.done(); } }
    let moving = tweens.length > 0;
    if (camTween) {
      const c = camTween; c.t += dt; const p = Math.min(1, c.t / c.dur), k = p * p * (3 - 2 * p);
      env.camera.position.lerpVectors(c.p0, c.p1, k); env.controls.target.lerpVectors(c.t0, c.t1, k); env.controls.update();
      if (p >= 1) camTween = null; moving = true;
    }
    if (ready) {
      if (!reduce) {
        nurse.position.y = 0.2 + Math.sin(time * 2) * 0.05; hacker.position.y = 0.5 + Math.sin(time * 2.4 + 1) * 0.06;
        const u = hacker.userData;
        u.arms.forEach((a, i) => { a.rotation.x = -1.0 + (hackerTyping ? Math.sin(time * 22 + i * 2) * 0.28 : 0); });
        u.head.rotation.z = Math.sin(time * 1.5) * 0.04 + shake;
      }
      hacker.userData.glow.material.opacity = hackerTyping ? 0.45 + Math.sin(time * 20) * 0.2 : 0.2;
      if (isolated && !reduce) zone.children[0].material.opacity = 0.06 + Math.sin(time * 3) * 0.025;
      if (tags.size) {
        const snap = window.fleetConsole && window.fleetConsole.snapshot, fl = document.getElementById("model-floor");
        for (const [id, t] of tags) {
          const r = snap && snap.robots.find(x => x.id === id);
          t.sprite.visible = !!r && (!fl || fl.value === "both" || fl.value === r.pose.floor);
          if (r) t.sprite.position.set(r.pose.x, r.pose.y + 4.4, r.pose.z);
        }
        moving = true;
      }
      labels = labels.filter(s => s.parent);
      for (const s of labels) {   // keep labels readable: smaller when the camera is close, larger when far away
        s.getWorldPosition(tmp);
        const f = Math.max(0.25, Math.min(2.2, env.camera.position.distanceTo(tmp) / 45));
        s.scale.set(s.userData.base[0] * f, s.userData.base[1] * f, 1);
      }
      if (moving || ((active || isolated) && frame % 2 === 0)) env.schedule();
    }
    requestAnimationFrame(loop);
  }
  return api;
})();
