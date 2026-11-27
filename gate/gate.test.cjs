"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {runAll, CONFIGS, rows} = require("./run.cjs");
const {Gate, makeWorld, issueToken} = require("./gate.cjs");

test("benchmark is deterministic (same seed, same output)", () => {
  assert.deepEqual(runAll(), runAll());
});

test("every method is run on the same 20 rows and has both rates", () => {
  assert.equal(Object.keys(rows).length, 20);
  for (const r of Object.values(runAll())) {
    assert.equal(Object.keys(r.rows).length, 20);
    assert.ok(r.summary.blocked >= 0 && r.summary.blocked <= 10);
    assert.ok(r.summary.completed >= 0 && r.summary.completed <= 10);
  }
});

test("a legitimate request must never be blocked by the full stack", () => {
  const all = runAll().ALL;
  for (const [id, v] of Object.entries(all.rows)) if (id[0] === "A") assert.ok(v.pass, id + ": " + v.detail);
});

test("tampered token is rejected and no patient data reaches the robot payload", () => {
  const w = makeWorld(), clock = {t: 5000}, g = new Gate(w, CONFIGS.ALL, clock);
  const token = issueToken("N1", "T1", "Room 12", clock.t);
  const bad = g.handle({type: "deliver", user: "N1", task_id: "T1", destination: "Room 12", token: token.slice(0, -3) + "xyz", source: "S"});
  assert.equal(bad.ok, false);
  const ok = g.handle({type: "deliver", user: "N1", task_id: "T1", destination: "Room 12", token, source: "S"});
  assert.ok(ok.ok);
  assert.deepEqual(Object.keys(w.robot.inbox[0]).sort(), ["destination", "task_id"]);
  assert.ok(g.verifyAudit());
});

test("editing the audit log is detected", () => {
  const w = makeWorld(), g = new Gate(w, CONFIGS.ALL, {t: 1});
  g.handle({type: "status", user: "N1", task_id: "T1", source: "S"});
  g.handle({type: "status", user: "N1", task_id: "T2", source: "S"});
  assert.ok(g.verifyAudit());
  g.audit[0].detail = "edited";
  assert.equal(g.verifyAudit(), false);
});
