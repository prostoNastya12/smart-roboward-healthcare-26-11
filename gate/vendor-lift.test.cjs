"use strict";
// Scenario: a vendor account asks for the lift with no delivery.
// A vendor has a real login (a valid token) but no delivery rights and no tasks of its own. The gate must deny the lift request,
// the robot must not move, and the audit log must record the vendor's user ID.
const test = require("node:test");
const assert = require("node:assert/strict");
const {Gate, makeWorld, issueToken} = require("./gate.cjs");
const {CONFIGS} = require("./run.cjs");

function setup(cfg) { const w = makeWorld(), clock = {t: 1_000_000}, g = new Gate(w, cfg, clock); return {w, g, clock}; }
const liftReq = (clock, user, task, extra) => Object.assign({type: "lift", user, task_id: task, token: issueToken(user, task, "", clock.t), source: "VENDOR-PC"}, extra);

test("the world has a vendor user with no delivery rights", () => {
  const {w} = setup({});
  assert.equal(w.users.V1.role, "vendor");
  assert.deepEqual(w.users.V1.wards, []);
  assert.ok(!Object.values(w.tasks).some(t => t.owner === "V1"), "the vendor owns no task");
});

for (const [name, cfg] of Object.entries(CONFIGS)) {
  test("vendor token asking for the lift with no delivery is denied, the robot stays put, and the audit log names the vendor (" + name + ")", () => {
    const {w, g, clock} = setup(cfg);
    const actions = w.robot.actions;
    const res = g.handle(liftReq(clock, "V1", null));
    assert.equal(res.ok, false, "denied");
    assert.equal(res.reason, "no task assigned");
    assert.equal(w.robot.actions, actions, "the robot did not move");
    assert.equal(w.robot.inbox.length, 0, "nothing was sent to the robot");
    const mine = g.audit.filter(e => e.detail && typeof e.detail === "object" && e.detail.user === "V1").map(e => e.event);
    assert.ok(mine.includes("lift-request"), "the request is logged with the vendor user ID");
    assert.ok(mine.includes("lift-denied"), "the denial is logged with the vendor user ID");
    assert.ok(g.audit.some(e => e.event === "deny" && e.detail === "no task assigned"));
    assert.ok(g.verifyAudit(), "the audit chain is intact");
  });
}

test("a vendor naming somebody else's delivery still gets no lift", () => {
  for (const cfg of Object.values(CONFIGS)) {
    const {w, g, clock} = setup(cfg);
    const res = g.handle(liftReq(clock, "V1", "T1"));   // T1 belongs to nurse N1
    assert.equal(res.ok, false); assert.equal(res.reason, "no task assigned"); assert.equal(w.robot.actions, 0);
  }
});

test("a staff member with their own assigned delivery does get the lift, and it is logged", () => {
  const {g, clock} = setup(CONFIGS.ALL);
  const res = g.handle(liftReq(clock, "N1", "T1", {source: "WARD-N1"}));
  assert.equal(res.ok, true); assert.equal(res.mode, "lift");
  assert.ok(g.audit.some(e => e.event === "lift-granted" && e.detail.user === "N1"));
});

test("a forged vendor token is stopped on identity first when tickets are checked, and on the missing delivery otherwise", () => {
  const {g, clock} = setup(CONFIGS.M1), r = liftReq(clock, "V1", null); r.token = r.token.slice(0, -4) + "AAAA";
  assert.equal(g.handle(r).reason, "bad signature");
  const m0 = setup(CONFIGS.M0), r0 = liftReq(m0.clock, "V1", null); r0.token = "garbage";
  assert.equal(m0.g.handle(r0).reason, "no task assigned");
});

test("a vendor cannot order a delivery either (ward rules)", () => {
  const {w, g, clock} = setup(CONFIGS.ALL);
  const req = {type: "deliver", user: "V1", task_id: "T2", destination: "Pharmacy", token: issueToken("V1", "T2", "Pharmacy", clock.t), source: "VENDOR-PC"};
  const res = g.handle(req);
  assert.equal(res.ok, false); assert.equal(res.reason, "vendors have no delivery rights"); assert.equal(w.robot.actions, 0);
});

test("repeated vendor lift requests count towards the breaker", () => {
  const {g, clock} = setup(CONFIGS.ALL);
  for (let i = 0; i < 6; i++) { clock.t += 300; g.handle(liftReq(clock, "V1", null)); }
  assert.equal(g.isolated, true);
  assert.equal(g.alerts.length, 1);
  assert.ok(g.alerts[0].evidence.users.includes("V1"));
  assert.ok(g.alerts[0].evidence.reasons["no task assigned"] >= 5);
});
