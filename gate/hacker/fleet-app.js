"use strict";
// Live hack demo on the real fleet console. Every allow/block decision comes from the real gate code
// (RWGate = gate/gate.cjs running in the browser). Orders the gate lets through become real fleet commands.
//
// How the demo behaves:
//  - Routine nurse tasks run automatically: nurse -> gate -> a free robot drives there, the ward receipt is confirmed automatically.
//  - Robots also do their own autonomous jobs (return to base, routine runs). These are tagged "Auto", not "Nurse".
//  - A suspicious task (the gate refuses it for an identity or permission reason) is HELD: it needs authorization from the
//    ward/unit that owns the destination. Authorized -> it runs. Not authorized in time -> it is not run and saved to the log.
//  - Hacker requests never carry that authorization, so they end up in the log.
//  - When the breaker (M4) trips, robots pause for a short containment window, then the system reconnects them automatically.
//    The attacker's address stays quarantined.
(function () {
  const {Gate, makeWorld, issueToken, PATIENT_NAMES} = RWGate;
  const H = window.RWHooks;
  const $ = id => document.getElementById("hk-" + id);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const now = () => performance.now();
  const T0 = 1000000, CAPACITY = 20;
  const CONTAIN_MS = 4000;     // robots stay cut off this long after the breaker trips, then the system reconnects them
  const HOLD_MS = 12000;       // a held task waits this long for authorization, then it is logged as unauthorized
  const NURSE_EVERY_MS = 6500, CROSS_WARD_SHARE = 0.25;
  const CONFIGS = {M0: {}, M1: {M1: true}, M2: {M2: true}, M3: {M3: true}, M4: {M4: true}, ALL: {M1: true, M2: true, M3: true, M4: true}};
  const DEF_TEXT = {
    M0: "No real protection. The gate only checks that the task number exists, so anyone can order the robots.",
    M1: "Signed, single-use tickets. Forged, expired, changed and reused orders need authorization.",
    M2: "Role and ward rules. Orders outside a person's ward need authorization from that ward.",
    M3: "Data minimisation. Robots only get the task number and destination; extra fields are refused.",
    M4: "Containment. Floods and repeated bad requests trip a breaker; robots pause, then reconnect automatically.",
    ALL: "All four defences together (M1 + M2 + M3 + M4)."};
  // The gate's destinations are the fleet console's stations.
  const DEST_TO_STATION = {"Room 12": "WARD-A", "Room 7": "WARD-B", "Pharmacy": "PHARMACY", "Lab": "LAB", "Storage": "STORES"};
  const STATION_TO_DEST = {"WARD-A": "Room 12", "WARD-B": "Room 7", "PHARMACY": "Pharmacy", "LAB": "Lab", "STORES": "Storage", "COLLECTION": "Lab"};
  const USER_FOR = {"WARD-A": ["N1", "med"], "WARD-B": ["N2", "med"], "PHARMACY": ["N1", "med"], "LAB": ["N2", "specimen"], "STORES": ["P1", "linen"], "COLLECTION": ["N2", "specimen"]};
  const AUTHORITY = {"Room 12": "Ward A", "Room 7": "Ward B", "Pharmacy": "Pharmacy", "Lab": "Lab", "Storage": "Supply store"};
  const AUTHORIZER = {"Ward A": "N1", "Ward B": "N2"};          // who signs an authorization for that ward (a nurse of that ward)
  const HOME = {"RX-01": "PHARMACY", "LAB-02": "COLLECTION", "SUP-03": "STORES"};
  const ROUTINE = {"RX-01": ["WARD-B", "Medication round"], "LAB-02": ["LAB", "Specimen run"], "SUP-03": ["WARD-A", "Supply restock"]};
  // The extra robots (4 to 10) park in their own bay and patrol their own checkpoint.
  const homeOf = r => HOME[r.id] || r.home, routineOf = r => ROUTINE[r.id] || [String(r.home).replace("BAY", "CHK"), "Patrol"];
  const KNOWN = [["T1", "Room 12"], ["T2", "Pharmacy"], ["T3", "Lab"]];   // task and destination pairs that nurse N1 is allowed to order
  // Gate refusals that mean "this needs authorization" (identity or permission), in plain words.
  const AUTH_REASONS = {
    "missing token": "no ticket", "malformed token": "broken ticket", "bad signature": "forged ticket", "expired token": "expired ticket",
    "token does not match request": "ticket for a different order", "replayed token": "ticket already used",
    "unknown or revoked user": "account removed", "destination outside user's ward": "outside the sender's ward",
    "role not allowed for task type": "role not allowed for this task", "not task owner": "not the task owner",
    "unknown field rejected": "hidden extra data", "unknown task": "unknown task number"};

  let world, gate, clock, startMs, cfgKey = "ALL", st, lastLegit, taskN = 0, cmdN = 0, holdN = 0, tampered = false;
  let hackerOn = false, hackTimer = null, autoOn = true, autoTimer = null, floodTimer = null, floodStats = null;
  let hackerSrc = "HACKER-1", srcN = 1, quarantinedAt = 0, containTimer = null, wasIso = false, shedSinceLog = 0;
  let jobs = {}, holds = [], idleSince = {}, arrivedAt = {}, exampleAt = {}, lastCmd = {}, ours = new Set(), toResume = new Set();
  let traffic = null, planned = new Map(), plannedAt = new Map(), waitSince = {}, retireSince = {}, fleetWanted = 3, fleetTimer = null;

  const tick = () => { clock.t = T0 + (now() - startMs); };
  const elapsed = () => { const s = Math.floor((now() - startMs) / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const rawSnap = () => window.fleetConsole && window.fleetConsole.snapshot;   // all ten robots, on duty or not
  const snap = () => { const s = rawSnap(); return s && Object.assign({}, s, {robots: s.robots.filter(r => r.active !== false)}); };   // the robots on duty
  const stationName = k => (H.env && H.env.network.stations[k] && H.env.network.stations[k].name) || k;
  const esc = x => String(x).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  function log(cls, text) {
    const li = document.createElement("li"); li.className = cls;
    const t = document.createElement("time"); t.textContent = elapsed(); li.append(t, document.createTextNode(text));
    const ul = $("log"); ul.insertBefore(li, ul.firstChild); while (ul.children.length > 80) ul.removeChild(ul.lastChild);
  }
  const note = (id, text) => { const e = $(id); e.textContent = text; clearTimeout(e._t); e._t = setTimeout(() => { e.textContent = ""; }, 3500); };
  const fleetSend = cmd => { if (H.rawPost) H.rawPost({type: "command", command: cmd}); };
  const newId = prefix => prefix + String(++cmdN).padStart(4, "0");
  // Fleet commands go out on a fixed short delay, so the robots never depend on how fast the 3D animation runs.
  const later = fn => setTimeout(fn, 1100);
  function throttled(robot, action, ms) { const k = robot + action; if (lastCmd[k] && now() - lastCmd[k] < ms) return false; lastCmd[k] = now(); return true; }

  // ---------- fleet helpers ----------
  const isFree = r => !r.mission && !r.isolated && !r.alert && !r.example && !r.retire && !(jobs[r.id] && now() - jobs[r.id].at < 3000);
  function takenStations(s) { return new Set(s.robots.map(r => r.mission ? r.mission.dest : (jobs[r.id] && !r.mission ? jobs[r.id].dest : r.station)).filter(Boolean)); }
  const shuffled = a => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(p => p[1]);

  // ---------- traffic: never send a robot into a jam ----------
  // The fleet controller cannot cancel a mission stuck waiting for lanes, and two robots that need each other's lane block each other
  // for good. So a robot is only sent when a complete route is free right now (see fleet-traffic.js), counting routes ordered a moment ago.
  function routeFor(robotId, station) {
    const s = rawSnap(); if (!s || !H.env) return null;
    traffic = traffic || FleetTraffic.make(H.env.network);
    for (const [id, at] of [...plannedAt]) {                       // forget planned routes once the controller has reserved them
      const r = s.robots.find(x => x.id === id);
      if (!r || r.path.length || now() - at > 4000 || (!r.mission && now() - at > 3000)) { planned.delete(id); plannedAt.delete(id); }
    }
    return traffic.routeFree(s.robots, robotId, station, planned);
  }
  const claimRoute = (robotId, route) => { planned.set(robotId, new Set(route)); plannedAt.set(robotId, now()); };
  function freeRobotFor(s, station) {
    const options = s.robots.filter(r => isFree(r) && r.station !== station).map(r => [r, routeFor(r.id, station)]).filter(([, route]) => route);
    if (!options.length) return null;
    const [r, route] = pick(options); claimRoute(r.id, route); return r.id;
  }
  const TAG_TEXT = {nurse: "Nurse", auto: "Auto", hacker: "Hacker!", operator: "Operator"};
  function dispatch(robot, station, job) {
    const route = routeFor(robot, station);
    if (!route) {   // the lanes changed during the short delay: do not send the robot
      delete jobs[robot]; DemoLayer.setTask(robot, null);
      if (job.kind === "nurse" || job.kind === "operator") { st.manual++; log("info", "The lanes to " + stationName(station) + " were busy, so that task is carried by hand."); DemoLayer.manualDeliver(station === "PHARMACY" ? "STORES" : "PHARMACY", station); }
      else if (job.kind === "hacker") log("info", "Hacker: the hijacked robot had no free route, so nothing moved.");
      return false;
    }
    claimRoute(robot, route);
    fleetSend({id: newId(job.kind[0].toUpperCase()), robot, action: "dispatch", destination: station});
    jobs[robot] = Object.assign({dest: station, at: now()}, job);
    DemoLayer.setTask(robot, TAG_TEXT[job.kind] + " · " + (job.label || stationName(station)), job.kind);
    return true;
  }

  // ---------- breaker: automatic containment and recovery ----------
  function syncIso() {
    DemoLayer.setIsolated(gate.isolated);
    if (!gate.isolated || wasIso) return;
    wasIso = true;
    const s = snap();
    if (s) for (const r of s.robots) if (!r.isolated) { if (r.mission && r.mission.stage === "travel") toResume.add(r.id); ours.add(r.id); fleetSend({id: newId("G"), robot: r.id, action: "isolate"}); }
    log("warn", "Breaker tripped: repeated bad requests from " + [...gate.blocked].join(", ") + ". Robots paused and cut off for " + CONTAIN_MS / 1000 + " s; nurse tasks go by hand.");
    clearTimeout(containTimer); containTimer = setTimeout(recover, CONTAIN_MS);
    refresh();
  }
  function recover() {
    if (!gate.isolated) return;
    const attackers = [...gate.blocked].filter(x => x.startsWith("HACKER"));
    tick(); gate.reset("S1");                           // automatic security review, signed by supervisor S1 (real gate API, in the audit chain)
    for (const a of attackers) gate.blocked.add(a);     // the attacker's address stays quarantined; only checked when M4 is on
    wasIso = false; quarantinedAt = now(); DemoLayer.setIsolated(false);
    log("good", "Automatic review: " + (attackers.length ? "attacker address " + attackers.join(", ") + (attackers.length > 1 ? " stay" : " stays") + " quarantined. " : "") + "Robots reconnected and back at work.");
    refresh();
  }

  // ---------- nurse ----------
  function nurseTask(crossWard, manualClick) {
    const s = snap(); if (!s || !gate) { if (manualClick) note("nurse-note", "The fleet console is still starting."); return; }
    const taken = takenStations(s);
    let station, user, type;
    if (crossWard) {
      const opts = [["WARD-A", "N2"], ["WARD-B", "N1"]].filter(([k]) => gate.isolated || !taken.has(k));
      if (!opts.length) { if (manualClick) note("nurse-note", "Both wards are busy. Try again in a moment."); return; }
      [station, user] = pick(opts); type = "med";
    } else {
      const opts = Object.keys(STATION_TO_DEST).filter(k => gate.isolated || !taken.has(k));
      if (!opts.length) { if (manualClick) note("nurse-note", "All destinations are busy. Try again in a moment."); return; }
      station = pick(opts); [user, type] = USER_FOR[station];
    }
    const robot = gate.isolated ? null : freeRobotFor(s, station);
    if (!gate.isolated && !robot) { if (manualClick) note("nurse-note", "All robots are busy. Try again in a moment."); return; }
    submit({user, type, station, robot, who: "Nurse " + user});
  }
  // A task request through the gate. o: {user, type, station, robot, who, cmd?} (cmd: the console's own Dispatch command)
  function submit(o) {
    tick();
    const dest = STATION_TO_DEST[o.station], id = "L" + (++taskN);
    world.tasks[id] = {dest, type: o.type, owner: o.user, status: "REGISTERED"};
    const req = {type: "deliver", user: o.user, task_id: id, destination: dest, token: issueToken(o.user, id, dest, clock.t), source: "WARD-" + o.user};
    const res = gate.handle(req);
    syncIso(); DemoLayer.nurseWave();
    if (res.ok && res.mode === "robot") {
      lastLegit = Object.assign({}, req); st.sent++;
      if (o.robot) jobs[o.robot] = {kind: o.cmd ? "operator" : "nurse", dest: o.station, at: now(), who: o.user};   // reserve the robot now
      DemoLayer.nurseSay(o.robot + ", to " + stationName(o.station) + " please");
      DemoLayer.request({from: "nurse", passed: true, target: o.robot});
      later(() => dispatch(o.robot, o.station, {kind: o.cmd ? "operator" : "nurse", who: o.user}));
    } else if (res.ok) {
      st.manual++; log("info", o.who + "'s task to " + stationName(o.station) + " is carried by hand while the robots are cut off.");
      DemoLayer.request({from: "nurse", passed: true, noRobot: true, text: "BY HAND"});
      DemoLayer.manualDeliver(o.station === "PHARMACY" ? "STORES" : "PHARMACY", o.station);
    } else if (AUTH_REASONS[res.reason]) hold(o, res.reason);
    else { log("warn", o.who + "'s task was not accepted (" + res.reason + "). Saved to the log."); DemoLayer.request({from: "nurse", passed: false, text: "NOT ACCEPTED"}); }
    if (o.cmd && !(res.ok && res.mode === "robot")) declineInConsole(o.cmd, res.ok ? "Robots are cut off. Deliver by hand." : "Held by the gate: " + (AUTH_REASONS[res.reason] || res.reason));
    refresh();
  }
  function hold(o, reason) {
    const dest = STATION_TO_DEST[o.station], authority = AUTHORITY[dest];
    const h = Object.assign({}, o, {id: ++holdN, reason, authority, authorizer: AUTHORIZER[authority], until: now() + HOLD_MS});
    holds.push(h); st.held++;
    log("warn", o.who + " asked for a delivery to " + stationName(o.station) + ": " + AUTH_REASONS[reason] + ". Held until " + authority + " authorizes it.");
    DemoLayer.request({from: "nurse", passed: false, hold: true, text: "NEEDS " + authority.toUpperCase() + " AUTHORIZATION"});
    renderHolds();
  }
  function takeHold(id) { const i = holds.findIndex(h => h.id === id); return i < 0 ? null : holds.splice(i, 1)[0]; }
  function authorize(id) {
    const h = takeHold(id); if (!h) return;
    renderHolds();
    if (!h.authorizer) { log("warn", "Nobody can sign for " + h.authority + " in this demo. Task saved to the log."); st.logged++; return; }
    // The authorizer signs a fresh ticket for the same delivery; the gate checks that ticket and that ward like any other request.
    tick();
    const dest = STATION_TO_DEST[h.station], tid = "L" + (++taskN);
    world.tasks[tid] = {dest, type: h.type, owner: h.authorizer, status: "REGISTERED"};
    const res = gate.handle({type: "deliver", user: h.authorizer, task_id: tid, destination: dest, token: issueToken(h.authorizer, tid, dest, clock.t), source: "WARD-" + h.authorizer});
    syncIso();
    if (res.ok && res.mode === "robot") {
      const s = snap(); let robot = h.robot;
      if (!robot || !s || !isFree(s.robots.find(r => r.id === robot) || {})) robot = s ? freeRobotFor(s, h.station) : null;
      st.authorized++; st.sent++;
      if (!robot) { log("good", h.authority + " (" + h.authorizer + ") authorized " + h.who + "'s task. No robot is free, so it is carried by hand."); st.manual++; DemoLayer.manualDeliver("PHARMACY", h.station); }
      else {
        log("good", h.authority + " (" + h.authorizer + ") authorized " + h.who + "'s task. " + robot + " takes it to " + stationName(h.station) + ".");
        jobs[robot] = {kind: "nurse", dest: h.station, at: now(), who: h.user};
        DemoLayer.gateToRobot(robot);
        later(() => dispatch(robot, h.station, {kind: "nurse", who: h.user, label: stationName(h.station) + " (authorized)"}));
      }
    } else if (res.ok) { st.authorized++; st.manual++; log("good", h.authority + " authorized it. The robots are cut off, so it is carried by hand."); DemoLayer.manualDeliver("PHARMACY", h.station); }
    else { st.logged++; log("bad", "The gate refused the authorization too (" + res.reason + "). Saved to the log."); }
    refresh();
  }
  function reject(id, timedOut) {
    const h = takeHold(id); if (!h) return;
    tick(); gate.log("unauthorized-task", {by: h.user, destination: STATION_TO_DEST[h.station], authority: h.authority});
    st.logged++;
    log("bad", "No " + h.authority + " authorization " + (timedOut ? "arrived" : "given") + ": " + h.who + "'s task was not run and is saved to the audit log.");
    renderHolds(); refresh();
  }
  function renderHolds() {
    const box = $("holds");
    if (!holds.length) { box.innerHTML = ""; return; }
    box.innerHTML = holds.map(h => {
      const left = Math.max(0, h.until - now()), pct = Math.round(left / HOLD_MS * 100);
      return '<div class="hk-hold" data-hold="' + h.id + '"><p><b>' + esc(h.who) + " &rarr; " + esc(stationName(h.station)) + "</b> needs <b>" + esc(h.authority) + "</b> authorization <span>(" + esc(AUTH_REASONS[h.reason]) + ")</span></p>" +
        '<div class="hk-hold-actions"><button type="button" class="primary" data-act="ok">Authorize as ' + esc(h.authority) + '</button><button type="button" data-act="no">Reject</button>' +
        '<span class="hk-timer" aria-label="' + Math.ceil(left / 1000) + ' seconds left"><i style="width:' + pct + '%"></i></span></div></div>';
    }).join("");
  }
  function declineInConsole(c, reason) {   // tell the console's own panel why its Dispatch order did not go straight through
    const w = H.worker, s = rawSnap();
    if (w && typeof w.onmessage === "function" && s) w.onmessage({data: Object.assign({}, s, {acks: [{id: c.id, robot: c.robot, ok: false, reason}], events: []})});
  }
  function consoleOrder(msg, forward) {    // orders from the console's own Dispatch button are gated too
    const c = msg.command;
    if (!gate || c.action !== "dispatch" || !STATION_TO_DEST[c.destination]) return forward();   // other console buttons are operator controls
    const [user, type] = USER_FOR[c.destination];
    tick();
    const dest = STATION_TO_DEST[c.destination], id = "L" + (++taskN);
    world.tasks[id] = {dest, type, owner: user, status: "REGISTERED"};
    const res = gate.handle({type: "deliver", user, task_id: id, destination: dest, token: issueToken(user, id, dest, clock.t), source: "WARD-" + user});
    syncIso();
    if (res.ok && res.mode === "robot") { st.sent++; jobs[c.robot] = {kind: "operator", dest: c.destination, at: now(), who: user}; DemoLayer.setTask(c.robot, "Operator · " + stationName(c.destination), "operator"); forward(); }
    else if (res.ok) { st.manual++; declineInConsole(c, "Robots are cut off. Deliver by hand."); DemoLayer.manualDeliver("PHARMACY", c.destination); }
    else { declineInConsole(c, "Blocked by the gate: " + res.reason); log("warn", "Console order to " + stationName(c.destination) + " refused (" + res.reason + ")."); }
    refresh();
  }

  // ---------- hacker ----------
  function mk(user, task, dest, extra) {
    return Object.assign({type: "deliver", user, task_id: task, destination: dest, token: issueToken(user, task, dest, clock.t), source: hackerSrc}, extra || {});
  }
  const ATTACKS = {
    noTicket: {say: "No ticket? No problem!", name: "Order with no ticket", build() { const [t, d] = pick(KNOWN), r = mk("N1", t, d); delete r.token; return r; }},
    forged: {say: "I made my own ticket!", name: "Forged ticket", build() { const [t, d] = pick(KNOWN), r = mk("N1", t, d); r.token = r.token.slice(0, -4) + "AAAA"; return r; }},
    expired: {say: "This old ticket still works... right?", name: "Expired ticket", build() { const [t, d] = pick(KNOWN), r = mk("N1", t, d); r.token = issueToken("N1", t, d, clock.t - 600000, 300000); return r; }},
    replay: {say: "Copy and paste!", name: "Copied order sent again", needs: () => !!lastLegit, build() { return Object.assign({}, lastLegit, {source: hackerSrc}); }},
    wrongWard: {say: "Borrowed badge!", name: "Borrowed badge, wrong ward", build() { return mk("N2", "T1", "Room 12"); }},
    tamper: {say: "Change the address!", name: "Order with a changed address", build() { const r = mk("N1", "T1", "Room 12"); r.destination = "Pharmacy"; return r; }},
    leak: {say: "Tell me the patient names!", name: "Order with a hidden patient name", build() { return mk("N1", "T1", "Room 12", {patient_name: pick(PATIENT_NAMES)}); }},
    unknown: {say: "Task 99, I guess?", name: "Made-up task number", build() { return mk("N1", "T99", "Room 12"); }},
    fired: {say: "I still have my old login!", name: "Login of a former employee", build() { return mk("N3", "T1", "Room 12"); }},
    flood: {say: "FLOOD!", name: "Flood of orders", special: "flood"},
    robot: {say: "I'm taking over a robot!", name: "Hacked robot sends forged messages", special: "robot"}
  };
  const WEIGHTED = ["noTicket", "forged", "expired", "replay", "wrongWard", "tamper", "leak", "unknown", "fired", "flood", "robot"];
  const lastHack = (cls, text) => { const e = $("last"); e.textContent = text; e.className = "hk-note " + cls; };

  function hijackTarget(preferred) {   // a free robot and a station it can reach right now, so a hijacked order visibly moves a robot
    const s = snap(); if (!s) return null;
    const taken = takenStations(s), order = [preferred].concat(shuffled(Object.keys(STATION_TO_DEST)));
    for (const r of shuffled(s.robots.filter(isFree))) for (const station of order) {
      if (station === r.station || taken.has(station)) continue;
      const route = routeFor(r.id, station);
      if (route) return {robot: r.id, station, route};
    }
    return null;
  }
  function hack(kind) {
    if (!gate) return;
    rotateIfQuarantined();
    const keys = WEIGHTED.filter(k => !ATTACKS[k].needs || ATTACKS[k].needs());
    const id = kind || pick(keys), a = ATTACKS[id];
    if (id === "flood" && floodTimer) return;
    DemoLayer.hackerSay(a.say); typing(1300);
    if (a.special === "flood") return startFlood();
    if (a.special === "robot") return hackRobot();
    tick();
    const req = a.build(), res = gate.handle(req);
    syncIso(); st.attempts++;
    const authority = AUTHORITY[req.destination] || "Ward A", s = snap();
    const hij = res.ok && res.mode === "robot" ? hijackTarget(DEST_TO_STATION[req.destination] || "WARD-A") : null;
    const free = s ? s.robots.filter(isFree) : [], target = hij ? hij.robot : (free.length ? pick(free).id : "RX-01");
    if (!res.ok) {
      st.stopped++;
      if (res.shed) { shedSinceLog++; lastHack("ok", a.name + ": dropped, the hacker's address is quarantined."); if (shedSinceLog === 1) log("good", "Quarantined address " + hackerSrc + " keeps trying. Its requests are dropped unchecked."); }
      else if (AUTH_REASONS[res.reason]) { lastHack("ok", a.name + ": needs " + authority + " authorization. None, so it is logged."); log("good", "Hacker: " + a.name + (a.name.toLowerCase() === AUTH_REASONS[res.reason] ? "" : " (" + AUTH_REASONS[res.reason] + ")") + ". Needs " + authority + " authorization; none presented. Saved to the log."); }
      else { lastHack("ok", a.name + ": stopped (" + res.reason + ")."); log("good", "Hacker: " + a.name + " stopped (" + res.reason + ")."); }
    } else if (res.mode === "manual") { st.through++; lastHack("bad", a.name + ": got through, but robots are cut off."); log("bad", "Hacker: " + a.name + " got through the gate, but the robots are cut off, so nothing moved."); }
    else if (!hij) { st.through++; lastHack("bad", a.name + ": got through the gate, but no robot had a free route."); log("bad", "Hacker: " + a.name + " got through the gate, but no robot had a free route, so nothing moved."); }
    else { st.through++; lastHack("bad", a.name + ": got through! " + target + " obeys the hacker."); log("bad", "Hacker: " + a.name + " got through. " + target + " obeys the hacker."); }
    refresh();
    DemoLayer.request({
      from: "hacker", passed: res.ok, noRobot: res.ok && res.mode === "manual", target,
      text: res.ok ? "ACCEPTED" : res.shed ? "QUARANTINED" : AUTH_REASONS[res.reason] ? "NO " + authority.toUpperCase() + " AUTHORIZATION" : "BLOCKED",
      arrive() { if (!res.ok) DemoLayer.hackerRage(); }
    });
    if (hij) { claimRoute(hij.robot, hij.route); jobs[target] = {kind: "hacker", dest: hij.station, at: now()}; ours.add(target); later(() => dispatch(target, hij.station, {kind: "hacker", label: "hijacked"})); }
  }
  function rotateIfQuarantined() {
    if (gate.blocked.has(hackerSrc) && now() - quarantinedAt > 10000) {
      hackerSrc = "HACKER-" + (++srcN); shedSinceLog = 0;
      log("warn", "The hacker switched to a new network address (" + hackerSrc + ").");
    }
  }
  function typing(ms) { DemoLayer.hackerTyping(true); setTimeout(() => DemoLayer.hackerTyping(hackerOn || !!floodTimer), ms); }
  function hackRobot() {
    tick();
    const s = snap(), target = s ? pick(s.robots.filter(r => !r.example && !r.isolated && !r.alert).concat(s.robots[0])).id : "RX-01";
    const res = gate.robotMessage({task_id: "T1", status: "DELIVERED", owner: "ATK", admin: true, pad: "x".repeat(5000)});
    st.attempts++;
    if (res.ok) { st.through++; lastHack("bad", "Hacked robot: ward records overwritten."); log("bad", "Hacker: forged messages from " + target + " got in. Ward records overwritten; " + target + " starts spinning and the fleet monitor puts it on hold."); }
    else { st.stopped++; lastHack("ok", "Hacked robot: forged messages dropped."); log("good", "Hacker: forged messages from " + target + " were dropped (wrong size and fields)."); }
    refresh();
    DemoLayer.robotMessage({passed: res.ok, target});
    if (res.ok) later(() => { ours.add(target); exampleAt[target] = now(); fleetSend({id: newId("H"), robot: target, action: "example", example: "spin"}); });
  }
  function startFlood() {
    if (floodTimer) return;
    const until = now() + 4000; let n = 0; floodStats = {n: 0, blocked: 0, through: 0};
    floodTimer = setInterval(() => {
      if (now() > until) { stopFlood(true); return; }
      for (let i = 0; i < 4; i++) {
        tick();
        const res = gate.handle({type: "deliver", user: "N1", task_id: "T1", destination: "Room 12", source: hackerSrc});
        floodStats.n++; st.attempts++; if (res.ok) { floodStats.through++; st.through++; } else { floodStats.blocked++; st.stopped++; }
        if (n++ % 6 === 0) DemoLayer.request({from: "hacker", passed: res.ok, noRobot: true, quiet: true, fast: true});
      }
      syncIso(); refresh();
    }, 100);
  }
  function stopFlood(report) {
    clearInterval(floodTimer); floodTimer = null;
    if (report && floodStats && floodStats.n) {
      lastHack(floodStats.through ? "bad" : "ok", "Flood: " + floodStats.blocked + " of " + floodStats.n + " stopped.");
      log(floodStats.through ? "bad" : "good", "Hacker: flood of " + floodStats.n + " orders in 4 s. " + floodStats.blocked + " stopped, " + floodStats.through + " got through (none moved a robot).");
    }
    floodStats = null; DemoLayer.hackerTyping(hackerOn); refresh();
  }
  function scheduleHack() { clearTimeout(hackTimer); if (!hackerOn) return; hackTimer = setTimeout(() => { hack(); scheduleHack(); }, 1400 + Math.random() * 1800); }
  function scheduleNurse() { clearInterval(autoTimer); if (autoOn) autoTimer = setInterval(() => nurseTask(Math.random() < CROSS_WARD_SHARE, false), NURSE_EVERY_MS); }

  // ---------- automation: receipts, recovery after a hack, autonomous jobs ----------
  function maintain() {
    const s = snap(); if (!s || !gate) return;
    const t = now(), routineCap = Math.max(1, Math.floor(s.robots.length / 3));   // more robots on duty, more routine runs at once
    let routineRuns = Object.values(jobs).filter(j => j.kind === "auto" && j.routine).length;
    // Fairness: the lift and its hub corridor are often claimed by routine runs. While a robot that is leaving duty has been unable to
    // go home for 5 s, the other robots hold off on new routine runs and base returns, so a gap opens for it.
    for (const r of s.robots) { if (r.retire && !r.mission && r.station !== r.home) retireSince[r.id] = retireSince[r.id] || t; else delete retireSince[r.id]; }
    const retireStuck = s.robots.some(r => retireSince[r.id] && t - retireSince[r.id] > 5000);
    for (const r of s.robots) {
      // a robot that joins while the robot zone is cut off is cut off too
      if (gate.isolated && wasIso && !r.isolated && !ours.has(r.id) && throttled(r.id, "isolate", 2000)) { ours.add(r.id); fleetSend({id: newId("G"), robot: r.id, action: "isolate"}); }
      // watchdog: the fleet cannot cancel a stuck mission by itself, so a task that waits 30 s for a lane is cancelled
      if (r.state === "Waiting") {
        if (!waitSince[r.id]) waitSince[r.id] = t;
        else if (t - waitSince[r.id] > 30000 && throttled(r.id, "cancel", 8000)) {
          fleetSend({id: newId("C"), robot: r.id, action: "cancel"}); delete waitSince[r.id]; delete jobs[r.id]; DemoLayer.setTask(r.id, null);
          log("warn", r.id + " waited 30 s for a free lane. Its task was cancelled to clear the traffic jam.");
        }
      } else delete waitSince[r.id];
      if (r.mission && r.mission.stage === "arrived") {          // the ward scanner confirms the receipt automatically
        if (!arrivedAt[r.id]) arrivedAt[r.id] = t;
        if (t - arrivedAt[r.id] > 2500 && !r.isolated && !r.alert && throttled(r.id, "receipt", 3000)) {
          fleetSend({id: newId("R"), robot: r.id, action: "receipt"});
          const j = jobs[r.id]; if (j && (j.kind === "nurse" || j.kind === "operator")) st.done++;
        }
      } else delete arrivedAt[r.id];
      if (r.example && ours.has(r.id) && t - (exampleAt[r.id] || t) > 3000 && throttled(r.id, "end", 2000)) fleetSend({id: newId("R"), robot: r.id, action: "end"});
      if ((r.isolated || r.alert) && ours.has(r.id) && !gate.isolated && !r.example && r.canRelease && throttled(r.id, "release", 1500)) fleetSend({id: newId("R"), robot: r.id, action: "release"});
      if (!r.isolated && !r.alert && ours.has(r.id) && !gate.isolated) { if (r.paused && r.mission && r.mission.stage === "travel" && throttled(r.id, "resume", 1500)) fleetSend({id: newId("R"), robot: r.id, action: "resume"}); else if (!r.paused) { toResume.delete(r.id); if (!r.example) ours.delete(r.id); } }
      // job bookkeeping and tags
      const j = jobs[r.id];
      if (r.mission) {
        delete idleSince[r.id];
        if (!j) { jobs[r.id] = {kind: "auto", dest: r.mission.dest, at: t, label: "Scheduled run"}; DemoLayer.setTask(r.id, "Auto · Scheduled run", "auto"); }
      } else {
        if (j && t - j.at > 3000) { delete jobs[r.id]; DemoLayer.setTask(r.id, null); }
        if (!idleSince[r.id]) idleSince[r.id] = t;
      }
      // autonomous jobs while idle: go back to base, and now and then a routine run
      if (r.retire) {                                            // leaving duty: go back to the bay, the controller then takes the robot off duty
        if (!r.mission && !r.isolated && !r.alert && !r.example && !gate.isolated && !jobs[r.id] && r.station !== r.home && throttled(r.id, "retire", 2500)) dispatch(r.id, r.home, {kind: "auto", label: "Back to bay"});
      } else if (isFree(r) && !jobs[r.id] && !gate.isolated && !retireStuck) {
        const idle = t - idleSince[r.id], taken = takenStations(s), home = homeOf(r), [rStation, rLabel] = routineOf(r);
        if (r.station !== home && idle > 6000 && !taken.has(home) && throttled(r.id, "home", 3000)) dispatch(r.id, home, {kind: "auto", label: "Return to base"});
        else if (r.station === home && idle > 14000 && routineRuns < routineCap && !taken.has(rStation) && throttled(r.id, "routine", 3000) && dispatch(r.id, rStation, {kind: "auto", label: rLabel, routine: true})) routineRuns++;
      }
    }
    for (const h of holds.slice()) if (t > h.until) reject(h.id, true);
    renderHolds(); refresh();
  }

  // ---------- live checks ----------
  function leaks() {
    const inbox = JSON.stringify(world.robot.inbox), log2 = JSON.stringify(gate.audit);
    return {robot: PATIENT_NAMES.some(n => inbox.includes(n)), log: PATIENT_NAMES.some(n => log2.includes(n))};
  }
  const corrupted = () => Object.values(world.tasks).some(t => t.owner === "ATK" || "admin" in t || "pad" in t);
  function setCheck(id, text, level) { const e = $(id); e.textContent = text; e.className = "hk-val " + level; }
  function refresh() {
    if (!gate) return;
    const s = snap();
    $("n-sent").textContent = st.sent; $("n-done").textContent = st.done; $("n-held").textContent = holds.length;
    $("n-att").textContent = st.attempts; $("n-stop").textContent = st.stopped; $("n-thr").textContent = st.through;
    $("n-thr").parentElement.classList.toggle("bad", st.through > 0);
    setCheck("c-zone", gate.isolated ? "Cut off (contained)" : "Connected", gate.isolated ? "warn" : "ok");
    const l = leaks();
    setCheck("c-leak", l.robot ? "Yes: robots got patient names" : l.log ? "Yes: names written to the log" : "None", l.robot || l.log ? "bad" : "ok");
    setCheck("c-rec", corrupted() ? "Overwritten by a hacked robot" : "Intact", corrupted() ? "bad" : "ok");
    if (gate.audit.length < 4000 || !tampered) { if (!gate.verifyAudit()) tampered = true; }
    setCheck("c-audit", tampered ? "Tampering detected" : "Intact (" + gate.audit.length + " entries)", tampered ? "bad" : "ok");
    const last = world.robot.inbox[world.robot.inbox.length - 1], lastTxt = last ? JSON.stringify(last) : "nothing yet";
    $("inbox").textContent = lastTxt; $("inbox").className = "mono" + (PATIENT_NAMES.some(n => lastTxt.includes(n)) ? " bad" : "");
    if (s) $("tasks").innerHTML = s.robots.map(r => {
      const j = jobs[r.id], kind = j ? j.kind : null;
      const what = r.mission ? "&rarr; " + esc(stationName(r.mission.dest)) : "at " + esc(stationName(r.station || "") || "corridor");
      const tag = kind ? '<em class="hk-tag ' + kind + '">' + esc(kind === "nurse" || kind === "operator" ? (TAG_TEXT[kind] + (j.who ? " " + j.who : "")) : kind === "auto" ? "Auto · " + (j.label || "run") : "Hacker") + "</em>" : '<em class="hk-tag idle">Idle</em>';
      return "<li><b>" + esc(r.id) + "</b><span>" + what + "</span>" + tag + "<small>" + esc(r.state) + "</small></li>";
    }).join("");
  }

  function restart() {
    stopFlood(false); clearTimeout(hackTimer); clearTimeout(containTimer);
    world = makeWorld(); clock = {t: T0}; startMs = now(); gate = new Gate(world, CONFIGS[cfgKey], clock, CAPACITY); gate.beginSecond();
    st = {sent: 0, done: 0, held: 0, authorized: 0, logged: 0, manual: 0, attempts: 0, stopped: 0, through: 0};
    lastLegit = null; taskN = 0; tampered = false; holds = []; hackerSrc = "HACKER-" + (++srcN); shedSinceLog = 0;
    if (wasIso) { wasIso = false; const s = snap(); if (s) for (const r of s.robots) if (r.isolated) ours.add(r.id); }
    DemoLayer.setIsolated(false);
    for (const id of Object.keys(jobs)) if (jobs[id].kind === "hacker") { delete jobs[id]; DemoLayer.setTask(id, null); }
    $("log").innerHTML = ""; $("defdesc").textContent = DEF_TEXT[cfgKey]; $("defname").textContent = cfgKey;
    lastHack("", hackerOn ? "Attacking..." : "Idle. Switch attacks on to start.");
    log("info", "Demo started. Defence: " + $("def").selectedOptions[0].textContent + ".");
    renderHolds(); refresh(); scheduleHack();
  }

  // ---------- page elements ----------
  function buildUI() {
    const panel = document.getElementById("model-panel"), frame = document.getElementById("model-frame");
    const bar = document.createElement("section"); bar.className = "hk-bar"; bar.setAttribute("aria-label", "Live hack demo controls");
    bar.innerHTML =
      '<div class="hk-block hk-nurse" aria-labelledby="hk-nurse-h">' +
        '<div class="hk-head"><span class="hk-dot" aria-hidden="true"></span><h2 id="hk-nurse-h">Nurse station</h2>' +
        '<label class="hk-switch"><input type="checkbox" role="switch" id="hk-auto" checked><span class="hk-track" aria-hidden="true"></span>Auto tasks</label></div>' +
        '<dl class="hk-stats"><div><dt>Sent</dt><dd id="hk-n-sent">0</dd></div><div><dt>Done</dt><dd id="hk-n-done">0</dd></div><div><dt>Waiting for authorization</dt><dd id="hk-n-held">0</dd></div></dl>' +
        '<div class="hk-actions"><button type="button" id="hk-nurse">Send a task</button><button type="button" id="hk-cross">Send a cross-ward task</button></div>' +
        '<div id="hk-holds" class="hk-holds" aria-live="polite"></div><p id="hk-nurse-note" class="hk-note" role="status"></p>' +
      '</div>' +
      '<div class="hk-block hk-sim" aria-label="Simulation">' +
        '<label for="hk-def">Defence</label><select id="hk-def">' +
        '<option value="M0">M0 · No protection</option><option value="M1">M1 · Signed tickets</option><option value="M2">M2 · Ward rules</option>' +
        '<option value="M3">M3 · Data minimisation</option><option value="M4">M4 · Containment</option><option value="ALL" selected>ALL · Full protection</option></select>' +
        '<label for="hk-robots" class="hk-robots-label">Robots on duty: <output id="hk-robots-out" for="hk-robots">3</output></label>' +
        '<input type="range" id="hk-robots" min="3" max="10" step="1" value="3" aria-valuetext="3 robots">' +
        '<p id="hk-robots-note" class="hk-note" role="status"></p>' +
        '<button type="button" id="hk-restart" class="hk-restart">Restart demo</button>' +
      '</div>' +
      '<div class="hk-block hk-hacker" aria-labelledby="hk-hacker-h">' +
        '<div class="hk-head"><span class="hk-dot" aria-hidden="true"></span><h2 id="hk-hacker-h">Hacker</h2>' +
        '<label class="hk-switch"><input type="checkbox" role="switch" id="hk-hack"><span class="hk-track" aria-hidden="true"></span>Attacks</label></div>' +
        '<dl class="hk-stats"><div><dt>Attempts</dt><dd id="hk-n-att">0</dd></div><div><dt>Stopped</dt><dd id="hk-n-stop">0</dd></div><div><dt>Got through</dt><dd id="hk-n-thr">0</dd></div></dl>' +
        '<div class="hk-actions"><button type="button" id="hk-one">One attack</button></div>' +
        '<p id="hk-last" class="hk-note" role="status"></p>' +
      '</div>';
    panel.insertBefore(bar, panel.querySelector(".ops-grid"));
    const views = document.createElement("div"); views.className = "hk-views"; views.setAttribute("role", "group"); views.setAttribute("aria-label", "Camera view");
    views.innerHTML = [["overview", "Overview"], ["clinic", "Robots"], ["nurse", "Nurse"], ["gate", "Gate"], ["hacker", "Hacker"]]
      .map(([k, t]) => '<button type="button" data-hkview="' + k + '" aria-pressed="' + (k === "overview") + '">' + t + "</button>").join("");
    frame.appendChild(views);
    const head = document.querySelector(".app-head .brand");   // the console header has no way back to the overview page
    if (head) { const back = document.createElement("a"); back.href = "index.html"; back.className = "hk-back"; back.textContent = "← All pages"; head.after(back); }
    const sec = document.createElement("section"); sec.className = "ops-card hk-panel"; sec.id = "hk-panel"; sec.setAttribute("aria-label", "Live hack demo: robots, security log and system check");
    sec.innerHTML =
      '<div class="card-heading"><h2>Live system</h2><span class="device-ref" id="hk-defname">ALL</span></div>' +
      '<p id="hk-defdesc" class="hk-desc"></p>' +
      '<div class="hk-grid">' +
        '<div class="hk-box"><h3>Robot tasks</h3><ul id="hk-tasks" class="hk-tasks"></ul>' +
          '<p class="hk-k">Last order a robot received: <span id="hk-inbox" class="mono">nothing yet</span></p></div>' +
        '<div class="hk-box"><h3>Security log</h3><ul id="hk-log" class="hk-log"></ul></div>' +
        '<div class="hk-box"><h3>System check</h3><dl class="hk-checks">' +
          '<div><dt>Robot zone</dt><dd class="hk-val ok" id="hk-c-zone">Connected</dd></div>' +
          '<div><dt>Patient names leaked</dt><dd class="hk-val ok" id="hk-c-leak">None</dd></div>' +
          '<div><dt>Ward records</dt><dd class="hk-val ok" id="hk-c-rec">Intact</dd></div>' +
          '<div><dt>Audit log</dt><dd class="hk-val ok" id="hk-c-audit">Intact</dd></div></dl>' +
          '<div class="hk-actions"><button type="button" id="hk-verify">Check the log</button><button type="button" id="hk-tamper">Hacker edits the log</button></div></div>' +
      '</div>';
    panel.insertBefore(sec, panel.querySelector(".console-footer"));
  }

  // ---------- fleet size (3 to 10 robots) ----------
  function setFleet(n) {
    fleetWanted = n; fleetSend({id: newId("Z"), robot: "", action: "fleetsize", value: n});
    const s = rawSnap(), on = s ? s.robots.filter(r => r.active !== false).length : 3, diff = Math.abs(n - on), robots = diff === 1 ? " robot" : " robots";
    note("robots-note", n > on ? "Adding " + diff + robots + "." : n < on ? diff + robots + " finishing up, then back to the bay." : "");
    log("info", "Fleet size set to " + n + " robots.");
  }
  // The console draws all ten robots from its first snapshot (so each gets its picture). Robots that are off duty are hidden here.
  function applyFleetView(s) {
    if (!s) return;
    const on = new Map(s.robots.map(r => [r.id, r.active !== false])), duty = s.robots.filter(r => r.active !== false);
    document.querySelectorAll("#fleet-roster .unit-row").forEach(b => { b.style.display = on.get(b.dataset.robot) === false ? "none" : ""; });
    document.querySelectorAll("#robot-markers .unit-pin").forEach(p => { p.style.display = on.get(p.dataset.robot) === false ? "none" : ""; });
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = String(v); };
    set("count-fleet", duty.length); set("count-missions", duty.filter(r => r.mission).length); set("count-alerts", duty.filter(r => r.alert).length);
    DemoLayer.setRobotsOn(on);
    const sel = window.fleetConsole && window.fleetConsole.selected;
    if (sel && on.get(sel) === false) window.dispatchEvent(new CustomEvent("clinicfleet:pick", {detail: "RX-01"}));
  }
  function setView(name) {
    document.querySelectorAll("[data-hkview]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.hkview === name)));
    if (name === "clinic") { const r = document.getElementById("model-reset"); if (r) r.click(); } else DemoLayer.view(name);
  }
  function wire() {
    $("def").onchange = () => { cfgKey = $("def").value; restart(); };
    $("hack").onchange = () => {
      hackerOn = $("hack").checked; DemoLayer.hackerTyping(hackerOn);
      if (hackerOn) { log("info", "The hacker starts attacking at random."); lastHack("", "Attacking..."); setTimeout(() => hack(), 300); }
      else { log("info", "The hacker stops."); lastHack("", "Idle. Switch attacks on to start."); }
      scheduleHack();
    };
    $("one").onclick = () => hack();
    $("nurse").onclick = () => nurseTask(false, true);
    $("cross").onclick = () => nurseTask(true, true);
    $("auto").onchange = () => { autoOn = $("auto").checked; scheduleNurse(); if (autoOn) nurseTask(false, false); };
    $("restart").onclick = restart;
    $("robots").oninput = () => {
      const n = Number($("robots").value); $("robots-out").textContent = n; $("robots").setAttribute("aria-valuetext", n + " robots");
      clearTimeout(fleetTimer); fleetTimer = setTimeout(() => setFleet(n), 250);
    };
    document.querySelectorAll("#mission-destination option").forEach(o => { if (/^(BAY|CHK)-/.test(o.value)) o.remove(); });   // bays and checkpoints are for the robots, not for operators
    window.addEventListener("clinicfleet:state", e => applyFleetView(e.detail));
    $("holds").addEventListener("click", e => { const b = e.target.closest("button[data-act]"), h = e.target.closest("[data-hold]"); if (b && h) (b.dataset.act === "ok" ? authorize : reject)(Number(h.dataset.hold), false); });
    document.querySelectorAll("[data-hkview]").forEach(b => { b.onclick = () => setView(b.dataset.hkview); });
    $("tamper").onclick = () => {
      if (!gate.audit.length) { log("info", "The log is empty. Send some requests first."); return; }
      DemoLayer.hackerSay("Nobody will notice this edit..."); typing(1500);
      const i = Math.floor(Math.random() * gate.audit.length); gate.audit[i].detail = "edited by hacker";
      log("bad", "The hacker edited audit log entry #" + i + "."); refresh();
      if (tampered) log("good", "Log check: tampering detected. The chain of fingerprints no longer matches.");
    };
    $("verify").onclick = () => { const ok = gate.verifyAudit(); if (!ok) tampered = true; refresh(); log(ok ? "good" : "bad", ok ? "Log check: all " + gate.audit.length + " entries are intact." : "Log check: tampering detected."); };
  }

  buildUI(); wire();
  H.gateCommand = consoleOrder;
  const attach = () => {
    if (!H.env || DemoLayer.ready) return;
    DemoLayer.init(H.env);
    const f = document.getElementById("model-floor");   // show both floors: the wards and the lab are upstairs
    if (f && f.value !== "both") { f.value = "both"; f.dispatchEvent(new Event("change")); }
    setTimeout(() => setView("overview"), 300);
  };
  window.addEventListener("rwdemo:scene", attach); attach();
  setInterval(() => { if (gate) gate.beginSecond(); }, 1000);
  setInterval(maintain, 500);
  DemoLayer.setActive(true);
  restart(); scheduleNurse(); setTimeout(() => nurseTask(false, false), 1500);
  window.RWDemo = {hack, nurseTask, authorize, reject, restart, setFleet, holds: () => holds.slice(), jobs: () => Object.assign({}, jobs),
    fleet: () => { const s = rawSnap(); return {wanted: fleetWanted, onDuty: s ? s.robots.filter(r => r.active !== false).length : 0, retiring: s ? s.robots.filter(r => r.retire).length : 0}; },
    state: () => ({st, isolated: gate.isolated, cfgKey, tampered, layer: DemoLayer.ready, hackerSrc}), setConfig(k) { $("def").value = k; cfgKey = k; restart(); }};
})();
