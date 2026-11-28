"use strict";
// Tests for the extra robots (3 to 10) added to the live hack demo's fleet controller, and for the traffic check that keeps them moving.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const extra = require("./hacker/fleet-extra.cjs");
const FleetTraffic = require("./hacker/fleet-traffic.js");

const root = path.join(__dirname, "..");
const network = require("../clinic3d/network.json");
const consoleHtml = fs.readFileSync(path.join(root, "output", "visualizations", "Clinic-World.html"), "utf8");
const workerSource = consoleHtml.match(/<script id="fleet-worker-source" type="text\/plain">\n([\s\S]*?)\n<\/script>/)[1];
const patchedNetwork = extra.patchNetwork(network);

function makeFleet() {
  const mod = {exports: {}};
  new Function("module", extra.patchWorkerSource(workerSource))(mod);
  return new mod.exports.FleetController(patchedNetwork);
}
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let n = 0;
const send = (f, cmd) => { const c = Object.assign({id: "T" + (++n)}, cmd); f.enqueue(c); return c.id; };
const run = (f, seconds, each) => { for (let t = 0; t < seconds; t += 0.1) { f.step(0.1); if (each) each(f); } };
const ackOf = (f, id) => f.completedCommands.get(id);
const stationAt = (f, node) => Object.keys(f.net.stations).find(k => f.net.stations[k].node === node);

// A dispatcher that behaves like the demo app: it only sends a robot when the traffic check finds a complete free route.
function trafficAwareDriver(f, destinations, rnd, stats) {
  const traffic = FleetTraffic.make(f.net), planned = new Map(), plannedAt = new Map(), waitingSince = new Map();
  return () => {
    if (Math.round(f.time * 10) % 20 !== 0) return;                   // decide every 2 simulated seconds
    const robots = f.snapshot().robots;
    for (const r of robots) {                                           // forget planned routes once the controller has reserved them
      if (planned.has(r.id) && (r.path.length || !r.mission || f.time - plannedAt.get(r.id) > 4)) planned.delete(r.id);
    }
    for (const r of robots) {
      if (r.active === false) continue;
      if (r.mission && r.mission.stage === "arrived") { send(f, {robot: r.id, action: "receipt"}); stats.delivered++; continue; }
      if (r.mission && !r.path.length && r.state === "Waiting") { const t0 = waitingSince.get(r.id) ?? f.time; waitingSince.set(r.id, t0); stats.maxWait = Math.max(stats.maxWait, f.time - t0); } else waitingSince.delete(r.id);
      if (r.mission || r.isolated || r.alert || r.retire) continue;
      const open = destinations.filter(d => d !== r.station);
      const choice = open[Math.floor(rnd() * open.length)], route = traffic.routeFree(robots, r.id, choice, planned);
      if (!route) { stats.skipped++; continue; }
      planned.set(r.id, new Set(route)); plannedAt.set(r.id, f.time);
      send(f, {robot: r.id, action: "dispatch", destination: choice}); stats.sent++;
    }
  };
}

test("bays and checkpoints are dead-end spurs that can never block a through route", () => {
  const nodes = network.nodes, nb = new Map(Object.keys(nodes).map(k => [k, new Set()]));
  for (const [a, b] of network.edges) { nb.get(a).add(b); nb.get(b).add(a); }
  const stationNodes = new Set(Object.values(network.stations).map(s => s.node)), lift = new Set(network.cabins);
  for (const c of network.cabins) for (const m of nb.get(c)) lift.add(m);
  const spurs = [...extra.BAY_NODES, ...extra.CHECKPOINT_NODES];
  assert.equal(spurs.length, 14);
  assert.equal(new Set(spurs).size, 14, "all distinct");
  for (const k of spurs) {
    assert.ok(nodes[k], k + " exists");
    assert.equal(nb.get(k).size, 1, k + " is a dead end");
    assert.ok(!stationNodes.has(k) && !lift.has(k), k + " is not a station or in the lift zone");
  }
  assert.equal(extra.EXTRA_ROBOTS.length, extra.FLEET_MAX - extra.FLEET_MIN);
});

test("the patch applies, and the fleet starts with 3 robots on duty and 7 parked off duty in their bays", () => {
  const f = makeFleet(), s = f.snapshot();
  assert.equal(s.robots.length, 10);
  assert.deepEqual(s.robots.map(r => r.active), [true, true, true, false, false, false, false, false, false, false]);
  s.robots.slice(3).forEach((r, i) => { assert.equal(r.state, "Off duty"); assert.equal(r.at, extra.BAY_NODES[i]); assert.equal(r.station, "BAY-" + (i + 1)); assert.equal(r.home, "BAY-" + (i + 1)); });
  assert.equal(s.events.filter(e => e.kind === "LINK").length, 3, "only the robots on duty announce themselves");
  const id = send(f, {robot: "RX-04", action: "dispatch", destination: "PHARMACY"}); run(f, 1);
  assert.equal(ackOf(f, id).ok, false);
  assert.equal(ackOf(f, id).reason, "This robot is off duty.");
});

test("fleet size must be 3 to 10", () => {
  const f = makeFleet();
  for (const bad of [2, 11, 0, "abc", null]) { const id = send(f, {robot: "", action: "fleetsize", value: bad}); run(f, 1); assert.equal(ackOf(f, id).ok, false, String(bad)); }
  const id = send(f, {robot: "", action: "fleetsize", value: 10}); run(f, 1);
  assert.equal(ackOf(f, id).ok, true);
  assert.equal(f.snapshot().robots.filter(r => r.active).length, 10);
});

test("a waiting mission can be cancelled to clear a traffic jam, and a moving one cannot", () => {
  const f = makeFleet();
  const none = send(f, {robot: "SUP-03", action: "cancel"}); run(f, 1);
  assert.equal(ackOf(f, none).reason, "No mission to cancel.");
  // a robot that is waiting for lanes: it has a mission but the controller is not trying to reserve a route
  const waiting = f.robots[2]; waiting.mission = {id: "M900", dest: "WARD-A", stage: "travel", issued: 0, traveled: 0}; waiting.retryAt = 1e9;
  assert.equal(f.state(waiting), "Waiting");
  const ok = send(f, {robot: "SUP-03", action: "cancel"}); run(f, 0.5);
  assert.equal(ackOf(f, ok).ok, true); assert.equal(waiting.mission, null); assert.equal(f.state(waiting), "Ready");
  // a robot that is in the middle of a lane cannot be cancelled; it can only be cancelled at a node
  const d = send(f, {robot: "RX-01", action: "dispatch", destination: "WARD-A"}); run(f, 1);
  assert.equal(ackOf(f, d).ok, true);
  let guard = 0; while (!(f.robots[0].segment && f.robots[0].segment.progress > 0.3 && f.robots[0].segment.progress < 0.6) && guard++ < 2000) f.step(0.05);
  assert.ok(f.robots[0].segment, "robot is moving mid-lane");
  assert.equal(f.apply(f.robots[0], {action: "cancel"}), "Wait until the robot reaches the next node.");
  assert.ok(f.robots[0].mission, "the mission is kept");
});

test("ten robots with the traffic check share the lift and corridors without overlap or lasting jams", () => {
  const f = makeFleet(), rnd = prng(2611), stats = {delivered: 0, sent: 0, skipped: 0, maxWait: 0};
  send(f, {robot: "", action: "fleetsize", value: 10}); run(f, 1);
  const destinations = Object.keys(network.stations).concat(extra.CHECKPOINT_NODES.map((_, i) => "CHK-" + (i + 1)));
  const driver = trafficAwareDriver(f, destinations, rnd, stats);
  let overlaps = 0;
  run(f, 900, () => {
    const seen = new Set();
    for (const r of f.robots) { if (seen.has(r.at)) overlaps++; seen.add(r.at); }
    driver();
  });
  console.log("      10 robots, 900 s:", JSON.stringify(stats));
  assert.equal(overlaps, 0, "no two robots ever hold the same node");
  assert.ok(stats.delivered >= 40, "robots keep delivering (delivered " + stats.delivered + ")");
  assert.ok(stats.maxWait < 60, "no robot waits for traffic clearance for a minute (longest wait " + stats.maxWait.toFixed(1) + " s)");
  assert.ok(f.robots.every(r => !r.alert), "no safety alerts");
});

test("every fleet size from 3 to 10 keeps moving", () => {
  for (const size of [3, 4, 6, 8, 10]) {
    const f = makeFleet(), rnd = prng(100 + size), stats = {delivered: 0, sent: 0, skipped: 0, maxWait: 0};
    send(f, {robot: "", action: "fleetsize", value: size}); run(f, 1);
    const driver = trafficAwareDriver(f, Object.keys(network.stations).concat(extra.CHECKPOINT_NODES.map((_, i) => "CHK-" + (i + 1))), rnd, stats);
    run(f, 600, driver);
    assert.ok(stats.delivered >= 12 && stats.maxWait < 60, size + " robots: " + JSON.stringify(stats));
  }
});

test("reducing the fleet sends the extra robots back to their bays and off duty, and the first three stay on duty", () => {
  const f = makeFleet(), rnd = prng(7), traffic = FleetTraffic.make(f.net);
  send(f, {robot: "", action: "fleetsize", value: 10}); run(f, 1);
  const stats = {delivered: 0, sent: 0, skipped: 0, maxWait: 0}, driver = trafficAwareDriver(f, Object.keys(network.stations).concat(extra.CHECKPOINT_NODES.map((_, i) => "CHK-" + (i + 1))), rnd, stats);
  run(f, 120, driver);                                           // everybody is out and about
  send(f, {robot: "", action: "fleetsize", value: 3}); run(f, 1);
  for (const r of f.robots.slice(3)) if (r.at !== f.net.stations[r.home].node) assert.ok(r.active, r.id + " is away from its bay, so it stays on duty until it is home");
  const planned = new Map();
  run(f, 900, () => {
    if (Math.round(f.time * 10) % 20 !== 0) return;
    const robots = f.snapshot().robots;
    for (const r of robots) {
      if (r.mission && r.mission.stage === "arrived") { send(f, {robot: r.id, action: "receipt"}); continue; }
      if (r.retire && !r.mission && r.at !== f.net.stations[r.home].node) { const route = traffic.routeFree(robots, r.id, r.home, planned); if (route) { planned.set(r.id, new Set(route)); send(f, {robot: r.id, action: "dispatch", destination: r.home}); } }
      else if (!r.retire && !r.mission && r.active !== false) { const open = Object.keys(network.stations).filter(d => d !== r.station), c = open[Math.floor(rnd() * open.length)], route = traffic.routeFree(robots, r.id, c, planned); if (route) { planned.set(r.id, new Set(route)); send(f, {robot: r.id, action: "dispatch", destination: c}); } }
    }
    for (const [id, nodes] of planned) { const r = f.robots.find(x => x.id === id); if (!r.mission || r.path.length) planned.delete(id); }
  });
  const s = f.snapshot();
  assert.deepEqual(s.robots.map(r => r.active), [true, true, true, false, false, false, false, false, false, false]);
  s.robots.slice(3).forEach((r, i) => { assert.equal(r.state, "Off duty"); assert.equal(r.at, extra.BAY_NODES[i]); });
});

test("the original console controller still has exactly three robots (the patch is for the demo page only)", () => {
  const mod = {exports: {}};
  new Function("module", workerSource)(mod);
  const s = new mod.exports.FleetController(network).snapshot();
  assert.equal(s.robots.length, 3);
  assert.ok(s.robots.every(r => r.active === undefined));
});
