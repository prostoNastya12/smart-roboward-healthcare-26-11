"use strict";
// Smart RoboWard request gate. Written on site, Node standard library only.
// Every method layers one mechanism on top of the M0 baseline (static allowlist of known task IDs).
// All data is fictional. SECRET is a public demo value, not a real key.
const crypto = require("node:crypto");

const SECRET = "synthetic-demo-secret-not-real";
const PATIENT_NAMES = ["Erika Mustermann", "Max Beispiel", "Anna Testfall"]; // fictional, server-side only
const SCHEMA_KEYS = new Set(["type", "user", "task_id", "destination", "token", "source"]);
const ROBOT_MSG_KEYS = new Set(["task_id", "status"]);
const ROBOT_STATUSES = new Set(["DELIVERED", "IN_TRANSIT", "FAILED"]);
const LIMITS = {ratePerSecond: 5, denialsToTrip: 5, robotMsgBytes: 200}; // fixed before any run
const ALERT_TO = "Security duty lead";   // who is told when the breaker trips

const hmac = body => crypto.createHmac("sha256", SECRET).update(body).digest();

function issueToken(user, task, dest, now, ttlMs = 300000, nonce) {
  const body = Buffer.from(JSON.stringify({u: user, t: task, d: dest, exp: now + ttlMs, n: nonce ?? user + ":" + task + ":" + now})).toString("base64url");
  return body + "." + hmac(body).toString("base64url");
}

function makeWorld() {
  const tasks = {
    T1: {dest: "Room 12", type: "med", owner: "N1"}, T2: {dest: "Pharmacy", type: "med", owner: "N1"},
    T3: {dest: "Lab", type: "specimen", owner: "N2"}, T4: {dest: "Room 7", type: "med", owner: "N2"},
    T5: {dest: "Storage", type: "linen", owner: "P1"}, T6: {dest: "Room 12", type: "med", owner: "N1"},
    T7: {dest: "Room 12", type: "med", owner: "N1"}, T8: {dest: "Pharmacy", type: "med", owner: "N1"},
    T9: {dest: "Room 12", type: "med", owner: "N1"}, T10: {dest: "Room 12", type: "med", owner: "N1"}
  };
  for (const t of Object.values(tasks)) t.status = "REGISTERED";
  return {
    users: {
      N1: {role: "nurse", wards: ["A"]}, N2: {role: "nurse", wards: ["B"]}, P1: {role: "porter", wards: ["A", "B"]},
      N3: {role: "nurse", wards: ["A"], revoked: true}, S1: {role: "supervisor", wards: ["A", "B"]},
      V1: {role: "vendor", wards: []}   // a visiting vendor's account: a real login, but no delivery rights and no tasks of its own
    },
    destinations: {"Room 12": "A", "Room 7": "B", "Pharmacy": "SHARED", "Lab": "SHARED", "Storage": "SHARED"},
    tasks,
    patients: {T1: PATIENT_NAMES[0], T2: PATIENT_NAMES[1], T3: PATIENT_NAMES[2]}, // never leaves the server
    robot: {inbox: [], actions: 0}
  };
}

class Gate {
  // cfg: {M1, M2, M3, M4} booleans. M0 allowlist is always on.
  constructor(world, cfg, clock, capacity = Infinity) {
    this.w = world; this.cfg = cfg; this.clock = clock; this.cap = capacity; this.left = capacity;
    this.usedNonces = new Set(); this.buckets = new Map(); this.blocked = new Set();
    this.isolated = false; this.tripAt = null; this.shed = 0; this.manualCount = 0; this.robotCount = 0;
    this.audit = []; this.alerts = [];   // alerts: one record per security incident, each naming who was told and the evidence
  }
  beginSecond() { this.left = this.cap; }

  log(event, detail) {
    const prev = this.audit.length ? this.audit[this.audit.length - 1].hash : "genesis";
    const entry = {seq: this.audit.length, ts: this.clock.t, event, detail, prev};
    entry.hash = crypto.createHash("sha256").update(prev + JSON.stringify([entry.seq, entry.ts, event, detail])).digest("hex");
    this.audit.push(entry);
  }
  verifyAudit() {
    let prev = "genesis";
    for (const e of this.audit) {
      const h = crypto.createHash("sha256").update(prev + JSON.stringify([e.seq, e.ts, e.event, e.detail])).digest("hex");
      if (e.prev !== prev || e.hash !== h) return false;
      prev = e.hash;
    }
    return true;
  }

  deny(req, reason) {
    if (this.cfg.M4 && req && typeof req.source === "string") {
      const b = this.bucket(req.source); b.denials++;
      b.recent.push({reason, user: typeof req.user === "string" ? req.user : null, ts: this.clock.t}); if (b.recent.length > 12) b.recent.shift();   // evidence for the alert
      if (b.denials >= LIMITS.denialsToTrip) this.trip(req.source, "repeated denials");
    }
    this.log("deny", reason);
    return {ok: false, reason};
  }
  bucket(src) {
    let b = this.buckets.get(src);
    if (!b) this.buckets.set(src, b = {sec: -1, count: 0, denials: 0, recent: [], users: new Set()});
    return b;
  }
  trip(src, why) {
    const first = !this.isolated;
    this.blocked.add(src);
    if (first) { this.isolated = true; this.tripAt = this.clock.t; }
    this.log("breaker-trip", {source: src, why});
    this.raiseAlert(src, why, first);
  }
  // Detection -> alert: a trip writes one alert record that names the recipient and carries the evidence. It stays open until a
  // supervisor restores the robots (reset). A further source tripping during the same incident is added to the open alert.
  raiseAlert(src, why, first) {
    const open = this.alerts.find(a => a.status === "open"), b = this.bucket(src);
    if (open && !first) {
      if (!open.sources.includes(src)) { open.sources.push(src); this.log("alert-update", {id: open.id, source: src}); }
      return;
    }
    const reasons = {}; for (const e of b.recent) reasons[e.reason] = (reasons[e.reason] || 0) + 1;
    const alert = {id: this.alerts.length + 1, to: ALERT_TO, at: this.clock.t, status: "open", why, sources: [src],
      evidence: {requests: why === "rate" ? b.count : b.denials, reasons, users: [...b.users], windowMs: b.recent.length > 1 ? b.recent[b.recent.length - 1].ts - b.recent[0].ts : 0}};
    this.alerts.push(alert);
    this.log("alert-sent", {id: alert.id, to: alert.to, source: src, why, evidence: alert.evidence});
  }

  verifyToken(req) {
    const t = req.token;
    if (typeof t !== "string") return "missing token";
    const [body, sig] = t.split(".");
    if (!body || !sig) return "malformed token";
    const want = hmac(body), got = Buffer.from(sig, "base64url");
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return "bad signature";
    let p;
    try { p = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return "malformed token"; }
    if (this.clock.t > p.exp) return "expired token";
    if (p.u !== req.user || p.t !== req.task_id) return "token does not match request";
    if (req.type === "deliver") {
      if (p.d !== req.destination) return "token does not match request";
      if (this.usedNonces.has(p.n)) return "replayed token";
    }
    return {nonce: p.n};
  }

  policy(req, task) {
    const u = this.w.users[req.user];
    if (!u || u.revoked) return "unknown or revoked user";
    if (u.role === "vendor") return "vendors have no delivery rights";
    if (req.type === "deliver") {
      if (u.role === "porter" && task.type !== "linen") return "role not allowed for task type";
      const ward = this.w.destinations[req.destination];
      if (!ward) return "unknown destination";
      if (ward !== "SHARED" && !u.wards.includes(ward)) return "destination outside user's ward";
    } else if (task.owner !== req.user && u.role !== "supervisor") return "not task owner";
    return null;
  }

  handle(req) {
    const src = req && typeof req.source === "string" ? req.source : "?";
    if (this.cfg.M4 && this.blocked.has(src)) { this.shed++; return {ok: false, reason: "source isolated", shed: true}; }
    if (this.left <= 0) return {ok: false, reason: "gate overloaded"};
    this.left--;
    // naive logging keeps the whole request; M3 logs only schema fields
    this.log("request", this.cfg.M3 ? {type: req?.type, task_id: req?.task_id, source: src} : JSON.stringify(req));
    if (this.cfg.M4) {
      const b = this.bucket(src), sec = Math.floor(this.clock.t / 1000);
      if (req && typeof req.user === "string") b.users.add(req.user);
      if (b.sec !== sec) { b.sec = sec; b.count = 0; }
      if (++b.count > LIMITS.ratePerSecond) { this.trip(src, "rate"); return {ok: false, reason: "rate limit exceeded"}; }
    }
    if (!req || typeof req !== "object") return this.deny(req, "malformed request");
    if (this.cfg.M3) {
      for (const k of Object.keys(req)) if (!SCHEMA_KEYS.has(k)) return this.deny(req, "unknown field rejected");
    }
    if (req.type === "lift") return this.lift(req);
    const task = this.w.tasks[req.task_id];
    if (!task || task.status === "CANCELLED") return this.deny(req, "unknown task");   // M0 allowlist
    if (!["deliver", "status", "cancel"].includes(req.type)) return this.deny(req, "unknown request type");
    let nonce;
    if (this.cfg.M1) {
      const v = this.verifyToken(req);
      if (typeof v === "string") return this.deny(req, v);
      nonce = v.nonce;
    }
    if (this.cfg.M2) {
      const p = this.policy(req, task);
      if (p) return this.deny(req, p);
    }
    if (req.type === "status") return {ok: true, status: {task_id: req.task_id, status: task.status, destination: task.dest}};
    if (req.type === "cancel") { task.status = "CANCELLED"; this.log("cancel", {task_id: req.task_id}); return {ok: true}; }
    if (nonce !== undefined) this.usedNonces.add(nonce);
    if (this.isolated) {   // robot zone isolated: degraded manual mode
      task.status = "MANUAL"; this.manualCount++;
      this.log("manual", {task_id: req.task_id});
      return {ok: true, mode: "manual"};
    }
    const payload = this.cfg.M3 ? {task_id: req.task_id, destination: req.destination} : {...req};
    this.w.robot.inbox.push(payload);
    if (typeof payload.task_id === "string" && typeof payload.destination === "string") {
      this.w.robot.actions++; this.robotCount++; task.status = "DELIVERED";
    }
    this.log("forward", {task_id: req.task_id});
    return {ok: true, mode: "robot"};
  }

  // A request to ride the lift. Only a delivery that is assigned to the requester earns a lift trip. A valid login is not enough:
  // a vendor account with no delivery asks for the lift and is denied. The audit log records the requesting user ID either way.
  lift(req) {
    const user = typeof req.user === "string" ? req.user : null;
    this.log("lift-request", {user, task_id: req.task_id ?? null, source: req.source});
    if (this.cfg.M1) {
      const v = this.verifyToken(req);
      if (typeof v === "string") return this.deny(req, v);
    }
    const task = this.w.tasks[req.task_id];
    if (!task || task.status === "CANCELLED" || task.owner !== req.user) {
      this.log("lift-denied", {user, reason: "no task assigned"});
      return this.deny(req, "no task assigned");
    }
    if (this.cfg.M2) {
      const u = this.w.users[req.user];
      if (!u || u.revoked) return this.deny(req, "unknown or revoked user");
    }
    this.log("lift-granted", {user, task_id: req.task_id});
    return {ok: true, mode: "lift"};
  }

  // Messages coming back from the (possibly compromised) robot.
  robotMessage(msg) {
    if (this.cfg.M3 || this.cfg.M4) {
      const size = Buffer.byteLength(JSON.stringify(msg) ?? "");
      const okKeys = msg && typeof msg === "object" && Object.keys(msg).every(k => ROBOT_MSG_KEYS.has(k));
      if (size > LIMITS.robotMsgBytes || !okKeys || !ROBOT_STATUSES.has(msg.status) || !this.w.tasks[msg.task_id]) {
        this.log("robot-msg-dropped", {bytes: size});
        return {ok: false};
      }
      this.w.tasks[msg.task_id].status = msg.status;
      return {ok: true};
    }
    // baseline: trusts the robot and merges whatever it sends into the ward record
    if (msg && this.w.tasks[msg.task_id]) Object.assign(this.w.tasks[msg.task_id], msg);
    this.log("robot-msg", JSON.stringify(msg));
    return {ok: true};
  }

  nurseView() {
    return {ok: true, mode: this.isolated ? "manual" : "robot",
      tasks: Object.entries(this.w.tasks).map(([id, t]) => ({task_id: id, status: t.status, destination: t.dest}))};
  }
  reset(user) {
    const u = this.w.users[user];
    if (!u || u.role !== "supervisor") { this.log("reset-denied", {user}); return {ok: false}; }
    this.isolated = false; this.blocked.clear(); this.buckets.clear(); this.tripAt = null;
    for (const a of this.alerts) if (a.status === "open") { a.status = "restored"; a.closedBy = user; a.closedAt = this.clock.t; }
    this.log("reset", {user});
    return {ok: true};
  }
}

module.exports = {Gate, makeWorld, issueToken, PATIENT_NAMES, LIMITS};
