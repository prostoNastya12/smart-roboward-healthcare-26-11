"use strict";
// One incident, from detection to a human restoring the robots:
// the breaker trips -> an alert record names who was told and carries the evidence -> the robots stay isolated, with no automatic
// reset -> only a supervisor can restore them -> the next task goes by robot again.
const test = require("node:test");
const assert = require("node:assert/strict");
const {Gate, makeWorld, issueToken} = require("./gate.cjs");
const {CONFIGS} = require("./run.cjs");

function setup(cfg = CONFIGS.ALL) { const w = makeWorld(), clock = {t: 1_000_000}, g = new Gate(w, cfg, clock); return {w, g, clock}; }
const attack = (g, clock, n, source = "ATK") => { for (let i = 0; i < n; i++) { clock.t += 80; g.handle({type: "deliver", user: "N1", task_id: "T1", destination: "Room 12", source}); } };
const delivery = (clock, id) => ({type: "deliver", user: "N1", task_id: id, destination: "Room 12", token: issueToken("N1", id, "Room 12", clock.t), source: "WARD-N1"});

test("a trip sends one alert to the Security duty lead, with the evidence, and writes it to the audit chain", () => {
  const {g, clock} = setup();
  attack(g, clock, 8);
  assert.equal(g.isolated, true);
  assert.equal(g.alerts.length, 1);
  const a = g.alerts[0];
  assert.equal(a.to, "Security duty lead");
  assert.equal(a.status, "open");
  assert.deepEqual(a.sources, ["ATK"]);
  assert.ok(a.evidence.requests >= 5, "requests refused: " + a.evidence.requests);
  assert.ok(a.evidence.reasons["missing token"] >= 5, "reasons: " + JSON.stringify(a.evidence.reasons));
  assert.deepEqual(a.evidence.users, ["N1"]);
  assert.ok(a.evidence.windowMs > 0);
  const entry = g.audit.find(e => e.event === "alert-sent");
  assert.ok(entry, "the alert is in the audit log");
  assert.equal(entry.detail.to, "Security duty lead");
  assert.equal(entry.detail.source, "ATK");
  assert.ok(g.verifyAudit());
});

test("a flood trips the breaker by rate, and the alert says so", () => {
  const {g, clock} = setup();
  for (let i = 0; i < 8; i++) g.handle({type: "status", user: "N1", task_id: "T1", token: issueToken("N1", "T1", "", clock.t), source: "FLOOD"});   // valid requests, but too many in one second
  assert.equal(g.isolated, true);
  assert.equal(g.alerts[0].why, "rate");
  assert.ok(g.alerts[0].evidence.requests > 5);
});

test("there is no automatic reset: ten minutes later the robots are still isolated and the alert is still open", () => {
  const {w, g, clock} = setup();
  attack(g, clock, 8);
  clock.t += 10 * 60 * 1000;
  const res = g.handle(delivery(clock, "T2"));
  assert.equal(res.ok, true); assert.equal(res.mode, "manual", "tasks go by hand while the robots are isolated");
  assert.equal(g.isolated, true);
  assert.equal(g.alerts[0].status, "open");
  assert.equal(w.robot.actions, 0, "the robot did not move");
});

test("only a supervisor can restore the robots; then the alert is closed by name and the next task goes by robot", () => {
  const {w, g, clock} = setup();
  attack(g, clock, 8);
  for (const who of ["N1", "P1", "V1", "N3", "nobody"]) { assert.equal(g.reset(who).ok, false, who + " cannot restore"); assert.equal(g.isolated, true); }
  assert.equal(g.alerts[0].status, "open");
  assert.equal(g.reset("S1").ok, true);
  assert.equal(g.isolated, false);
  assert.equal(g.alerts[0].status, "restored"); assert.equal(g.alerts[0].closedBy, "S1");
  clock.t += 1000;
  const next = g.handle(delivery(clock, "T3"));
  assert.equal(next.ok, true); assert.equal(next.mode, "robot", "the next task goes by robot");
  assert.equal(w.robot.actions, 1);
  assert.ok(g.audit.some(e => e.event === "reset" && e.detail.user === "S1"));
  assert.ok(g.verifyAudit());
});

test("a second source tripping during the same incident is added to the open alert, not a new one", () => {
  const {g, clock} = setup();
  attack(g, clock, 8, "ATK-1");
  attack(g, clock, 8, "ATK-2");
  assert.equal(g.alerts.length, 1);
  assert.deepEqual(g.alerts[0].sources, ["ATK-1", "ATK-2"]);
  assert.ok(g.audit.some(e => e.event === "alert-update"));
});

test("after a restore, a new attack is a new incident with its own alert", () => {
  const {g, clock} = setup();
  attack(g, clock, 8); g.reset("S1");
  clock.t += 5000; attack(g, clock, 8, "ATK-3");
  assert.equal(g.alerts.length, 2);
  assert.equal(g.alerts[0].status, "restored"); assert.equal(g.alerts[1].status, "open");
});

test("without the breaker (M0 to M3) there is no incident and no alert", () => {
  for (const cfg of [CONFIGS.M0, CONFIGS.M1, CONFIGS.M2, CONFIGS.M3]) { const {g, clock} = setup(cfg); attack(g, clock, 30); assert.equal(g.alerts.length, 0); assert.equal(g.isolated, false); }
});
