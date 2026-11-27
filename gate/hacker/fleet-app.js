"use strict";
// Live hack demo on the real fleet console. Every allow/block decision comes from the real gate code
// (RWGate = gate/gate.cjs running in the browser). Orders the gate lets through become real fleet commands.
(function () {
  const {Gate, makeWorld, issueToken, PATIENT_NAMES} = RWGate;
  const H = window.RWHooks;
  const $ = id => document.getElementById("hk-" + id);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const T0 = 1000000, CAPACITY = 20;
  const CONFIGS = {M0: {}, M1: {M1: true}, M2: {M2: true}, M3: {M3: true}, M4: {M4: true}, ALL: {M1: true, M2: true, M3: true, M4: true}};
  const DEF_TEXT = {
    M0: "No real protection. The gate only checks that the task number exists. Anyone can order the robots.",
    M1: "Signed, single-use tickets stop forged, expired, changed and reused orders. Nothing else is checked.",
    M2: "Role and ward rules stop people from doing things they are not allowed to do, but forged tickets are not checked.",
    M3: "Data minimisation: the robots only get the task number and destination, and extra fields are rejected.",
    M4: "Containment: floods and repeated bad requests trip a breaker that cuts the robots off. Nurses continue by hand.",
    ALL: "All four defences together."};
  // The gate's destinations are the fleet console's stations.
  const DEST_TO_STATION = {"Room 12": "WARD-A", "Room 7": "WARD-B", "Pharmacy": "PHARMACY", "Lab": "LAB", "Storage": "STORES"};
  const STATION_TO_DEST = {"WARD-A": "Room 12", "WARD-B": "Room 7", "PHARMACY": "Pharmacy", "LAB": "Lab", "STORES": "Storage", "COLLECTION": "Lab"};
  const USER_FOR = {"WARD-A": ["N1", "med"], "WARD-B": ["N2", "med"], "PHARMACY": ["N1", "med"], "LAB": ["N2", "specimen"], "STORES": ["P1", "linen"], "COLLECTION": ["N2", "specimen"]};
  const KNOWN = [["T1", "Room 12"], ["T2", "Pharmacy"], ["T3", "Lab"]];   // task and destination pairs that nurse N1 is allowed to order

  let world, gate, clock, startMs, cfgKey = "ALL", st, lastLegit, taskN = 0, cmdN = 0, wasIso, tampered;
  let hackerOn = false, hackTimer = null, autoOn = true, autoTimer = null, floodTimer = null, floodStats = null;

  const tick = () => { clock.t = T0 + (performance.now() - startMs); };
  const elapsed = () => ((performance.now() - startMs) / 1000).toFixed(1) + "s";
  const snap = () => window.fleetConsole && window.fleetConsole.snapshot;
  function addLog(cls, text) {
    const li = document.createElement("li"); li.className = cls;
    const t = document.createElement("time"); t.textContent = elapsed(); li.appendChild(t); li.appendChild(document.createTextNode(" " + text));
    const ul = $("log"); ul.insertBefore(li, ul.firstChild); while (ul.children.length > 90) ul.removeChild(ul.lastChild);
  }
  const fleetSend = cmd => { if (H.rawPost) H.rawPost({type: "command", command: cmd}); };
  const newId = prefix => prefix + String(++cmdN).padStart(4, "0");
  function pickRobot() {
    const s = snap(); if (!s) return "RX-01";
    const free = s.robots.filter(r => !r.mission && !r.isolated && !r.alert);
    return pick(free.length ? free : s.robots).id;
  }
  // The fleet declines an order to a station that is occupied or assigned (including the robot's own). When a hacked order
  // gets through the gate, send it to a station the console will accept, so the hijack visibly moves a real robot.
  function hijackStation(preferred) {
    const s = snap(); if (!s) return preferred;
    const taken = new Set(s.robots.map(r => r.mission ? r.mission.dest : r.station).filter(Boolean));
    const open = Object.keys(STATION_TO_DEST).filter(k => !taken.has(k));
    return open.includes(preferred) || !open.length ? preferred : pick(open);
  }
  function hijack(robot, preferred) {   // send a hacker order to the real fleet and be honest if the console declines it
    const station = hijackStation(preferred);
    fleetSend({id: newId("H"), robot, action: "dispatch", destination: station});
    setTimeout(() => {
      const r = snap() && snap().robots.find(x => x.id === robot);
      if (r && !(r.mission && r.mission.dest === station)) addLog("info", "The fleet console declined that order (" + robot + " is busy or on hold), so nothing moved.");
    }, 1200);
  }
  function mk(user, task, dest, extra) {
    return Object.assign({type: "deliver", user, task_id: task, destination: dest, token: issueToken(user, task, dest, clock.t), source: "HACKER-1"}, extra || {});
  }

  // ---------- hacker attacks ----------
  const ATTACKS = {
    noTicket: {say: "No ticket? No problem!", name: "Order with no login ticket", build() { const [t, d] = pick(KNOWN), r = mk("N1", t, d); delete r.token; return r; }},
    forged: {say: "I made my own ticket!", name: "Order with a forged ticket", build() { const [t, d] = pick(KNOWN), r = mk("N1", t, d); r.token = r.token.slice(0, -4) + "AAAA"; return r; }},
    expired: {say: "This old ticket still works... right?", name: "Order with an expired ticket", build() { const [t, d] = pick(KNOWN), r = mk("N1", t, d); r.token = issueToken("N1", t, d, clock.t - 600000, 300000); return r; }},
    replay: {say: "Copy and paste!", name: "Copied order sent again (replay)", needs: () => !!lastLegit, build() { return Object.assign({}, lastLegit, {source: "HACKER-1"}); }},
    wrongWard: {say: "Borrowed badge!", name: "Nurse N2's badge used for a ward N2 does not work in", build() { return mk("N2", "T1", "Room 12"); }},
    tamper: {say: "Change the address!", name: "Valid order with the destination changed", build() { const r = mk("N1", "T1", "Room 12"); r.destination = "Pharmacy"; return r; }},
    leak: {say: "Tell me the patient names!", name: "Order with a hidden patient-name field", build() { return mk("N1", "T1", "Room 12", {patient_name: pick(PATIENT_NAMES)}); }},
    unknown: {say: "Task 99, I guess?", name: "Order for a task that does not exist", build() { return mk("N1", "T99", "Room 12"); }},
    fired: {say: "I still have my old login!", name: "Login of a former employee (N3)", build() { return mk("N3", "T1", "Room 12"); }},
    flood: {say: "FLOOD!", name: "Flood of orders", special: "flood"},
    robot: {say: "I'm taking over a robot!", name: "Hacked robot sends forged messages", special: "robot"}
  };
  const WEIGHTED = ["noTicket", "forged", "expired", "replay", "wrongWard", "tamper", "leak", "unknown", "fired", "flood", "robot"];

  // The gate cutting the robot zone off is carried out on the real fleet: every robot is isolated (and released again on reset).
  function syncIso() {
    DemoLayer.setIsolated(gate.isolated);
    if (gate.isolated === wasIso) return;
    wasIso = gate.isolated;
    const s = snap();
    if (s) for (const r of s.robots) {
      if (gate.isolated && !r.isolated) fleetSend({id: newId("G"), robot: r.id, action: "isolate"});
      if (!gate.isolated && (r.isolated || r.alert)) fleetSend({id: newId("G"), robot: r.id, action: "release"});
    }
    addLog(gate.isolated ? "warn" : "info", gate.isolated ? "BREAKER TRIPPED: the robot zone is cut off and all robots are isolated. Nurses continue by hand." : "Robot zone switched back on; robots released.");
  }

  // ---------- nurse orders: everything the nurse sends to the robots goes through the gate ----------
  function declineInConsole(c, reason) {   // tell the console's own panel why the order did not go through
    const w = H.worker, s = snap();
    if (w && typeof w.onmessage === "function" && s) w.onmessage({data: Object.assign({}, s, {acks: [{id: c.id, robot: c.robot, ok: false, reason}], events: []})});
  }
  function processOrder(msg, forward, fromConsole) {
    const c = msg.command, dest = STATION_TO_DEST[c.destination];
    if (!gate || c.action !== "dispatch" || !dest) return forward();   // only orders that move a robot are checked; other console buttons are operator controls
    tick();
    const [user, type] = USER_FOR[c.destination], id = "L" + (++taskN);
    world.tasks[id] = {dest, type, owner: user, status: "REGISTERED"};
    const req = {type: "deliver", user, task_id: id, destination: dest, token: issueToken(user, id, dest, clock.t), source: "WARD-" + user};
    const res = gate.handle(req);
    if (res.ok) lastLegit = Object.assign({}, req);
    syncIso(); DemoLayer.nurseWave();
    const who = "Nurse " + user + " to " + c.destination;
    if (!res.ok) { st.refused++; addLog("bad2", who + ": REFUSED (" + res.reason + ")"); if (fromConsole) declineInConsole(c, "Blocked by the gate: " + res.reason); }
    else if (res.mode === "manual") {
      st.manual++; addLog("ok", who + ": delivered by hand (robots are cut off)");
      if (fromConsole) declineInConsole(c, "Robots are cut off. Deliver by hand.");
      DemoLayer.manualDeliver(c.destination === "PHARMACY" ? "STORES" : "PHARMACY", c.destination);
    } else { st.robot++; addLog("ok", who + ": sent to " + c.robot); forward(); }
    refresh();
    DemoLayer.request({from: "nurse", passed: res.ok, noRobot: res.mode === "manual", target: c.robot, text: "REFUSED: " + (res.reason || "")});
  }
  function nurseSend() {
    const s = snap(); if (!s) { addLog("info", "The fleet console is still starting."); return; }
    let robot, options = Object.keys(STATION_TO_DEST);
    if (gate.isolated) robot = "RX-01";   // robots are cut off: the order goes to the gate, which sends it to manual mode
    else {
      const free = s.robots.filter(r => !r.mission && !r.isolated && !r.alert);
      const busy = new Set(s.robots.map(r => r.mission ? r.mission.dest : r.station).filter(Boolean));
      options = options.filter(k => !busy.has(k));
      if (!free.length || !options.length) { addLog("info", "All robots are busy right now. Try again in a moment."); return; }
      robot = pick(free).id;
    }
    const cmd = {id: newId("N"), robot, action: "dispatch", destination: pick(options)};
    processOrder({type: "command", command: cmd}, () => fleetSend(cmd), false);
  }

  // ---------- hacker ----------
  function hack(kind) {
    const keys = WEIGHTED.filter(k => !ATTACKS[k].needs || ATTACKS[k].needs());
    const id = kind || pick(keys), a = ATTACKS[id];
    if (id === "flood" && floodTimer) return;
    DemoLayer.hackerSay(a.say); typing(1300);
    if (a.special === "flood") return startFlood();
    if (a.special === "robot") return hackRobot();
    tick();
    const req = a.build(), res = gate.handle(req);
    syncIso();
    const station = DEST_TO_STATION[req.destination] || "WARD-A", target = pickRobot();
    st.attempts++;
    if (!res.ok) { st.blocked++; addLog("good", a.name + ": BLOCKED (" + res.reason + ")"); }
    else if (res.mode === "manual") { st.through++; addLog("bad", a.name + ": GOT THROUGH, but the robot zone is cut off, so it landed in manual mode"); }
    else { st.through++; addLog("bad", a.name + ": GOT THROUGH. " + target + " obeyed the hacker!"); }
    refresh();
    DemoLayer.request({
      from: "hacker", passed: res.ok, noRobot: res.ok && res.mode === "manual", target, text: res.ok ? "ACCEPTED" : (res.shed ? "CUT OFF" : "BLOCKED: " + res.reason),
      arrive() {
        if (res.ok && res.mode === "robot") hijack(target, station);
        if (!res.ok) DemoLayer.hackerRage();   // blocked: the hacker is furious
      }
    });
  }
  function typing(ms) { DemoLayer.hackerTyping(true); setTimeout(() => DemoLayer.hackerTyping(hackerOn || !!floodTimer), ms); }
  function hackRobot() {
    tick();
    const target = pickRobot(), res = gate.robotMessage({task_id: "T1", status: "DELIVERED", owner: "ATK", admin: true, pad: "x".repeat(5000)});
    st.attempts++;
    if (res.ok) { st.through++; addLog("bad", ATTACKS.robot.name + ": GOT THROUGH. Ward records were overwritten, and " + target + " starts spinning (the fleet monitor will notice)."); }
    else { st.blocked++; addLog("good", ATTACKS.robot.name + ": BLOCKED (message dropped)"); }
    refresh();
    DemoLayer.robotMessage({passed: res.ok, target, arrive() { if (res.ok) fleetSend({id: newId("H"), robot: target, action: "example", example: "spin"}); }});
  }
  function startFlood() {
    if (floodTimer) return;
    const until = performance.now() + 4000; let n = 0; floodStats = {n: 0, blocked: 0, through: 0};
    floodTimer = setInterval(() => {
      if (performance.now() > until) { stopFlood(true); return; }
      for (let i = 0; i < 4; i++) {
        tick();
        const res = gate.handle({type: "deliver", user: "N1", task_id: "T1", destination: "Room 12", source: "HACKER-1"});
        floodStats.n++; st.attempts++; if (res.ok) { floodStats.through++; st.through++; } else { floodStats.blocked++; st.blocked++; }
        if (n++ % 6 === 0) {
          const target = pickRobot();
          DemoLayer.request({from: "hacker", passed: res.ok, noRobot: res.ok && res.mode === "manual", target, quiet: true, fast: true,
            arrive() { if (res.ok && res.mode === "robot" && floodStats && floodStats.through % 25 < 6) hijack(target, "WARD-A"); }});
        }
      }
      syncIso(); refresh();
    }, 100);
  }
  function stopFlood(report) {
    clearInterval(floodTimer); floodTimer = null;
    if (report && floodStats && floodStats.n) addLog(floodStats.through ? "bad" : "good", "Flood of " + floodStats.n + " orders in 4 seconds: " + floodStats.blocked + " blocked, " + floodStats.through + " got through");
    floodStats = null; DemoLayer.hackerTyping(hackerOn); refresh();
  }
  function scheduleHack() { clearTimeout(hackTimer); if (!hackerOn) return; hackTimer = setTimeout(() => { hack(); scheduleHack(); }, 1100 + Math.random() * 1600); }
  function scheduleNurse() { clearInterval(autoTimer); if (autoOn) autoTimer = setInterval(nurseSend, 5500); }

  // ---------- live checks ----------
  function leaks() {
    const inbox = JSON.stringify(world.robot.inbox), log = JSON.stringify(gate.audit);
    return {robot: PATIENT_NAMES.some(n => inbox.includes(n)), log: PATIENT_NAMES.some(n => log.includes(n))};
  }
  const corrupted = () => Object.values(world.tasks).some(t => t.owner === "ATK" || "admin" in t || "pad" in t);
  function setCard(id, text, level) { const e = $(id); e.textContent = text; e.className = "hk-val " + level; }
  function refresh() {
    if (!gate) return;
    const s = snap(), n = s ? s.robots.length : 0, held = s ? s.robots.filter(r => r.isolated).length : 0, alerts = s ? s.robots.filter(r => r.alert).length : 0;
    setCard("c-zone", gate.isolated ? "CUT OFF (breaker tripped)" : "Connected", gate.isolated ? "warn" : "ok");
    setCard("c-fleet", n ? (n - held) + " active, " + held + " isolated, " + alerts + " alert" + (alerts === 1 ? "" : "s") : "starting...", held || alerts ? "warn" : "ok");
    const l = leaks();
    setCard("c-leak", l.robot ? "YES: the robots received patient names" : l.log ? "YES: patient names written to the log" : "None", l.robot || l.log ? "bad" : "ok");
    setCard("c-rec", corrupted() ? "CORRUPTED by a hacked robot" : "Intact", corrupted() ? "bad" : "ok");
    if (gate.audit.length < 4000 || !tampered) { if (!gate.verifyAudit()) tampered = true; }
    setCard("c-audit", tampered ? "TAMPERING DETECTED" : "Intact (" + gate.audit.length + " entries)", tampered ? "bad" : "ok");
    $("n-att").textContent = st.attempts; $("n-blk").textContent = st.blocked; $("n-thr").textContent = st.through;
    $("n-robot").textContent = st.robot; $("n-hand").textContent = st.manual; $("n-ref").textContent = st.refused;
    $("n-thr").parentElement.className = "hk-stat" + (st.through ? " bad" : ""); $("n-ref").parentElement.className = "hk-stat" + (st.refused ? " warn" : "");
    $("chip-zone").textContent = gate.isolated ? "Robots: CUT OFF" : "Robots: connected"; $("chip-zone").className = "hk-chip " + (gate.isolated ? "warn" : "ok");
    $("chip-blk").textContent = st.blocked; $("chip-thr").textContent = st.through; $("chip-thr").parentElement.className = "hk-chip" + (st.through ? " bad" : "");
    const rec = world.robot.inbox.slice(-4).map(p => JSON.stringify(p));
    $("inbox").innerHTML = rec.length ? rec.map(x => '<li class="' + (PATIENT_NAMES.some(nm => x.includes(nm)) ? "bad" : "") + '">' + x.replace(/[&<>]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"}[c])) + "</li>").join("") : "<li class='dim'>Nothing yet</li>";
  }

  function restart() {
    stopFlood(false); clearTimeout(hackTimer);
    const wasCut = gate && gate.isolated;
    world = makeWorld(); clock = {t: T0}; startMs = performance.now(); gate = new Gate(world, CONFIGS[cfgKey], clock, CAPACITY); gate.beginSecond();
    st = {attempts: 0, blocked: 0, through: 0, robot: 0, manual: 0, refused: 0}; lastLegit = null; taskN = 0; wasIso = !!wasCut; tampered = false;
    DemoLayer.reset(); if (wasCut) { wasIso = true; gate.isolated = false; syncIso(); }
    $("log").innerHTML = ""; $("defdesc").textContent = DEF_TEXT[cfgKey];
    addLog("info", "Demo started with defence: " + $("def").selectedOptions[0].textContent); refresh(); scheduleHack();
  }

  // ---------- page elements ----------
  function buildUI() {
    const view = document.getElementById("clinic-view"), panel = document.getElementById("model-panel");
    const bar = document.createElement("div"); bar.className = "hk-bar"; bar.setAttribute("role", "group"); bar.setAttribute("aria-label", "Live hack demo controls");
    bar.innerHTML =
      '<div class="hk-row"><strong class="hk-title">Live hack demo</strong>' +
      '<label class="sr-only" for="hk-def">Defence</label><select id="hk-def">' +
      '<option value="M0">M0: No real protection</option><option value="M1">M1: Signed tickets only</option><option value="M2">M2: Role and ward rules only</option>' +
      '<option value="M3">M3: Data minimisation only</option><option value="M4">M4: Containment only</option><option value="ALL" selected>ALL: Full protection (M1+M2+M3+M4)</option></select>' +
      '<button type="button" id="hk-hack" class="hk-danger" aria-pressed="false">Start hacker</button><button type="button" id="hk-one">One random hack</button>' +
      '<button type="button" id="hk-nurse" class="hk-good">Nurse sends a delivery</button><button type="button" id="hk-auto" aria-pressed="true">Automatic nurse: on</button>' +
      '<button type="button" id="hk-zone">Switch robots back on</button><button type="button" id="hk-restart">Restart</button></div>' +
      '<div class="hk-row hk-sub"><span class="hk-views" role="group" aria-label="Camera view">View: ' +
      '<button type="button" data-hkview="clinic">Clinic</button><button type="button" data-hkview="whole">Whole scene</button><button type="button" data-hkview="hacker">Hacker</button><button type="button" data-hkview="gate">Gate</button></span>' +
      '<span class="hk-chip ok" id="hk-chip-zone">Robots: connected</span><span class="hk-chip">Hacker: <b id="hk-chip-blk">0</b> blocked</span><span class="hk-chip">Got through: <b id="hk-chip-thr">0</b></span>' +
      '<a href="#hk-panel" class="hk-link">Live system check &darr;</a></div>';
    view.querySelector(".map-head").after(bar);
    const head = document.querySelector(".app-head .brand");   // the console header has no way back to the overview page
    if (head) { const back = document.createElement("a"); back.href = "index.html"; back.className = "hk-back"; back.textContent = "← All pages"; head.after(back); }
    const sec = document.createElement("section"); sec.className = "ops-card hk-panel"; sec.id = "hk-panel"; sec.setAttribute("aria-label", "Live hack demo: system check");
    sec.innerHTML =
      '<div class="card-heading"><h2>Live system check</h2><span class="device-ref">same fleet as above</span></div>' +
      '<p id="hk-defdesc" class="hk-desc"></p>' +
      '<div class="hk-grid">' +
      '<div class="hk-box"><h3>Checks</h3><div class="hk-cards">' +
      '<div><span class="hk-k">Robot zone</span><b class="hk-val ok" id="hk-c-zone">Connected</b></div>' +
      '<div><span class="hk-k">Robots in the console</span><b class="hk-val ok" id="hk-c-fleet">starting...</b></div>' +
      '<div><span class="hk-k">Patient names leaked</span><b class="hk-val ok" id="hk-c-leak">None</b></div>' +
      '<div><span class="hk-k">Ward records</span><b class="hk-val ok" id="hk-c-rec">Intact</b></div>' +
      '<div class="hk-wide"><span class="hk-k">Audit log (tamper-proof chain)</span><b class="hk-val ok" id="hk-c-audit">Intact</b>' +
      '<span class="hk-btns"><button type="button" id="hk-verify">Check the log</button><button type="button" id="hk-tamper">Hacker edits the log</button></span></div></div></div>' +
      '<div class="hk-box"><h3>Score</h3><p class="hk-k">Hacker</p><div class="hk-stats"><div class="hk-stat"><b id="hk-n-att">0</b><span>attempts</span></div><div class="hk-stat"><b id="hk-n-blk">0</b><span>blocked</span></div><div class="hk-stat"><b id="hk-n-thr">0</b><span>got through</span></div></div>' +
      '<p class="hk-k">Real nurse orders</p><div class="hk-stats"><div class="hk-stat"><b id="hk-n-robot">0</b><span>sent to robot</span></div><div class="hk-stat"><b id="hk-n-hand">0</b><span>by hand</span></div><div class="hk-stat"><b id="hk-n-ref">0</b><span>refused</span></div></div>' +
      '<p class="hk-k">A good defence keeps &ldquo;got through&rdquo; and &ldquo;refused&rdquo; at 0.</p></div>' +
      '<div class="hk-box"><h3>What the robots received (last 4)</h3><ul id="hk-inbox" class="hk-inbox"><li class="dim">Nothing yet</li></ul></div>' +
      '<div class="hk-box hk-logbox"><h3>Demo log</h3><ul id="hk-log" class="hk-log"></ul></div></div>';
    panel.insertBefore(sec, panel.querySelector(".console-footer"));
  }

  function wire() {
    $("def").onchange = () => { cfgKey = $("def").value; restart(); };
    $("hack").onclick = () => { hackerOn = !hackerOn; $("hack").textContent = hackerOn ? "Stop hacker" : "Start hacker"; $("hack").setAttribute("aria-pressed", hackerOn); $("hack").classList.toggle("on", hackerOn); DemoLayer.hackerTyping(hackerOn); DemoLayer.setActive(hackerOn || autoOn); if (hackerOn) { addLog("info", "The hacker starts attacking at random."); setTimeout(() => hack(), 300); } else addLog("info", "The hacker stops."); scheduleHack(); };
    $("one").onclick = () => hack();
    $("nurse").onclick = nurseSend;
    $("auto").onclick = () => { autoOn = !autoOn; $("auto").textContent = "Automatic nurse: " + (autoOn ? "on" : "off"); $("auto").setAttribute("aria-pressed", autoOn); DemoLayer.setActive(hackerOn || autoOn); scheduleNurse(); };
    $("zone").onclick = () => { tick(); const was = gate.isolated; gate.reset("S1"); syncIso(); if (!was) addLog("info", "The robot zone was already connected."); refresh(); };
    $("restart").onclick = restart;
    document.querySelectorAll("[data-hkview]").forEach(b => { b.onclick = () => { if (b.dataset.hkview === "clinic") { const r = document.getElementById("model-reset"); if (r) r.click(); } else DemoLayer.view(b.dataset.hkview); }; });
    $("tamper").onclick = () => {
      if (!gate.audit.length) { addLog("info", "The log is empty. Send some requests first."); return; }
      DemoLayer.hackerSay("Nobody will notice this edit..."); typing(1500);
      const i = Math.floor(Math.random() * gate.audit.length); gate.audit[i].detail = "edited by hacker";
      addLog("bad", "The hacker edited log entry #" + i + "."); refresh();
      if (tampered) addLog("good", "Log check: TAMPERING DETECTED. The chain of fingerprints no longer matches.");
    };
    $("verify").onclick = () => { const ok = gate.verifyAudit(); if (!ok) tampered = true; refresh(); addLog(ok ? "good" : "bad", ok ? "Log check: all " + gate.audit.length + " entries are intact." : "Log check: TAMPERING DETECTED."); };
  }

  buildUI(); wire();
  H.gateCommand = (msg, forward) => processOrder(msg, forward, true);   // orders from the console's own Dispatch button are gated too
  const attach = () => { if (H.env && !DemoLayer.ready) DemoLayer.init(H.env); };
  window.addEventListener("rwdemo:scene", attach); attach();
  setInterval(() => { if (gate) { gate.beginSecond(); refresh(); } }, 1000);
  DemoLayer.setActive(true);
  restart(); scheduleNurse();
  window.RWDemo = {hack, nurseSend, restart, state: () => ({st, isolated: gate.isolated, cfgKey, tampered, layer: DemoLayer.ready}), setConfig(k) { $("def").value = k; cfgKey = k; restart(); }};
})();
