const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {FleetController} = require("./fleet.js");

const packagedNetwork = path.join(__dirname, "network.json");
const viewer = path.join(__dirname, "../output/visualizations/Clinic-World.html");
const network = JSON.parse(fs.existsSync(packagedNetwork)
  ? fs.readFileSync(packagedNetwork, "utf8")
  : fs.readFileSync(viewer, "utf8").split('<script id="fleet-network" type="application/json">')[1].split("</script>")[0]);

function advance(fleet, seconds) {
  for (let i = 0; i < Math.round(seconds * 10); i++) fleet.step(.1);
}
function until(fleet, condition, seconds) {
  for (let i = 0; i < seconds * 10 && !condition(); i++) fleet.step(.1);
  assert.ok(condition(), "condition was not reached within " + seconds + " simulated seconds");
}
function send(fleet, robot, action, args = {}) {
  const id = "T" + fleet.eventNumber;
  fleet.enqueue({id, robot:robot.id, action, ...args});
  advance(fleet, .2);
  return fleet.completedCommands.get(id);
}
function start() {
  const fleet = new FleetController(network);
  advance(fleet, 1);
  return fleet;
}

test("all three devices can deliver on both floors while sharing lanes and Lift 1", () => {
  const fleet = start(), [rx, lab, sup] = fleet.robots;
  function trip(destinations) {
    for (const [unit, destination] of destinations) {
      assert.ok(send(fleet, unit, "dispatch", {destination}).ok);
    }
    let simultaneous = false;
    for (let i = 0; i < 4000 && fleet.robots.some(r => r.mission.stage !== "arrived"); i++) {
      fleet.step(.1);
      const claimed = new Set();
      for (const robot of fleet.robots) {
        assert.equal(robot.alert, null, "ordinary turns and authorized lift requests should pass");
        for (const key of fleet.claims(robot)) {
          assert.ok(!claimed.has(key), "two robots reserved " + key);
          claimed.add(key);
        }
      }
      if (fleet.robots.filter(r => r.segment && r.booked).length >= 2) simultaneous = true;
    }
    assert.ok(simultaneous, "independent robots can travel simultaneously");
    for (const robot of fleet.robots) {
      assert.equal(fleet.state(robot), "Awaiting receipt");
      assert.equal(robot.at, network.stations[robot.mission.dest].node);
      assert.ok(send(fleet, robot, "receipt").ok);
      assert.equal(fleet.state(robot), "Ready");
    }
  }
  trip([[rx, "WARD-B"], [sup, "WARD-A"]]);  // LAB-02 already has the demo assignment.
  trip([[rx, "PHARMACY"], [lab, "COLLECTION"], [sup, "STORES"]]);
  assert.ok(fleet.messages.some(e => e.kind === "WAIT"));
  assert.equal(fleet.messages.filter(e => e.kind === "LIFT" && e.from === "Lift gate").length, 6);
  assert.deepEqual(fleet.robots.map(r => r.completed), [2, 2, 2]);
});

test("pausing mid-lane preserves occupancy and resuming completes the same mission", () => {
  const fleet = start(), [rx, lab] = fleet.robots;
  assert.ok(send(fleet, rx, "dispatch", {destination:"WARD-B"}).ok);
  until(fleet, () => rx.segment?.progress > .05, 15);
  const mission = rx.mission.id;
  assert.ok(send(fleet, rx, "pause").ok);
  const position = {...rx.pose}, other = {...lab.pose};
  advance(fleet, 2);
  assert.deepEqual(rx.pose, position);
  assert.notDeepEqual(lab.pose, other);
  assert.ok(fleet.claims(rx).has(rx.segment.from) && fleet.claims(rx).has(rx.segment.to));
  assert.ok(send(fleet, rx, "resume").ok);
  until(fleet, () => rx.mission.stage === "arrived", 180);
  assert.equal(rx.mission.id, mission);
});

test("uncommanded spin is observed before the hold; isolation and manual recovery are independent", () => {
  const fleet = start(), [rx, lab] = fleet.robots;
  assert.ok(send(fleet, rx, "dispatch", {destination:"WARD-B"}).ok);
  advance(fleet, 1);
  const otherStart = {...lab.pose}, at = {...rx.pose};
  assert.ok(send(fleet, rx, "example", {example:"spin"}).ok);
  advance(fleet, 1);
  assert.equal(rx.alert, null);
  assert.notEqual(rx.pose.yaw, at.yaw);
  until(fleet, () => rx.alert?.rule === "spin", 4);
  assert.match(rx.alert.observed, /90°\/s/);
  assert.notDeepEqual(lab.pose, otherStart);
  assert.equal(lab.alert, null);
  assert.equal(fleet.state(rx), "Safety hold");
  assert.ok(send(fleet, rx, "isolate").ok);
  assert.ok(!send(fleet, rx, "dispatch", {destination:"WARD-A"}).ok);
  assert.ok(!send(fleet, rx, "resume").ok);
  assert.equal(fleet.liftRequest(rx, "L2", rx.mission.id), false);
  assert.ok(!send(fleet, rx, "release").ok);
  assert.ok(send(fleet, rx, "end").ok);
  advance(fleet, 1.5);
  assert.ok(send(fleet, rx, "release").ok);
  assert.equal(fleet.state(rx), "Paused");
  assert.ok(send(fleet, rx, "resume").ok);
  assert.equal(rx.alert, null);
  assert.ok(fleet.messages.find(e => e.kind === "ALERT").observed);
});

test("a short heartbeat gap recovers; an overdue heartbeat holds only the silent device", () => {
  const fleet = start(), [rx, lab, sup] = fleet.robots;
  assert.ok(send(fleet, sup, "example", {example:"silence"}).ok);
  advance(fleet, 2);
  assert.equal(sup.alert, null);
  assert.ok(send(fleet, sup, "end").ok);
  advance(fleet, 2);
  assert.ok(sup.lastBeat > 3);
  assert.ok(send(fleet, sup, "example", {example:"silence"}).ok);
  const last = sup.lastBeat;
  until(fleet, () => sup.alert?.rule === "silence", 5);
  assert.ok(Math.abs(sup.alert.time - last - 4) < .11);
  assert.equal(rx.alert, null);
  assert.equal(lab.alert, null);
  assert.ok(send(fleet, sup, "isolate").ok);
  assert.ok(send(fleet, sup, "end").ok);
  advance(fleet, 1.5);
  assert.ok(send(fleet, sup, "release").ok);
  assert.equal(fleet.state(sup), "Ready");
});

test("a mismatched lift request is denied and the alert retains the assigned floor", () => {
  const fleet = start(), [rx, lab] = fleet.robots;
  assert.ok(send(fleet, lab, "example", {example:"lift"}).ok);
  assert.equal(lab.alert.rule, "lift");
  assert.match(lab.alert.expected, /L2/);
  assert.match(lab.alert.observed, /L1/);
  assert.ok(fleet.messages.some(e => e.kind === "DENY" && e.robot === lab.id));
  assert.ok(!fleet.messages.some(e => e.kind === "LIFT"));
  assert.ok(send(fleet, rx, "example", {example:"lift"}).ok);
  assert.match(rx.alert.expected, /No active lift assignment/);
});

test("retries are idempotent and a command ACK is distinct from a ward receipt", () => {
  const fleet = start(), [rx, lab, sup] = fleet.robots;
  assert.ok(!send(fleet, rx, "receipt").ok);
  const first = send(fleet, rx, "dispatch", {destination:"WARD-B"});
  assert.ok(first.ok);
  fleet.enqueue({id:first.id, robot:rx.id, action:"dispatch", destination:"WARD-B"});
  assert.equal(fleet.acks.at(-1), first);
  assert.equal(fleet.messages.filter(e => e.kind === "TASK" && e.robot === rx.id).length, 1);
  assert.ok(!send(fleet, sup, "dispatch", {destination:"WARD-B"}).ok);
  assert.ok(!send(fleet, lab, "receipt").ok);
  until(fleet, () => rx.mission.stage === "arrived", 180);
  assert.equal(rx.completed, 0);
  const receipt = send(fleet, rx, "receipt");
  assert.ok(receipt.ok);
  fleet.enqueue({id:receipt.id, robot:rx.id, action:"receipt"});
  assert.equal(rx.completed, 1);
  assert.ok(!send(fleet, rx, "receipt").ok);
});
