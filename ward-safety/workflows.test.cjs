"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const workflows = require("./workflows.js");
const fixtures = require("../output/simulation/smart-roboward-scenarios.json");
const {buildPreview, demoPreview, CustodyLedger, RoutineQueue} = workflows;

test("policy preview replays the input states independently without reading the answer keys", () => {
  const input = structuredClone(fixtures);
  for (const c of input.scenarios) {
    delete c.expected;
    delete c.observed;
  }
  const original = JSON.stringify(input);
  const {cases} = buildPreview(input);
  assert.equal(JSON.stringify(input), original);
  const a01 = cases.A01;
  assert.deepEqual(a01.active.decisions, [{id: "T42-1", time: 120, decision: "allow", reason: "authorized"}]);
  assert.deepEqual(a01.candidate.decisions, [{id: "T42-1", time: 120, decision: "deny", reason: "ward_b_omitted"}]);
  assert.deepEqual([a01.active.grants, a01.active.receipts, a01.active.holder], [1, 1, "WARD-B"]);
  assert.deepEqual([a01.candidate.grants, a01.candidate.receipts, a01.candidate.holder], [0, 0, "SIM-R1"]);
  assert.deepEqual(cases.U06.active, cases.U06.candidate);
  assert.equal(cases.U06.candidate.decisions[0].reason, "floor_mismatch");
  assert.deepEqual(cases.A02.active, cases.A02.candidate);
  assert.equal(cases.A02.candidate.receipts, 1);
  assert.deepEqual(cases.A05.active.priority, [{id: "URG-T46", time: 119, wait: 0}]);
  assert.deepEqual(cases.A05.candidate.priority, cases.A05.active.priority);
  assert.deepEqual(cases.A05.active.decisions.map(d => d.decision), ["hold", "allow"]);
  assert.deepEqual(cases.A05.candidate.decisions.map(d => d.decision), ["hold", "deny"]);
  assert.deepEqual([cases.A05.active.receipts, cases.A05.candidate.receipts], [1, 0]);
  assert.equal(buildPreview(input).cases.A01.active.grants, 1);
});

test("policy decisions respond to source facts, and missing coverage is displayed as untested", () => {
  const input = structuredClone(fixtures);
  const a01 = input.scenarios.find(c => c.case_id === "A01");
  input.scenarios = [a01];
  a01.initial_state.demo_permit.expires_at_s = 120;
  const result = buildPreview(input);
  assert.equal(result.cases.A01.active.decisions[0].reason, "permit_expired");
  assert.deepEqual(result.cases.A01.candidate, result.cases.A01.active);
  const view = demoPreview(result);
  assert.equal(view.find(r => r.label.startsWith("U06")).active, "Untested");
  assert.equal(view.find(r => r.label.includes("Facilities")).candidate, "Untested");
  assert.equal(view.find(r => r.label.includes("Fire-service")).candidate, "Untested");
});

function receipt(id, tripId, parcel, station = "Ward B") {
  return {id, tripId, parcel, station, role: "ward-scanner"};
}

test("a tote binding ends on matching unload and can be reassigned; only one matching ward receipt closes a trip", () => {
  const ledger = new CustodyLedger();
  assert.equal(ledger.open("Y", "A", "Ward B", "R1"), true);
  ledger.open("T", "B", "Ward B", "R2");
  ledger.load("Y", "T7");
  assert.equal(ledger.load("T", "T7"), false);
  ledger.arrive("Y", "Ward B", "R1");
  assert.equal(ledger.unload("Y", "T7", "B"), false);
  assert.equal(ledger.unload("Y", "T7", "A"), true);
  ledger.scan(receipt("R-Y", "Y", "A"));
  assert.equal(ledger.readTote("T7"), null);
  assert.equal(ledger.load("T", "T7"), true);
  assert.deepEqual(ledger.readTote("T7"), {tripId: "T", parcel: "B", holder: "R2"});
  assert.equal(ledger.scan(receipt("R-T", "T", "B")), "rejected");
  assert.equal(ledger.offer("T", "P2"), true);
  assert.equal(ledger.trips.get("T").holder, "R2");
  assert.equal(ledger.accept("T", "P1"), false);
  assert.equal(ledger.accept("T", "P2"), true);
  assert.equal(ledger.accept("T", "P2"), false);
  assert.equal(ledger.arrive("T", "Ward B", "R2"), false);
  assert.equal(ledger.arrive("T", "Ward B", "P2"), true);
  assert.equal(ledger.scan(receipt("R-T", "T", "B")), "rejected");
  ledger.unload("T", "T7", "B");
  assert.equal(ledger.scan(receipt("R-T", "T", "A")), "rejected");
  assert.equal(ledger.scan(receipt("R-T", "T", "B", "Ward A")), "rejected");
  const scan = receipt("R-T", "T", "B");
  assert.equal(ledger.scan({...scan, role: "logistics"}), "rejected");
  assert.equal(ledger.scan(scan), "recorded");
  assert.equal(ledger.scan(scan), "duplicate");
  assert.equal(ledger.scan({...scan, id: "R-T-again"}), "rejected");
  assert.equal(ledger.scan({...scan, parcel: "C"}), "conflict");
  assert.equal(ledger.effectiveReceipts(), 2);
  assert.equal(ledger.records.size, 2);
  assert.equal(ledger.trips.get("T").holder, "Ward B");
});

test("physical reconciliation links both records, leaves the missing parcel outstanding and handles retries atomically", () => {
  const ledger = new CustodyLedger();
  for (const parcel of ["C", "D"]) {
    ledger.open(parcel, parcel, "Ward B", "R" + parcel);
    ledger.load(parcel, "T7");
    ledger.arrive(parcel, "Ward B", "R" + parcel);
    ledger.unload(parcel, "T7", parcel);
  }
  const original = receipt("R3", "C", "C");
  ledger.scan(original);
  const correction = {id: "C4", originalId: "R3", tripId: "D", parcel: "D", station: "Ward B",
    originalHolder: "RC", role: "ward-reviewer", reconciled: true};
  for (const invalid of [{role: "porter"}, {reconciled: false}, {originalId: "unknown"}, {originalHolder: "entity"},
    {station: "Ward A"}, {parcel: "C"}]) {
    assert.equal(ledger.correct({...correction, ...invalid}), "rejected");
    assert.equal(ledger.trips.get("C").receipt, "R3");
    assert.equal(ledger.trips.get("D").receipt, null);
  }
  assert.equal(ledger.correct(correction), "recorded");
  assert.equal(ledger.correct(correction), "duplicate");
  assert.equal(ledger.correct({...correction, tripId: "other"}), "conflict");
  assert.equal(ledger.correct({...correction, id: "C5"}), "rejected");
  assert.equal(ledger.scan(original), "duplicate");
  assert.equal(ledger.trips.get("C").receipt, null);
  assert.equal(ledger.trips.get("C").holder, "RC");
  assert.equal(ledger.trips.get("D").holder, "Ward B");
  assert.equal(ledger.trips.get("D").receipt, "C4");
  assert.equal(ledger.records.get("C4").originalId, ledger.records.get("R3").id);
  assert.equal(ledger.records.size, 2);
  assert.equal(ledger.effectiveReceipts(), 1);
  assert.equal(ledger.scan(receipt("R5", "C", "C")), "rejected");
  assert.equal(ledger.arrive("C", "Ward B", "RC"), true);
  assert.equal(ledger.scan(receipt("R5", "C", "C")), "recorded");
  assert.equal(ledger.effectiveReceipts(), 2);
});

function job(tripId, vendor, robot = tripId, requestId = tripId) {
  return {tripId, vendor, robot, requestId, destination: "Ward B"};
}

test("capacity is shared across namespaces and retries consume one outstanding slot per logical trip", () => {
  const queue = new RoutineQueue(["A", "B"], 2, 1);
  const first = job("J1", "A", "Robot-1", "attempt-1");
  assert.deepEqual(queue.submit(first, 0), {status: "queued"});
  assert.equal(queue.submit(first, 0).status, "duplicate");
  assert.equal(queue.submit({...first, requestId: "reattempt"}, 0).status, "duplicate");
  assert.equal(queue.submit({...first, destination: "Ward A"}, 0).status, "conflict");
  assert.equal(queue.submit({...first, tripId: "different"}, 0).status, "conflict");
  assert.equal(queue.submit(job("J3", "A", "Robot-1"), 0).reason, "Robot limit");
  assert.equal(queue.submit(job("J2", "B", "Robot-1", "attempt-1"), 0).status, "queued");
  assert.equal(queue.submit(job("J3", "A"), 0).reason, "Shared limit");
  assert.equal(queue.pending.length, 2);
  assert.equal(queue.board(1).tripId, "J1");
  assert.equal(queue.submit(job("J3", "A"), 2).owner, "Logistics");
  assert.equal(queue.board(2).status, "occupied");
  assert.equal(queue.finish("J2", 2), false);
  assert.equal(queue.finish("J1", 3), true);
  assert.deepEqual(queue.submit(first, 3), {status: "duplicate", phase: "completed"});
  assert.equal(queue.submit(job("J3", "A"), 3).status, "queued");
  assert.equal(queue.jobs.size, 3);
});

test("round-robin vendor scheduling, FIFO, eligibility recheck and priority preserve one occupant", () => {
  const queue = new RoutineQueue(["A", "B"], 4);
  for (const input of [job("1", "A"), job("2", "A"), job("3", "B"), job("4", "B")]) queue.submit(input, 0);
  assert.deepEqual(queue.board(1), {status: "boarded", tripId: "1", age: 1});
  assert.deepEqual(queue.acknowledgePriority(2), {requestedAt: 2, acknowledgedAt: 2, availableAt: null});
  assert.deepEqual(queue.acknowledgePriority(3), {requestedAt: 2, acknowledgedAt: 2, availableAt: null});
  assert.equal(queue.clearPriority(3), false);
  assert.equal(queue.board(3).status, "held for patient transfer");
  assert.equal(queue.occupant.tripId, "1");
  queue.finish("1", 5);
  assert.equal(queue.priority.availableAt, 5);
  assert.equal(queue.board(5).status, "held for patient transfer");
  assert.equal(queue.clearPriority(6), true);
  assert.equal(queue.board(6, () => false).status, "no eligible job");
  // B3's route is still waiting for clearance; the independently eligible B4 can proceed.
  assert.deepEqual(queue.board(7, j => j.tripId !== "3"), {status: "boarded", tripId: "4", age: 7});
  queue.finish("4", 8);
  assert.equal(queue.board(8).tripId, "2");
  queue.finish("2", 9);
  assert.equal(queue.board(9).tripId, "3");
  queue.finish("3", 10);
  assert.equal(queue.pending.length, 0);
  assert.throws(() => queue.board(7), /monotonically/);
});

test("browser views use only the bundled evidence and produce deterministic comparison rows", () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve("./workflows.js"), "utf8"), context);
  const preview = buildPreview(fixtures);
  const browser = context.WardWorkflows;
  assert.deepEqual(JSON.parse(JSON.stringify(browser.demoPreview(preview))), workflows.demoPreview(fixtures));
  for (const demo of ["demoCustody", "demoQueue"]) {
    const fromBrowser = JSON.parse(JSON.stringify(browser[demo]()));
    assert.deepEqual(fromBrowser, workflows[demo]());
    assert.ok(fromBrowser.length > 0 && fromBrowser.every(r => ["label", "active", "candidate"].every(k => typeof r[k] === "string")));
  }
});
