"use strict";
// Benchmark runner: 20 test rows + containment scenarios + retained-service workload, for M0..M4 and the combined stack.
// Usage: node gate/run.cjs [outdir]    Seed and limits are fixed below; rows were written before any run.
const fs = require("node:fs");
const path = require("node:path");
const {Gate, makeWorld, issueToken, PATIENT_NAMES, LIMITS} = require("./gate.cjs");

const SEED = 2611, CAPACITY = 20, WINDOW_S = 30, LEGIT_PER_S = 5, ATTACK_PER_S = 40, T0 = 1_000_000;
const CONFIGS = {
  M0: {}, M1: {M1: true}, M2: {M2: true}, M3: {M3: true}, M4: {M4: true},
  ALL: {M1: true, M2: true, M3: true, M4: true}
};

function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function fresh(cfg) {
  const w = makeWorld(), clock = {t: T0}, g = new Gate(w, cfg, clock);
  const tok = (u, t, d, ttl) => issueToken(u, t, d, clock.t, ttl);
  const dreq = (u, t, d, extra = {}) => ({type: "deliver", user: u, task_id: t, destination: d, token: tok(u, t, d), source: "WARD-" + u, ...extra});
  return {w, g, clock, tok, dreq};
}
const leaks = (...parts) => PATIENT_NAMES.some(n => JSON.stringify(parts).includes(n));

// ---- rows: each returns {pass, detail}. Unauthorized: pass = no robot action and no patient string reachable.
const rows = {
  U01: c => { const {g, w, dreq} = fresh(c); const r = dreq("N1", "T1", "Room 12"); delete r.token; return unauth(g, w, [r]); },
  U02: c => { const {g, w, dreq} = fresh(c); const r = dreq("N1", "T1", "Room 12"); r.token = r.token.slice(0, -4) + "AAAA"; return unauth(g, w, [r]); },
  U03: c => { const {g, w, clock, dreq} = fresh(c); const r = dreq("N1", "T1", "Room 12"); r.token = issueToken("N1", "T1", "Room 12", clock.t - 600000, 300000); return unauth(g, w, [r]); },
  U04: c => { const {g, w, dreq} = fresh(c); const r = dreq("N1", "T1", "Room 12"); g.handle(r); return unauth(g, w, [{...r}]); },
  U05: c => { const {g, w, dreq} = fresh(c); return unauth(g, w, [dreq("N2", "T1", "Room 12")]); },
  U06: c => { const {g, w, dreq} = fresh(c); const r = dreq("N1", "T1", "Room 12"); r.destination = "Pharmacy"; return unauth(g, w, [r]); },
  U07: c => { const {g, w, dreq} = fresh(c); return unauth(g, w, [dreq("N1", "T1", "Room 12", {patient_name: PATIENT_NAMES[0]})]); },
  U08: c => { const {g, w, dreq} = fresh(c); return unauth(g, w, [dreq("N1", "T99", "Room 12")]); },
  U09: c => { const {g, w, dreq} = fresh(c); return unauth(g, w, [dreq("N3", "T1", "Room 12")]); },
  U10: c => {   // flood of 20 unauthenticated requests in one second; pass = at most LIMITS.ratePerSecond reach the robot and the flood is cut off
    const {g, w} = fresh(c); const before = w.robot.actions, out = [];
    for (let i = 0; i < 20; i++) out.push(g.handle({type: "deliver", user: "N1", task_id: "T1", destination: "Room 12", source: "ATK"}));
    const acted = w.robot.actions - before;
    return {pass: acted <= LIMITS.ratePerSecond && !leaks(out, w.robot.inbox, g.audit), detail: acted + "/20 reached the robot"};
  },
  A01: c => deliver(c, "N1", "T1", "Room 12"), A02: c => deliver(c, "N1", "T2", "Pharmacy"),
  A03: c => deliver(c, "N2", "T3", "Lab"), A04: c => deliver(c, "N2", "T4", "Room 7"),
  A05: c => deliver(c, "P1", "T5", "Storage"),
  A06: c => deliver(c, "N1", "T6", "Room 12"),
  A07: c => { const {g, w, clock, dreq} = fresh(c); const r = dreq("N1", "T1", "Room 12"); r.token = issueToken("N1", "T1", "Room 12", clock.t, 1000); clock.t += 500; return done(g.handle(r), w, "T1"); },
  A08: c => { const {g, w, tok} = fresh(c); const r = g.handle({type: "status", user: "N1", task_id: "T1", token: tok("N1", "T1", ""), source: "WARD-N1"});
    return {pass: r.ok && !leaks(r, g.audit) && Object.keys(r.status).sort().join() === "destination,status,task_id", detail: r.ok ? "status minimal" : r.reason}; },
  A09: c => { const {g, w, dreq} = fresh(c); const a = g.handle(dreq("N1", "T7", "Room 12")), b = g.handle(dreq("N1", "T8", "Pharmacy"));
    return {pass: a.ok && b.ok && w.tasks.T7.status === "DELIVERED" && w.tasks.T8.status === "DELIVERED", detail: a.ok && b.ok ? "both delivered" : (a.reason || b.reason)}; },
  A10: c => { const {g, w, tok} = fresh(c); const r = g.handle({type: "cancel", user: "N1", task_id: "T9", token: tok("N1", "T9", ""), source: "WARD-N1"});
    return {pass: r.ok && w.tasks.T9.status === "CANCELLED" && g.audit.some(e => e.event === "cancel"), detail: r.ok ? "cancelled and logged" : r.reason}; }
};
function unauth(g, w, reqs) {
  const before = w.robot.actions, out = reqs.map(r => g.handle(r));
  const acted = w.robot.actions - before, leaked = leaks(out, w.robot.inbox, g.audit);
  return {pass: acted === 0 && !leaked, detail: acted ? acted + " robot action(s)" : leaked ? "patient data reached robot/log" : "blocked: " + (out[out.length - 1].reason || "n/a")};
}
function deliver(c, u, t, d) { const {g, w, dreq} = fresh(c); return done(g.handle(dreq(u, t, d)), w, t); }
function done(r, w, t) { return {pass: r.ok && w.tasks[t].status === "DELIVERED" && w.robot.inbox.length === 1 && Object.keys(w.robot.inbox[0]).length >= 2, detail: r.ok ? "delivered" : r.reason}; }

// ---- containment rows C01..C04 (only meaningful when a breaker exists)
function attackBurst(f, n = 20) { for (let i = 0; i < n; i++) { f.clock.t += 10; f.g.handle({type: "deliver", user: "N1", task_id: "X" + i, destination: "Room 12", source: "ATK"}); } }
const contain = {
  C01: c => { const f = fresh(c); attackBurst(f); const tripped = f.g.isolated, a = f.w.robot.actions;
    f.g.handle(f.dreq("N1", "T1", "Room 12")); f.g.handle(f.dreq("N2", "T3", "Lab"));
    return {pass: tripped && f.w.robot.actions === a, detail: "tripped=" + tripped + ", forwards after trip=" + (f.w.robot.actions - a)}; },
  C02: c => { const f = fresh(c); attackBurst(f); const v = f.g.nurseView(), d = f.g.handle(f.dreq("N1", "T1", "Room 12")),
      s = f.g.handle({type: "status", user: "N1", task_id: "T1", token: f.tok("N1", "T1", ""), source: "WARD-N1"}),
      x = f.g.handle({type: "cancel", user: "N1", task_id: "T1", token: f.tok("N1", "T1", ""), source: "WARD-N1"});
    const n = [v.ok && v.mode === "manual", d.ok && d.mode === "manual", s.ok, x.ok].filter(Boolean).length;
    return {pass: f.g.isolated && n === 4, detail: "ward actions ok " + n + "/4 while isolated=" + f.g.isolated, n}; },
  C03: c => { const f = fresh(c), snap = JSON.stringify(f.w.tasks);
    f.g.robotMessage({task_id: "T1", status: "DELIVERED", pad: "x".repeat(10000)});
    f.g.robotMessage({task_id: "T2", status: "DELIVERED", destination: "Room 7", owner: "ATK", admin: true});
    f.g.robotMessage({task_id: "T3", status: "DELIVERED", patch: {role: "supervisor"}});
    const unchanged = JSON.stringify(f.w.tasks) === snap, big = JSON.stringify(f.g.audit).length > 5000;
    return {pass: unchanged && !big && f.g.verifyAudit(), detail: "ward data unchanged=" + unchanged + ", audit stayed small=" + !big}; },
  C04: c => { const f = fresh(c); attackBurst(f); const bad = f.g.reset("N1").ok, good = f.g.reset("S1").ok;
    const r = f.g.handle(f.dreq("N1", "T1", "Room 12"));
    return {pass: !bad && good && r.ok && r.mode === "robot" && f.w.tasks.T1.status === "DELIVERED", detail: "nurse reset=" + bad + ", supervisor reset=" + good + ", next task " + (r.mode || r.reason)}; }
};

// ---- retained service level: same seed, equal windows, attack vs no attack
function workload(cfg, attack) {
  const rnd = prng(SEED), w = makeWorld(), clock = {t: T0}, g = new Gate(w, cfg, clock, CAPACITY);
  const who = [["N1", "Room 12", "med"], ["N1", "Pharmacy", "med"], ["N2", "Room 7", "med"], ["N2", "Lab", "specimen"], ["P1", "Storage", "linen"]];
  let handled = 0, robot = 0, manual = 0, firstAttackMs = null, legitSent = 0;
  for (let s = 0; s < WINDOW_S; s++) {
    g.beginSecond();
    const batch = [];
    for (let i = 0; i < LEGIT_PER_S; i++) {
      const [u, d, type] = who[i], id = "L" + s + "_" + i;
      w.tasks[id] = {dest: d, type, owner: u, status: "REGISTERED"};
      batch.push({legit: true, req: null, mk: () => ({type: "deliver", user: u, task_id: id, destination: d, token: issueToken(u, id, d, clock.t), source: "WARD-" + u})});
    }
    if (attack) for (let i = 0; i < ATTACK_PER_S; i++) batch.push({legit: false, mk: () => ({type: "deliver", user: "N1", task_id: "X" + s + "_" + i, destination: "Room 12", source: "ATK"})});
    for (let i = batch.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [batch[i], batch[j]] = [batch[j], batch[i]]; }
    batch.forEach((b, i) => {
      clock.t = T0 + s * 1000 + Math.floor(i * 1000 / batch.length);
      if (!b.legit && firstAttackMs === null) firstAttackMs = clock.t;
      const r = g.handle(b.mk());
      if (b.legit) { legitSent++; if (r.ok) { handled++; r.mode === "manual" ? manual++ : robot++; } }
    });
  }
  return {handled, robot, manual, legitSent, tripMs: g.tripAt === null || firstAttackMs === null ? null : g.tripAt - firstAttackMs, shed: g.shed};
}

function runAll() {
  const out = {};
  for (const [id, cfg] of Object.entries(CONFIGS)) {
    const res = {rows: {}, containment: {}};
    for (const [r, fn] of Object.entries(rows)) res.rows[r] = fn(cfg);
    const hasBreaker = !!cfg.M4;
    for (const [r, fn] of Object.entries(contain)) {
      res.containment[r] = (r === "C03" || hasBreaker) ? fn(cfg) : {pass: null, detail: "not applicable: no breaker/isolation mechanism"};
    }
    const calm = workload(cfg, false), hit = workload(cfg, true);
    res.retained = {no_attack: calm, attack: hit, retained_pct: Math.round(1000 * hit.handled / calm.handled) / 10};
    const U = Object.entries(res.rows).filter(([k]) => k[0] === "U"), A = Object.entries(res.rows).filter(([k]) => k[0] === "A");
    res.summary = {blocked: U.filter(([, v]) => v.pass).length, completed: A.filter(([, v]) => v.pass).length,
      containment_passed: hasBreaker || true ? Object.entries(res.containment).filter(([, v]) => v.pass === true).length : 0,
      containment_applicable: Object.values(res.containment).filter(v => v.pass !== null).length};
    out[id] = res;
  }
  return out;
}

function main() {
  const results = runAll();
  const doc = {meta: {seed: SEED, capacityPerSecond: CAPACITY, windowSeconds: WINDOW_S, legitPerSecond: LEGIT_PER_S, attackPerSecond: ATTACK_PER_S,
    limits: LIMITS, node: process.version, command: "node gate/run.cjs", label: "measured on a simulated, fictional-data model; author-written test rows"}, results};
  const outdir = process.argv[2] || path.join(__dirname, "..", "experiments", "runs", "latest");
  fs.mkdirSync(outdir, {recursive: true});
  fs.writeFileSync(path.join(outdir, "results.json"), JSON.stringify(doc, null, 2));
  console.log("method  blocked  completed  containment  retained%  (robot/manual during attack)");
  for (const [id, r] of Object.entries(results)) {
    console.log(id.padEnd(7), (r.summary.blocked + "/10").padEnd(8), (r.summary.completed + "/10").padEnd(10),
      (r.summary.containment_passed + "/" + r.summary.containment_applicable).padEnd(12), String(r.retained.retained_pct).padEnd(10),
      r.retained.attack.robot + "/" + r.retained.attack.manual);
  }
  console.log("written", path.join(outdir, "results.json"));
}
if (require.main === module) main();
module.exports = {runAll, CONFIGS, rows, contain};
