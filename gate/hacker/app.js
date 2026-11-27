"use strict";
// Live hack demo logic. Every allow/block decision comes from the real gate code (RWGate = gate/gate.cjs in the browser).
(function () {
  const {Gate, makeWorld, issueToken, PATIENT_NAMES} = RWGate;
  const $ = id => document.getElementById(id);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const T0 = 1000000, CAPACITY = 20;
  const CONFIGS = {M0: {}, M1: {M1: true}, M2: {M2: true}, M3: {M3: true}, M4: {M4: true}, ALL: {M1: true, M2: true, M3: true, M4: true}};
  const DEF_TEXT = {
    M0: "No real protection. The gate only checks that the task number exists. Anyone can order the robot.",
    M1: "Signed, single-use tickets stop forged, expired, changed and reused orders. Nothing else is checked.",
    M2: "Role and ward rules stop people from doing things they are not allowed to do, but forged tickets are not checked.",
    M3: "Data minimisation: the robot only gets the task number and destination, and extra fields are rejected.",
    M4: "Containment: floods and repeated bad requests trip a breaker that cuts the robot off. Nurses continue by hand.",
    ALL: "All four defences together."};
  const ROOMS = ["Room 12", "Room 7", "Pharmacy", "Lab", "Storage"];
  const NURSE_JOBS = [["N1", "Room 12", "med"], ["N1", "Pharmacy", "med"], ["N2", "Room 7", "med"], ["N2", "Lab", "specimen"], ["P1", "Storage", "linen"]];
  const KNOWN = [["T1", "Room 12"], ["T2", "Pharmacy"], ["T3", "Lab"]];   // task and destination pairs that nurse N1 is allowed to order

  let world, gate, clock, startMs, cfgKey = "ALL", st, lastLegit, taskN, wasIso, tampered;
  let hackerOn = false, hackTimer = null, autoOn = true, autoTimer = null, floodTimer = null, floodStats = null;

  const tick = () => { clock.t = T0 + (performance.now() - startMs); };
  const elapsed = () => ((performance.now() - startMs) / 1000).toFixed(1) + "s";
  function say(t) { $("live").textContent = t; }
  function addLog(cls, text) {
    const li = document.createElement("li"); li.className = cls;
    const t = document.createElement("time"); t.textContent = elapsed(); li.appendChild(t); li.appendChild(document.createTextNode(" " + text));
    const ul = $("log"); ul.insertBefore(li, ul.firstChild); while (ul.children.length > 90) ul.removeChild(ul.lastChild);
  }
  function mk(user, task, dest, extra) {
    return Object.assign({type: "deliver", user, task_id: task, destination: dest, token: issueToken(user, task, dest, clock.t), source: "HACKER-1"}, extra || {});
  }
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
    robot: {say: "I'm taking over the robot!", name: "Hacked robot sends forged messages", special: "robot"}
  };
  const WEIGHTED = ["noTicket", "forged", "expired", "replay", "wrongWard", "tamper", "leak", "unknown", "fired", "flood", "robot"];

  function syncIso() {
    Scene3D.setIsolated(gate.isolated);
    if (gate.isolated !== wasIso) {
      wasIso = gate.isolated;
      addLog(gate.isolated ? "warn" : "info", gate.isolated ? "BREAKER TRIPPED: the robot zone is cut off. Nurses continue by hand." : "Robot zone switched back on.");
    }
  }

  // ---- nurse
  function nurseSend() {
    tick();
    const [u, d, type] = pick(NURSE_JOBS), id = "L" + (++taskN);
    world.tasks[id] = {dest: d, type, owner: u, status: "REGISTERED"};
    const req = {type: "deliver", user: u, task_id: id, destination: d, token: issueToken(u, id, d, clock.t), source: "WARD-" + u};
    const res = gate.handle(req);
    if (res.ok) lastLegit = Object.assign({}, req);
    syncIso(); Scene3D.nurseWave();
    // Counters and log are updated the moment the gate decides; the animation only follows.
    if (!res.ok) { st.refused++; addLog("bad2", "Nurse " + u + " to " + d + ": REFUSED (" + res.reason + ")"); }
    else if (res.mode === "manual") { st.manual++; addLog("ok", "Nurse " + u + " to " + d + ": delivered by hand (robot zone is cut off)"); }
    else { st.robot++; addLog("ok", "Nurse " + u + " to " + d + ": delivered by the robot"); }
    refresh();
    Scene3D.request({
      from: "nurse", passed: res.ok, noRobot: res.mode === "manual", text: "REFUSED: " + (res.reason || ""),
      arrive() { if (res.ok && res.mode === "manual") Scene3D.manualDeliver(d); else if (res.ok) Scene3D.robotDeliver(d, false); }
    });
  }

  // ---- hacker
  function hack(kind) {
    const keys = WEIGHTED.filter(k => !ATTACKS[k].needs || ATTACKS[k].needs());
    const id = kind || pick(keys), a = ATTACKS[id];
    if (id === "flood" && floodTimer) return;
    Scene3D.hackerSay(a.say); typing(1300);
    if (a.special === "flood") return startFlood();
    if (a.special === "robot") return hackRobot();
    tick();
    const req = a.build(), res = gate.handle(req);
    syncIso();
    const dest = typeof req.destination === "string" && ROOMS.includes(req.destination) ? req.destination : "Room 12";
    st.attempts++;
    if (!res.ok) { st.blocked++; addLog("good", a.name + ": BLOCKED (" + res.reason + ")"); }
    else if (res.mode === "manual") { st.through++; addLog("bad", a.name + ": GOT THROUGH, but the robot zone is cut off, so it landed in manual mode"); }
    else { st.through++; addLog("bad", a.name + ": GOT THROUGH. The robot obeyed the hacker!"); }
    refresh();
    Scene3D.request({
      from: "hacker", passed: res.ok, noRobot: res.ok && res.mode === "manual", text: res.ok ? "ACCEPTED" : (res.shed ? "CUT OFF" : "BLOCKED: " + res.reason),
      arrive() { if (res.ok && res.mode === "robot") Scene3D.robotDeliver(dest, true); }
    });
  }
  function typing(ms) { Scene3D.hackerTyping(true); setTimeout(() => Scene3D.hackerTyping(hackerOn || !!floodTimer), ms); }
  function hackRobot() {
    tick();
    const res = gate.robotMessage({task_id: "T1", status: "DELIVERED", owner: "ATK", admin: true, pad: "x".repeat(5000)});
    st.attempts++;
    if (res.ok) { st.through++; addLog("bad", ATTACKS.robot.name + ": GOT THROUGH. Ward records were overwritten!"); } else { st.blocked++; addLog("good", ATTACKS.robot.name + ": BLOCKED (message dropped)"); }
    refresh();
    Scene3D.robotMessage({passed: res.ok});
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
        if (n++ % 6 === 0) Scene3D.request({from: "hacker", passed: res.ok, noRobot: res.ok && res.mode === "manual", quiet: true, fast: true, arrive() { if (res.ok && res.mode === "robot") Scene3D.robotDeliver("Room 12", true); }});
      }
      syncIso(); refresh();
    }, 100);
  }
  function stopFlood(report) {
    clearInterval(floodTimer); floodTimer = null;
    if (report && floodStats && floodStats.n) addLog(floodStats.through ? "bad" : "good", "Flood of " + floodStats.n + " orders in 4 seconds: " + floodStats.blocked + " blocked, " + floodStats.through + " got through");
    floodStats = null; Scene3D.hackerTyping(hackerOn); refresh();
  }
  function scheduleHack() { clearTimeout(hackTimer); if (!hackerOn) return; hackTimer = setTimeout(() => { hack(); scheduleHack(); }, 900 + Math.random() * 1400); }
  function scheduleNurse() { clearInterval(autoTimer); if (autoOn) autoTimer = setInterval(nurseSend, 2600); }

  // ---- live checks
  function leaks() {
    const inbox = JSON.stringify(world.robot.inbox), log = JSON.stringify(gate.audit);
    return {robot: PATIENT_NAMES.some(n => inbox.includes(n)), log: PATIENT_NAMES.some(n => log.includes(n))};
  }
  function corrupted() { return Object.values(world.tasks).some(t => t.owner === "ATK" || "admin" in t || "pad" in t); }
  function setCard(id, text, level) { const e = $(id); e.textContent = text; e.className = "val " + level; }
  function refresh() {
    if (!gate) return;
    setCard("c-zone", gate.isolated ? "CUT OFF (breaker tripped)" : "Connected", gate.isolated ? "warn" : "ok");
    setCard("c-mode", gate.isolated ? "By hand (manual)" : "By robot", gate.isolated ? "warn" : "ok");
    const l = leaks();
    setCard("c-leak", l.robot ? "YES: the robot received patient names" : l.log ? "YES: patient names written to the log" : "None", l.robot || l.log ? "bad" : "ok");
    setCard("c-rec", corrupted() ? "CORRUPTED by the hacked robot" : "Intact", corrupted() ? "bad" : "ok");
    if (gate.audit.length < 4000 || !tampered) { const ok = gate.verifyAudit(); if (!ok) tampered = true; }
    setCard("c-audit", tampered ? "TAMPERING DETECTED" : "Intact (" + gate.audit.length + " entries)", tampered ? "bad" : "ok");
    $("n-att").textContent = st.attempts; $("n-blk").textContent = st.blocked; $("n-thr").textContent = st.through;
    $("n-robot").textContent = st.robot; $("n-hand").textContent = st.manual; $("n-ref").textContent = st.refused;
    $("n-thr").parentElement.className = st.through ? "stat bad" : "stat"; $("n-ref").parentElement.className = st.refused ? "stat warn" : "stat";
    const rec = world.robot.inbox.slice(-4).map(p => JSON.stringify(p));
    $("inbox").innerHTML = rec.length ? rec.map(s => '<li class="' + (PATIENT_NAMES.some(n => s.includes(n)) ? "bad" : "") + '">' + s.replace(/[&<>]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"}[c])) + "</li>").join("") : "<li class='dim'>Nothing yet</li>";
  }

  function restart() {
    stopFlood(false); clearTimeout(hackTimer);
    world = makeWorld(); clock = {t: T0}; startMs = performance.now(); gate = new Gate(world, CONFIGS[cfgKey], clock, CAPACITY); gate.beginSecond();
    st = {attempts: 0, blocked: 0, through: 0, robot: 0, manual: 0, refused: 0}; lastLegit = null; taskN = 0; wasIso = false; tampered = false;
    Scene3D.reset(); $("log").innerHTML = ""; $("defdesc").textContent = DEF_TEXT[cfgKey];
    addLog("info", "Demo started with defence: " + $("def").selectedOptions[0].textContent); refresh(); scheduleHack();
  }

  // ---- wiring
  $("def").onchange = () => { cfgKey = $("def").value; restart(); };
  $("hackBtn").onclick = () => { hackerOn = !hackerOn; $("hackBtn").textContent = hackerOn ? "Stop hacker" : "Start hacker"; $("hackBtn").setAttribute("aria-pressed", hackerOn); $("hackBtn").classList.toggle("on", hackerOn); Scene3D.hackerTyping(hackerOn); if (hackerOn) { addLog("info", "The hacker starts attacking at random."); setTimeout(() => hack(), 300); } else addLog("info", "The hacker stops."); scheduleHack(); };
  $("oneBtn").onclick = () => hack();
  $("nurseBtn").onclick = nurseSend;
  $("autoBtn").onclick = () => { autoOn = !autoOn; $("autoBtn").textContent = "Automatic nurse: " + (autoOn ? "on" : "off"); $("autoBtn").setAttribute("aria-pressed", autoOn); scheduleNurse(); };
  $("zoneBtn").onclick = () => { tick(); const was = gate.isolated, r = gate.reset("S1"); syncIso(); if (!was) addLog("info", "The robot zone was already connected."); refresh(); say(r.ok ? "Supervisor reset done" : "Reset refused"); };
  $("restartBtn").onclick = restart;
  document.querySelectorAll("[data-view]").forEach(b => { b.onclick = () => Scene3D.view(b.dataset.view); });
  $("tamperBtn").onclick = () => {
    if (!gate.audit.length) { addLog("info", "The log is empty. Send some requests first."); return; }
    Scene3D.hackerSay("Nobody will notice this edit..."); typing(1500);
    const i = Math.floor(Math.random() * gate.audit.length); gate.audit[i].detail = "edited by hacker";
    addLog("bad", "The hacker edited log entry #" + i + "."); refresh();
    if (tampered) addLog("good", "Log check: TAMPERING DETECTED. The chain of fingerprints no longer matches.");
  };
  $("verifyBtn").onclick = () => { const ok = gate.verifyAudit(); if (!ok) tampered = true; refresh(); addLog(ok ? "good" : "bad", ok ? "Log check: all " + gate.audit.length + " entries are intact." : "Log check: TAMPERING DETECTED."); };

  if (!Scene3D.init($("scene"))) { $("nogl").hidden = false; }
  setInterval(() => { if (gate) { gate.beginSecond(); refresh(); } }, 1000);
  restart(); scheduleNurse();
  window.RWDemo = {hack, nurseSend, restart, state: () => ({st, isolated: gate.isolated, cfgKey, tampered}), setConfig(k) { $("def").value = k; cfgKey = k; restart(); }};
})();
