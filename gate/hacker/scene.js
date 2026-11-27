"use strict";
// 3D scene for the live hack demo: ward, nurse, robot, gate and a cute hacker. Uses the bundled Three.js.
// The scene only draws what app.js tells it; all security decisions come from the real gate code.
const Scene3D = (function () {
  const V = THREE.Vector3;
  const reduce = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const DEST_X = {"Pharmacy": -12, "Lab": -4, "Room 12": 4, "Room 7": 12, "Storage": 19};
  const P = {nurse: new V(-14, 0, 10), gate: new V(0, 0, 6.5), hacker: new V(15, 0, 10), home: new V(-18, 0, 1)};
  const GREEN = 0x17a06a, RED = 0xd9452b, ORANGE = 0xe08a1e, BLUE = 0x2a7fc1;
  let renderer, scene, camera, canvas, ready = false, lastT = 0, time = 0;
  const tweens = [];
  let labels = [];
  const VIEWS = {
    ward: {theta: 0, phi: 0.62, r: 38, tx: 0, ty: 0, tz: 1},
    hacker: {theta: -0.6, phi: 1.0, r: 13, tx: 15, ty: 2.2, tz: 9},
    robot: {theta: 0.3, phi: 1.0, r: 13, tx: -18, ty: 1.2, tz: 1},
    gate: {theta: 0, phi: 0.9, r: 16, tx: 0, ty: 2, tz: 6.5}
  };
  const cam = Object.assign({}, VIEWS.ward), goal = Object.assign({}, VIEWS.ward);   // goal: where the camera is heading; cam eases toward it
  let robot, hacker, nurse, gateObj, dome, cable, isoLabel, hackerBubble = null;
  let robotBusy = false, robotJobs = [], hackerTyping = false, isolated = false, runners = 0;

  const M = (c, o) => new THREE.MeshLambertMaterial(Object.assign({color: c}, o || {}));
  const B = (c, o) => new THREE.MeshBasicMaterial(Object.assign({color: c}, o || {}));
  function mesh(g, m, x, y, z) { const o = new THREE.Mesh(g, m); o.position.set(x || 0, y || 0, z || 0); return o; }
  // Object3D.add() returns the PARENT, so rotation must be set on the child before adding it.
  const rotX = (o, v) => { o.rotation.x = v; return o; }, rotZ = (o, v) => { o.rotation.z = v; return o; };
  function roundRect(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
  function label(text, opt) {
    const o = Object.assign({size: 44, color: "#18382e", bg: "rgba(255,255,255,.93)", pad: 14, scale: 0.017}, opt || {});
    const c = document.createElement("canvas"), x = c.getContext("2d"), font = "700 " + o.size + "px system-ui, Segoe UI, sans-serif";
    x.font = font;
    const w = Math.ceil(x.measureText(text).width) + o.pad * 2, h = Math.ceil(o.size * 1.4) + o.pad;
    c.width = w; c.height = h; x.font = font;
    if (o.bg) { x.fillStyle = o.bg; roundRect(x, 0, 0, w, h, 16); x.fill(); }
    x.fillStyle = o.color; x.textBaseline = "middle"; x.textAlign = "center"; x.fillText(text, w / 2, h / 2 + 2);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false}));
    s.scale.set(w * o.scale, h * o.scale, 1);
    s.userData.base = [w * o.scale, h * o.scale]; labels.push(s);   // size follows camera distance, see loop()
    return s;
  }
  function dispose(o) { o.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material) { if (n.material.map) n.material.map.dispose(); n.material.dispose(); } }); }
  function tween(dur, fn, done) { tweens.push({t: 0, dur, fn, done}); }

  // ---------- characters ----------
  function face(group, z, glasses) {
    const white = B(0xffffff), black = B(0x10131c);
    for (const s of [-1, 1]) {
      group.add(mesh(new THREE.SphereGeometry(0.2, 16, 12), white, s * 0.32, 0.12, z));
      group.add(mesh(new THREE.SphereGeometry(0.1, 12, 10), black, s * 0.32, 0.12, z + 0.17));
      if (glasses) { const r = mesh(new THREE.TorusGeometry(0.27, 0.045, 8, 24), B(GREEN), s * 0.32, 0.12, z + 0.04); group.add(r); }
      const ch = mesh(new THREE.CircleGeometry(0.12, 16), B(0xff8fab, {transparent: true, opacity: 0.8}), s * 0.55, -0.16, z - 0.07); ch.rotation.y = s * 0.55; group.add(ch);
    }
    if (glasses) group.add(rotZ(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 6), B(GREEN), 0, 0.14, z + 0.06), Math.PI / 2));
    group.add(rotZ(mesh(new THREE.TorusGeometry(0.24, 0.045, 8, 20, Math.PI), black, 0, -0.2, z + 0.06), Math.PI));
  }
  function makeHacker() {
    const g = new THREE.Group(), hood = M(0x232842), skin = M(0xffd1a6);
    const body = mesh(new THREE.SphereGeometry(1, 24, 16), hood, 0, 1, 0); body.scale.set(1.05, 1, 0.9); g.add(body);
    for (const s of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.55, 6), B(GREEN), s * 0.28, 1.15, 0.9));   // neon hoodie drawstrings
    const head = new THREE.Group(); head.position.y = 2.5; g.add(head);
    head.add(mesh(new THREE.SphereGeometry(1.1, 24, 16), hood, 0, 0.05, -0.28));
    const fc = mesh(new THREE.SphereGeometry(0.9, 24, 16), skin, 0, -0.05, 0.2); fc.scale.z = 0.9; head.add(fc);
    for (const s of [-1, 1]) {                                                     // cat ears on the hood
      const ear = mesh(new THREE.ConeGeometry(0.34, 0.6, 4), hood, s * 0.68, 1.05, -0.15); ear.rotation.z = -s * 0.35; head.add(ear);
      const inner = mesh(new THREE.ConeGeometry(0.2, 0.4, 4), B(0xff8fab), s * 0.68, 1.02, -0.02); inner.rotation.z = -s * 0.35; head.add(inner);
    }
    const fg = new THREE.Group(); head.add(fg); face(fg, 0.95, true);
    const arms = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(s * 1.0, 1.5, 0.2); g.add(sh);
      const a = mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.0, 10), hood, 0, -0.45, 0); sh.add(a);
      sh.add(mesh(new THREE.SphereGeometry(0.2, 12, 10), skin, 0, -1.0, 0));
      sh.rotation.x = -1.0; arms.push(sh);
    }
    // desk + laptop with a glowing back logo (the hacker looks at the screen)
    g.add(mesh(new THREE.BoxGeometry(3.4, 0.9, 1.7), M(0x161a2b), 0, 0.45, 2.5));
    g.add(mesh(new THREE.BoxGeometry(1.9, 0.08, 1.2), M(0xb8bfd0), 0, 0.95, 2.5));
    const scr = new THREE.Group(); scr.position.set(0, 0.99, 2.95); scr.rotation.x = 0.35; g.add(scr);
    scr.add(mesh(new THREE.BoxGeometry(1.9, 1.2, 0.06), M(0xb8bfd0), 0, 0.6, 0));
    const lc = document.createElement("canvas"); lc.width = 128; lc.height = 128; const lx = lc.getContext("2d");
    lx.fillStyle = "#39ff88"; lx.font = "700 72px monospace"; lx.textAlign = "center"; lx.textBaseline = "middle"; lx.fillText("</>", 64, 66);
    const logo = mesh(new THREE.PlaneGeometry(0.8, 0.8), B(0xffffff, {map: new THREE.CanvasTexture(lc), transparent: true}), 0, 0.6, 0.04); logo.rotation.y = 0; scr.add(logo);
    const glow = mesh(new THREE.PlaneGeometry(1.7, 1.0), B(GREEN, {transparent: true, opacity: 0.25}), 0, 0.6, -0.04); glow.rotation.y = Math.PI; scr.add(glow);
    g.userData = {head, arms, glow};
    return g;
  }
  function makeNurse() {
    const g = new THREE.Group(), cloth = M(BLUE), skin = M(0xffd9b8);
    const body = mesh(new THREE.SphereGeometry(1, 24, 16), cloth, 0, 1, 0); body.scale.set(0.95, 1.05, 0.8); g.add(body);
    const head = new THREE.Group(); head.position.y = 2.45; g.add(head);
    head.add(mesh(new THREE.SphereGeometry(0.95, 24, 16), skin));
    const cap = mesh(new THREE.SphereGeometry(0.98, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), M(0xffffff), 0, 0.1, -0.05); cap.rotation.x = -0.25; head.add(cap);
    const cross = new THREE.Group(); cross.position.set(0, 0.62, 0.78); cross.rotation.x = -0.5; head.add(cross);
    cross.add(mesh(new THREE.BoxGeometry(0.34, 0.1, 0.03), B(0xe5383b))); cross.add(mesh(new THREE.BoxGeometry(0.1, 0.34, 0.03), B(0xe5383b)));
    const fg = new THREE.Group(); fg.position.y = -0.1; head.add(fg); face(fg, 0.86, false);
    const arm = new THREE.Group(); arm.position.set(1.0, 1.6, 0.1); g.add(arm);
    arm.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.95, 10), cloth, 0, -0.45, 0)); arm.add(mesh(new THREE.SphereGeometry(0.19, 12, 10), skin, 0, -0.98, 0));
    arm.rotation.z = -0.3;
    const arm2 = arm.clone(); arm2.position.x = -1.0; arm2.rotation.z = 0.3; g.add(arm2);
    g.userData = {arm, head};
    return g;
  }
  function faceTexture(kind) {
    const c = document.createElement("canvas"); c.width = 128; c.height = 80; const x = c.getContext("2d");
    x.fillStyle = "#10131c"; x.fillRect(0, 0, 128, 80);
    x.strokeStyle = kind === "x" ? "#ff4d5e" : "#39ff88"; x.fillStyle = x.strokeStyle; x.lineWidth = 9; x.lineCap = "round";
    if (kind === "x") { for (const cx of [38, 90]) { x.beginPath(); x.moveTo(cx - 12, 22); x.lineTo(cx + 12, 46); x.moveTo(cx + 12, 22); x.lineTo(cx - 12, 46); x.stroke(); } x.beginPath(); x.arc(64, 70, 16, Math.PI, 0); x.stroke(); }
    else { for (const cx of [38, 90]) { x.beginPath(); x.ellipse(cx, 32, 10, 15, 0, 0, Math.PI * 2); x.fill(); } x.beginPath(); x.arc(64, 46, 18, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke(); }
    const t = new THREE.CanvasTexture(c); return t;
  }
  function makeRobot() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(1.9, 1.0, 1.4), M(0xf3f6fa), 0, 0.85, 0));
    g.add(mesh(new THREE.BoxGeometry(1.95, 0.18, 1.45), M(0x23c4a8), 0, 0.5, 0));
    g.add(mesh(new THREE.SphereGeometry(0.62, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M(0xf3f6fa), 0, 1.35, 0));
    const lamp = mesh(new THREE.SphereGeometry(0.16, 12, 10), B(GREEN), 0, 1.95, 0); g.add(lamp);
    const screen = mesh(new THREE.PlaneGeometry(1.2, 0.72), B(0xffffff, {map: faceTexture("ok")}), 0, 0.95, 0.71); g.add(screen);
    for (const s of [-1, 1]) { const w = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.25, 16), M(0x1b2230), s * 0.8, 0.34, 0.1); w.rotation.z = Math.PI / 2; g.add(w); }
    const parcel = mesh(new THREE.BoxGeometry(0.6, 0.4, 0.6), M(0xd9a441), 0, 1.7, -0.1); parcel.visible = false; g.add(parcel);
    g.userData = {lamp, screen, parcel, ok: faceTexture("ok"), bad: faceTexture("x")};
    return g;
  }
  function setRobot(state) {
    const u = robot.userData;
    u.lamp.material.color.setHex(state === "hacked" ? RED : GREEN);
    u.screen.material.map = state === "hacked" ? u.bad : u.ok; u.screen.material.needsUpdate = true;
  }

  // ---------- world ----------
  function room(name, x, color, prop) {
    scene.add(mesh(new THREE.BoxGeometry(6.6, 0.2, 6.6), M(color), x, 0.1, -6));
    const wall = M(0xc3cfc7);
    scene.add(mesh(new THREE.BoxGeometry(6.6, 2.2, 0.2), wall, x, 1.1, -9.3));
    scene.add(mesh(new THREE.BoxGeometry(0.2, 2.2, 6.6), wall, x - 3.3, 1.1, -6));
    scene.add(mesh(new THREE.BoxGeometry(0.2, 2.2, 6.6), wall, x + 3.3, 1.1, -6));
    if (prop) scene.add(prop(x));
    const l = label(name, {size: 40}); l.position.set(x, 3.6, -6); scene.add(l);
  }
  function box(w, h, d, c, x, y, z) { return mesh(new THREE.BoxGeometry(w, h, d), M(c), x, y, z); }
  function buildWorld() {
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb3a8, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 0.6); sun.position.set(10, 25, 15); scene.add(sun);
    scene.add(rotX(mesh(new THREE.PlaneGeometry(70, 46), M(0xd3ddd5), 0, 0, 2), -Math.PI / 2));
    scene.add(box(46, 0.06, 6.4, 0xeef3ec, 0, 0.03, 0.9));
    room("Pharmacy", -12, 0x9fcdbb, x => { const g = new THREE.Group(); g.add(box(4.5, 1.8, 0.7, 0x8ec5c0, x, 1.0, -8.6)); return g; });
    room("Lab", -4, 0xb4c8e0, x => { const g = new THREE.Group(); g.add(box(3.6, 0.9, 1.4, 0xbcd0ee, x, 0.65, -6.5)); return g; });
    room("Room 12", 4, 0xc9c0dc, x => { const g = new THREE.Group(); g.add(box(2.2, 0.6, 3.4, 0xf1f1f6, x, 0.5, -6.2)); g.add(box(2.2, 0.9, 0.4, 0xd9d9ea, x, 0.7, -7.7)); return g; });
    room("Room 7", 12, 0xdcc3cc, x => { const g = new THREE.Group(); g.add(box(2.2, 0.6, 3.4, 0xf1f1f6, x, 0.5, -6.2)); g.add(box(2.2, 0.9, 0.4, 0xd9d9ea, x, 0.7, -7.7)); return g; });
    room("Storage", 19, 0xdccfae, x => { const g = new THREE.Group(); g.add(box(1.6, 1.4, 1.6, 0xb99a5b, x - 1, 0.9, -7)); g.add(box(1.4, 1.0, 1.4, 0xcdae70, x + 1.2, 0.7, -6.4)); return g; });
    // nurse station
    scene.add(box(8, 0.3, 5.5, 0xb8d2c4, P.nurse.x, 0.15, P.nurse.z));
    const nl = label("Nurse station", {size: 38}); nl.position.set(P.nurse.x, 5.4, P.nurse.z); scene.add(nl);
    nurse = makeNurse(); nurse.position.copy(P.nurse); nurse.position.y = 0.3; nurse.rotation.y = 0.5; nurse.scale.setScalar(0.9); scene.add(nurse);
    // hacker island
    const isl = mesh(new THREE.CylinderGeometry(5.6, 5.9, 0.5, 40), M(0xf2d6cd), P.hacker.x, 0.25, P.hacker.z); scene.add(isl);
    scene.add(rotX(mesh(new THREE.TorusGeometry(5.7, 0.09, 8, 60), B(RED), P.hacker.x, 0.52, P.hacker.z), Math.PI / 2));
    const hl = label("OUTSIDE NETWORK", {size: 38, color: "#a3261b"}); hl.position.set(P.hacker.x, 6.6, P.hacker.z); scene.add(hl);
    hacker = makeHacker(); hacker.position.set(P.hacker.x, 0.5, P.hacker.z - 0.6); hacker.rotation.y = -0.62; hacker.scale.setScalar(0.95); scene.add(hacker);
    // robot
    robot = makeRobot(); robot.position.copy(P.home); robot.rotation.y = 0.3; scene.add(robot);
    const rl = label("Delivery robot", {size: 34}); rl.position.set(P.home.x, 4.1, P.home.z + 0.5); scene.add(rl);
    // gate
    gateObj = new THREE.Group(); gateObj.position.copy(P.gate); scene.add(gateObj);
    const pm = M(0x3b4a66);
    gateObj.add(box(0.7, 3.6, 0.7, 0x3b4a66, -2.9, 1.8, 0)); gateObj.add(box(0.7, 3.6, 0.7, 0x3b4a66, 2.9, 1.8, 0)); gateObj.add(box(6.5, 0.7, 0.8, 0x3b4a66, 0, 3.7, 0));
    const ring = mesh(new THREE.TorusGeometry(1.7, 0.16, 12, 40), B(GREEN), 0, 1.9, 0); gateObj.add(ring);
    const shield = mesh(new THREE.CircleGeometry(1.6, 32), B(GREEN, {transparent: true, opacity: 0.12, side: THREE.DoubleSide}), 0, 1.9, 0); gateObj.add(shield);
    const gl = label("GATE (checks every request)", {size: 36}); gl.position.set(0, 5.2, 0); gateObj.add(gl);
    gateObj.userData = {ring, shield, flash: 0};
    // dome that shows the isolated robot zone
    dome = mesh(new THREE.SphereGeometry(13, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), B(RED, {transparent: true, opacity: 0.09, side: THREE.DoubleSide}), -4, 0, -1); dome.scale.set(1.9, 0.35, 0.65); dome.visible = false; scene.add(dome);
    isoLabel = label("ROBOT ZONE CUT OFF", {size: 40, color: "#ffffff", bg: "rgba(142,59,34,.95)"}); isoLabel.position.set(-8, 6, 1); isoLabel.visible = false; scene.add(isoLabel);
    // links (cables)
    const link = (a, b, c) => { const g = new THREE.BufferGeometry().setFromPoints([a, b]); const l = new THREE.Line(g, new THREE.LineDashedMaterial({color: c, dashSize: 0.5, gapSize: 0.35})); l.computeLineDistances(); scene.add(l); return l; };
    link(new V(P.nurse.x + 3, 0.5, P.nurse.z), new V(P.gate.x - 2.9, 0.5, P.gate.z), BLUE);
    link(new V(P.hacker.x - 5, 0.5, P.hacker.z), new V(P.gate.x + 2.9, 0.5, P.gate.z), RED);
    cable = link(new V(P.gate.x, 0.5, P.gate.z - 0.5), new V(P.home.x + 1.5, 0.5, P.home.z + 1.2), GREEN);
  }

  // ---------- effects ----------
  function pop(text, color, pos, big) {
    const s = label(text, {size: big ? 46 : 36, color: color || "#fff"}); s.position.copy(pos); scene.add(s);
    const y0 = pos.y;
    tween(1.5, p => { s.position.y = y0 + p * 2.2; s.material.opacity = p < 0.7 ? 1 : (1 - p) / 0.3; }, () => { scene.remove(s); dispose(s); });
  }
  function burst(pos, color) {
    if (reduce) return;
    const mat = B(color, {transparent: true}), parts = [];
    for (let i = 0; i < 12; i++) { const m = mesh(new THREE.SphereGeometry(0.12, 6, 6), mat, pos.x, pos.y, pos.z); const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2 - 0.2; m.userData.v = new V(Math.cos(a) * 3, e * 3 + 1.5, Math.sin(a) * 3); scene.add(m); parts.push(m); }
    tween(0.6, p => { for (const m of parts) { m.position.addScaledVector(m.userData.v, 0.016); m.userData.v.y -= 0.12; } mat.opacity = 1 - p; }, () => { for (const m of parts) { scene.remove(m); m.geometry.dispose(); } mat.dispose(); });
  }
  function gateColor(c) { gateObj.userData.ring.material.color.setHex(c); gateObj.userData.shield.material.color.setHex(c); }
  function gateBase() { return isolated ? ORANGE : GREEN; }
  function gateFlash(c) {
    gateColor(c); const g = gateObj.userData;
    tween(0.45, p => { const k = 1 + Math.sin(p * Math.PI) * (reduce ? 0 : 0.3); g.ring.scale.setScalar(k); }, () => { g.ring.scale.setScalar(1); gateColor(gateBase()); });
  }
  function packet(from, to, color, dur, cb, size) {
    const s = mesh(new THREE.SphereGeometry(size || 0.3, 12, 8), B(color), from.x, from.y, from.z); scene.add(s);
    tween(dur, p => { s.position.lerpVectors(from, to, p); s.position.y += Math.sin(p * Math.PI) * 1.2; }, () => { scene.remove(s); s.geometry.dispose(); s.material.dispose(); if (cb) cb(); });
  }
  function moveAlong(obj, pts, speed, done) {
    const seg = [], total = pts.slice(1).reduce((acc, p, i) => { const d = p.distanceTo(pts[i]); seg.push(d); return acc + d; }, 0);
    tween(Math.max(0.05, total / speed), p => {
      let d = p * total, i = 0; while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; }
      const a = pts[i], b = pts[i + 1], k = seg[i] ? Math.min(1, d / seg[i]) : 1;
      obj.position.lerpVectors(a, b, k); const dx = b.x - a.x, dz = b.z - a.z; if (dx || dz) obj.rotation.y = Math.atan2(dx, dz);
    }, done);
  }
  function runRobot() {
    if (robotBusy || !robotJobs.length) return;
    robotBusy = true; const job = robotJobs.shift(), x = DEST_X[job.dest] != null ? DEST_X[job.dest] : 4;
    const out = [P.home.clone(), new V(x, 0, 1), new V(x, 0, -2.4)];
    robot.userData.parcel.visible = true; setRobot(job.hacked ? "hacked" : "ok");
    moveAlong(robot, out, 9, () => {
      if (job.hacked) pop("HACKED!", "#a3261b", new V(x, 4.5, -2), true);
      tween(job.hacked && !reduce ? 0.9 : 0.4, p => { if (job.hacked && !reduce) robot.rotation.y += 0.35; }, () => {
        robot.userData.parcel.visible = false;
        moveAlong(robot, out.slice().reverse(), 9, () => { robot.rotation.y = 0.3; setRobot("ok"); robotBusy = false; runRobot(); });
      });
    });
  }

  // ---------- public API ----------
  const api = {
    get ready() { return ready; },
    init(c) {
      canvas = c;
      try { renderer = new THREE.WebGLRenderer({canvas, antialias: true}); } catch (e) { return false; }
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setClearColor(0xe1e8e3);
      scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xe1e8e3, 60, 120);
      camera = new THREE.PerspectiveCamera(42, 1, 0.1, 250);
      buildWorld(); api.resize(); ready = true;
      const ro = window.ResizeObserver ? new ResizeObserver(() => api.resize()) : null; if (ro) ro.observe(canvas.parentElement); else window.addEventListener("resize", api.resize);
      let drag = null;
      canvas.addEventListener("pointerdown", e => { drag = {x: e.clientX, y: e.clientY}; canvas.setPointerCapture(e.pointerId); });
      const clampGoal = () => { goal.theta = Math.max(-1.4, Math.min(1.4, goal.theta)); goal.phi = Math.max(0.25, Math.min(1.35, goal.phi)); goal.r = Math.max(6, Math.min(60, goal.r)); };
      canvas.addEventListener("pointermove", e => { if (!drag) return; goal.theta -= (e.clientX - drag.x) * 0.006; goal.phi -= (e.clientY - drag.y) * 0.004; clampGoal(); drag = {x: e.clientX, y: e.clientY}; });
      canvas.addEventListener("pointerup", () => { drag = null; });
      canvas.addEventListener("wheel", e => { e.preventDefault(); goal.r += e.deltaY * 0.02; clampGoal(); }, {passive: false});
      canvas.addEventListener("keydown", e => {
        const k = {ArrowLeft: () => goal.theta -= 0.08, ArrowRight: () => goal.theta += 0.08, ArrowUp: () => goal.phi -= 0.06, ArrowDown: () => goal.phi += 0.06, "+": () => goal.r -= 2, "-": () => goal.r += 2, Home: () => Object.assign(goal, VIEWS.ward)}[e.key];
        if (k) { k(); clampGoal(); e.preventDefault(); }
      });
      requestAnimationFrame(loop); return true;
    },
    resize() {
      if (!renderer) return; const r = canvas.parentElement.getBoundingClientRect(); const w = Math.max(200, r.width), h = Math.max(200, r.height);
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      cam.fit = Math.max(1, Math.min(2.6, 1.5 / camera.aspect));   // narrow screens: pull the camera back so the whole ward stays visible
    },
    // A request travels from "nurse" or "hacker" to the gate. passed=false: stopped at the gate. passed=true: goes on to the robot.
    request(o) {
      if (!ready) { if (o.arrive) o.arrive(); return; }
      const from = o.from === "hacker" ? new V(P.hacker.x - 1, 2.4, P.hacker.z) : new V(P.nurse.x + 1, 2.4, P.nurse.z);
      const gate = new V(P.gate.x, 1.9, P.gate.z + 0.4), color = o.from === "hacker" ? (o.color || RED) : GREEN;
      packet(from, gate, color, o.fast ? 0.35 : 0.6, () => {
        if (!o.passed) { gateFlash(RED); if (!o.quiet) { burst(new V(P.gate.x, 1.9, P.gate.z + 0.6), RED); pop(o.text || "BLOCKED", "#a3261b", new V(P.gate.x, 4.6, P.gate.z)); } if (o.arrive) o.arrive(); return; }
        gateFlash(o.from === "hacker" ? RED : GREEN);
        if (o.noRobot) { if (!o.quiet) pop(o.text || "OK", o.from === "hacker" ? "#a3261b" : "#17674c", new V(P.gate.x, 4.6, P.gate.z)); if (o.arrive) o.arrive(); return; }
        packet(gate, new V(P.home.x + 1, 1.6, P.home.z + 1), color, o.fast ? 0.5 : 0.9, () => { if (o.arrive) o.arrive(); });
      });
    },
    // A message coming BACK from the (possibly hacked) robot. passed=true means the gate let the bad message in.
    robotMessage(o) {
      if (!ready) { if (o.arrive) o.arrive(); return; }
      const from = new V(P.home.x + 1, 2.2, P.home.z + 1), gate = new V(P.gate.x, 1.9, P.gate.z + 0.4);
      if (!robotBusy) setRobot("hacked");
      packet(from, gate, RED, 0.9, () => {
        gateFlash(o.passed ? RED : GREEN);
        if (!o.passed) burst(new V(P.gate.x, 1.9, P.gate.z + 0.6), GREEN);
        pop(o.text || (o.passed ? "WARD RECORDS CORRUPTED" : "DROPPED"), o.passed ? "#a3261b" : "#17674c", new V(P.gate.x, 4.6, P.gate.z));
        tween(1.2, () => {}, () => { if (!robotBusy) setRobot("ok"); });
        if (o.arrive) o.arrive();
      });
    },
    robotDeliver(dest, hacked) { if (!ready) return; if (robotJobs.length < 4) { robotJobs.push({dest, hacked: !!hacked}); runRobot(); } },
    manualDeliver(dest) {
      if (!ready || runners >= 3) return; runners++;
      const x = DEST_X[dest] != null ? DEST_X[dest] : 4, g = new THREE.Group();
      g.add(mesh(THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.35, 0.7, 4, 10) : new THREE.CylinderGeometry(0.35, 0.35, 1.1, 10), M(0xffa94d), 0, 0.9, 0));
      g.add(mesh(new THREE.SphereGeometry(0.3, 12, 10), M(0xffd9b8), 0, 1.75, 0)); g.add(mesh(new THREE.BoxGeometry(0.4, 0.3, 0.4), M(0xd9a441), 0, 1.0, 0.45));
      const t = label("by hand", {size: 30, color: "#98421a"}); t.position.y = 2.6; g.add(t);
      g.position.set(P.nurse.x + 2, 0, P.nurse.z - 2); scene.add(g);
      moveAlong(g, [new V(P.nurse.x + 2, 0, P.nurse.z - 2), new V(P.nurse.x + 2, 0, 2.9), new V(x, 0, 2.9), new V(x, 0, -2.4)], 8, () => { tween(0.5, () => {}, () => { scene.remove(g); dispose(g); runners--; }); });
    },
    view(name) { if (VIEWS[name]) Object.assign(goal, VIEWS[name]); },
    setIsolated(b) { if (b === isolated) return; isolated = b; if (!ready) return; dome.visible = b; isoLabel.visible = b; cable.material.color.setHex(b ? 0x8a978f : GREEN); cable.visible = !b; gateColor(gateBase()); },
    hackerSay(text) {
      if (!ready) return;
      if (hackerBubble) { scene.remove(hackerBubble); dispose(hackerBubble); }
      const s = label(text, {size: 40, color: "#14202b", bg: "rgba(255,255,255,.95)"}); s.position.set(P.hacker.x - 2, 8.6, P.hacker.z - 0.6); scene.add(s); hackerBubble = s;
      tween(1.8, p => { if (p > 0.85) s.material.opacity = (1 - p) / 0.15; }, () => { if (hackerBubble === s) hackerBubble = null; scene.remove(s); dispose(s); });
    },
    hackerTyping(b) { hackerTyping = b; },
    nurseWave() { if (!ready) return; tween(0.9, p => { nurse.userData.arm.rotation.z = -2.4 + Math.sin(p * 18) * 0.4 * (1 - p); }, () => { nurse.userData.arm.rotation.z = -0.3; }); },
    reset() { robotJobs = []; robotBusy = false; if (ready) { robot.position.copy(P.home); robot.rotation.y = 0.3; setRobot("ok"); robot.userData.parcel.visible = false; } api.setIsolated(false); }
  };

  function loop(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000 || 0.016); lastT = now; time += dt;
    for (let i = tweens.length - 1; i >= 0; i--) { const tw = tweens[i]; tw.t += dt; const p = Math.min(1, tw.t / tw.dur); tw.fn(p); if (p >= 1) { tweens.splice(i, 1); if (tw.done) tw.done(); } }
    if (!reduce) {
      nurse.position.y = 0.3 + Math.sin(time * 2) * 0.04; hacker.position.y = 0.5 + Math.sin(time * 2.4 + 1) * 0.05;
      const u = hacker.userData;
      u.arms.forEach((a, i) => { a.rotation.x = -1.0 + (hackerTyping ? Math.sin(time * 22 + i * 2) * 0.28 : 0); });
      u.head.rotation.z = Math.sin(time * 1.5) * 0.04;
    }
    hacker.userData.glow.material.opacity = hackerTyping ? 0.45 + Math.sin(time * 20) * 0.2 : 0.2;
    if (isolated && !reduce) dome.material.opacity = 0.07 + Math.sin(time * 3) * 0.03;
    const k = reduce ? 1 : 1 - Math.exp(-dt * 5);   // ease the camera toward its goal (instant with reduced motion)
    for (const key of ["theta", "phi", "r", "tx", "ty", "tz"]) cam[key] += (goal[key] - cam[key]) * k;
    const t = new V(cam.tx, cam.ty, cam.tz);
    const R = cam.r * (goal.r > 20 ? (cam.fit || 1) : 1);   // pull back on narrow screens, but not for the close-up views
    camera.position.set(t.x + R * Math.sin(cam.phi) * Math.sin(cam.theta), t.y + R * Math.cos(cam.phi), t.z + R * Math.sin(cam.phi) * Math.cos(cam.theta));
    camera.lookAt(t);
    labels = labels.filter(s => s.parent);   // drop labels that were removed from the scene
    const f = Math.max(0.3, Math.min(1.15, R / 42));
    for (const s of labels) s.scale.set(s.userData.base[0] * f, s.userData.base[1] * f, 1);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  return api;
})();
