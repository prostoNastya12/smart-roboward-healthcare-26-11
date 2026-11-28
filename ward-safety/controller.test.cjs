"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {WardSimulation, MockLift, evaluate} = require("./controller.js");
const network = require("../clinic3d/network.json");
const run = round => new WardSimulation({network, round});
function counts(s) {
  const j = s.state().journey;
  return [j.forwardedCalls, j.cabinEntries, j.confirmedLandings, j.receipts];
}

test("registered aliases allow exactly one physical cabin entry and ward receipt", () => {
  const s = run("approved");
  s.advance(140);
  assert.deepEqual(counts(s), [1,1,1,0]);
  assert.equal(s.state().robots[0].at, network.stations["WARD-B"].node);
  assert.equal(s.act("wardScan"), true);
  assert.equal(s.act("wardScan"), false);
  assert.deepEqual(counts(s), [1,1,1,1]);
  assert.equal(s.state().journey.holder, "Ward B");
  const kinds = s.state().events.map(e => e.kind);
  for (const [earlier,later] of [["dispatch","forward"],["forward","entry"],["entry","landing"],["arrival","receipt"]]) {
    assert.ok(kinds.indexOf(earlier) < kinds.indexOf(later));
  }
});

test("unreviewed maps, priority and missing facilities data stop at an upstream holding node", () => {
  for (const [round,action] of [["unverified","approveMapping"],["priority","clearPriority"],["roam","restoreFeed"]]) {
    const s = run(round);
    s.advance(150);
    assert.equal(s.state().journey.outcome, "hold");
    assert.deepEqual(counts(s), [0,0,0,0]);
    const r = s.fleet.robots[0];
    assert.ok(!s.fleet.liftZone.has(r.at));
    for (const cabin of network.cabins) assert.ok(!s.fleet.claims(r).has(cabin));
    assert.ok(s.act(action));
    s.advance(100);
    assert.deepEqual(counts(s), [1,1,1,0]);
  }
});

test("a known floor outside the assignment is denied before forwarding and boarding", () => {
  const s = run("forbidden"); s.advance(150);
  assert.equal(s.state().journey.outcome, "deny");
  assert.deepEqual(counts(s), [0,0,0,0]);
  assert.ok(!s.act("wardScan") && !s.act("approveMapping"));
});

test("a manual handoff changes custody only on acceptance, arrival alone leaves receipt open", () => {
  const s = run("priority"); s.advance(90);
  assert.ok(s.act("offerPorter"));
  assert.equal(s.state().journey.holder, "RX-01");
  assert.ok(s.act("acceptPorter"));
  assert.equal(s.state().journey.holder, "Porter");
  assert.ok(!s.act("wardScan"));
  s.advance(14); assert.ok(s.act("wardScan"));
  assert.deepEqual(counts(s), [0,0,0,1]); assert.equal(s.state().journey.holder, "Ward B");
});

test("priority after a forward inhibits boarding, and a repeat reuses the original reservation", () => {
  const s = run("approved");
  while (counts(s)[0] === 0 && s.fleet.time < 100) s.advance(.1);
  s.fleet.site.priority = true;
  s.advance(30);
  assert.equal(s.state().journey.outcome, "hold");
  assert.deepEqual(counts(s), [1,0,0,0]);
  s.act("clearPriority"); s.advance(100);
  assert.deepEqual(counts(s), [1,1,1,0]);
});

test("an interrupted landing feed keeps the robot inside the cabin until a fresh confirmation", () => {
  const s = run("approved");
  while (counts(s)[1] === 0 && s.fleet.time < 100) s.advance(.1);
  s.fleet.site.connected = false;
  s.advance(30);
  assert.equal(s.state().journey.phase, "landing");
  assert.equal(s.state().robots[0].at, network.cabins[1]);
  assert.equal(counts(s)[2], 0);
  s.fleet.site.connected = true;
  s.advance(40); assert.deepEqual(counts(s), [1,1,1,0]);
});

test("independent sessions, deterministic time stepping and mock request correlation", () => {
  const a = run("approved"), b = run("approved");
  a.advance(18); for (let i=0;i<90;i++) b.advance(.2);
  assert.deepEqual(a.state(), b.state());
  const lift = new MockLift("approved"), req = a.fleet.request;
  assert.equal(lift.receive(req), "accepted");
  assert.equal(lift.receive({...req}), "existing");
  assert.equal(lift.receive({...req,rawFloor:"Ground"}), "conflict");
  assert.equal(lift.calls.size, 1);
  assert.equal(evaluate(req,a.fleet.grant,lift,10).outcome,"allow");
  assert.equal(evaluate(req,a.fleet.grant,lift,10.001).outcome,"hold");
  assert.equal(evaluate(req,a.fleet.grant,lift,3600).outcome,"deny");
});
