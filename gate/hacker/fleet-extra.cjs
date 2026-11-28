"use strict";
// Up to ten robots for the live hack demo.
// The fleet console ships with three robots. For the DEMO PAGE ONLY, the build adds seven more to the embedded fleet controller
// and map (clinic3d/ and the original console are not touched):
//  - the extra robots start "off duty", parked in their own bay,
//  - a "fleetsize" command (3 to 10) puts robots on duty, or sends the extra ones back to their bay and off duty,
//  - bays and patrol checkpoints are dead-end spurs of the clinic map, so a parked robot can never block a through route.
const FLEET_MIN = 3, FLEET_MAX = 10;

// Dead-end map nodes that are not stations, lifts or lift neighbours (checked by gate/fleet-extra.test.cjs).
const BAY_NODES = ["L1/363", "L1/407", "L1/395", "L1/425", "L2/280", "L2/334", "L2/319"];
const CHECKPOINT_NODES = ["L1/392", "L1/411", "L1/424", "L1/429", "L2/323", "L2/304", "L2/313"];

const EXTRA_ROBOTS = [
  {id: "RX-04", name: "Pharmacy courier", preferred: "WARD-B", color: "#2f6fb0", speed: 1.0, shape: "cabinet"},
  {id: "LAB-05", name: "Specimen courier", preferred: "LAB", color: "#b0386a", speed: 1.15, shape: "pod"},
  {id: "SUP-06", name: "Supply carrier", preferred: "WARD-A", color: "#6f8a1e", speed: 0.95, shape: "shelves"},
  {id: "RX-07", name: "Pharmacy courier", preferred: "WARD-A", color: "#1f8a9a", speed: 1.1, shape: "cabinet"},
  {id: "LAB-08", name: "Specimen courier", preferred: "LAB", color: "#8a5a2f", speed: 1.2, shape: "pod"},
  {id: "SUP-09", name: "Supply carrier", preferred: "WARD-B", color: "#556b7a", speed: 0.9, shape: "shelves"},
  {id: "RX-10", name: "Pharmacy courier", preferred: "WARD-B", color: "#c29a1a", speed: 1.05, shape: "cabinet"}
].map((r, i) => Object.assign(r, {home: "BAY-" + (i + 1), patrol: "CHK-" + (i + 1)}));

// Adds the bays and checkpoints as stations, so ordinary dispatch orders can send a robot to them.
function patchNetwork(network) {
  const net = JSON.parse(JSON.stringify(network));
  BAY_NODES.forEach((node, i) => { net.stations["BAY-" + (i + 1)] = {name: "Parking bay " + (i + 1), node}; });
  CHECKPOINT_NODES.forEach((node, i) => { net.stations["CHK-" + (i + 1)] = {name: "Checkpoint " + (i + 1), node}; });
  for (const key of [...BAY_NODES, ...CHECKPOINT_NODES]) if (!net.nodes[key]) throw new Error("Unknown map node " + key);
  return net;
}

function replaceOnce(src, needle, replacement, label) {
  const parts = src.split(needle);
  if (parts.length !== 2) throw new Error("Fleet controller patch '" + label + "': expected exactly one match, found " + (parts.length - 1));
  return parts[0] + replacement + parts[1];
}

// Applies the edits to the text of clinic3d/fleet.js as embedded in the console page.
function patchWorkerSource(src) {
  const extra = EXTRA_ROBOTS.map(r => '  {id:"' + r.id + '", name:"' + r.name + '", home:"' + r.home + '", preferred:"' + r.preferred +
    '", color:"' + r.color + '", speed:' + r.speed + ', shape:"' + r.shape + '", active:false}').join(",\n");
  let out = src;
  out = replaceOnce(out, 'shape:"shelves"}\n];', 'shape:"shelves"},\n' + extra + '\n];', "robot profiles");
  out = replaceOnce(out, 'for (const r of this.robots) this.log("LINK", r, "Controller", r.id, "Simulated device connected");',
    'for (const r of this.robots) if (r.active !== false) this.log("LINK", r, "Controller", r.id, "Simulated device connected");', "link log");
  out = replaceOnce(out, 'speed:"Set simulation speed"}[cmd.action]', 'speed:"Set simulation speed",fleetsize:"Set fleet size",cancel:"Cancel mission"}[cmd.action]', "command label");
  // The console cannot cancel a mission that is stuck waiting for lanes. The demo's watchdog needs this to clear a traffic jam.
  out = replaceOnce(out, '      case "end":\n        if (!r.example) return "No example is running.";',
    '      case "cancel":\n' +
    '        if (!r.mission) return "No mission to cancel.";\n' +
    '        if (r.segment) return "Wait until the robot reaches the next node.";\n' +
    '        r.mission = null; r.path = []; r.booked = false; r.paused = false; r.retryAt = 0; r.waitReason = "";\n' +
    '        this.log("TASK", r, "Dispatcher", r.id, "Mission cancelled to clear a traffic jam", cmd.id);\n' +
    '        return "";\n' +
    '      case "end":\n        if (!r.example) return "No example is running.";', "cancel command");
  out = replaceOnce(out, '    } else if (!r) error = "Unknown fleet device.";',
    '    } else if (cmd.action === "fleetsize") error = this.setFleetSize(cmd.value);\n    else if (!r) error = "Unknown fleet device.";', "fleetsize command");
  out = replaceOnce(out, '  apply(r, cmd) {\n    switch (cmd.action) {',
    '  apply(r, cmd) {\n    if (r.active === false) return "This robot is off duty.";\n    switch (cmd.action) {', "off duty guard");
  out = replaceOnce(out, '  canRelease(r) {',
    '  setFleetSize(value) {\n' +
    '    const n = Math.round(Number(value)), max = this.robots.length;\n' +
    '    if (!(n >= ' + FLEET_MIN + ' && n <= max)) return "Fleet size must be between ' + FLEET_MIN + ' and " + max + ".";\n' +
    '    this.robots.forEach((r, i) => {\n' +
    '      if (i < n) { r.retire = false; if (r.active === false) { r.active = true; this.log("LINK", r, "Controller", r.id, "Simulated device connected"); } }\n' +
    '      else if (r.active !== false) r.retire = true;   // leaves duty once it is idle in its own bay\n' +
    '    });\n' +
    '    return "";\n' +
    '  }\n\n  canRelease(r) {', "setFleetSize");
  out = replaceOnce(out, '      this.monitor(r,r.pose,dt);\n    }\n  }',
    '      this.monitor(r,r.pose,dt);\n    }\n' +
    '    for (const r of this.robots) {   // a robot that is leaving duty stands down once it is idle in its own bay\n' +
    '      if (r.retire && !r.mission && !r.segment && !r.isolated && !r.alert && !r.example && r.at === this.net.stations[r.home].node) {\n' +
    '        r.active = false; r.retire = false; this.log("LINK", r, "Controller", r.id, "Device off duty");\n' +
    '      }\n    }\n  }', "retire sweep");
  out = replaceOnce(out, '  state(r) {\n    if (r.isolated) return "Isolated";', '  state(r) {\n    if (r.active === false) return "Off duty";\n    if (r.isolated) return "Isolated";', "off duty state");
  out = replaceOnce(out, 'isolated:r.isolated,paused:r.paused,canRelease:this.canRelease(r),completed:r.completed}))',
    'isolated:r.isolated,paused:r.paused,canRelease:this.canRelease(r),completed:r.completed,active:r.active !== false,retire:!!r.retire,home:r.home}))', "snapshot fields");
  return out;
}

module.exports = {FLEET_MIN, FLEET_MAX, BAY_NODES, CHECKPOINT_NODES, EXTRA_ROBOTS, patchNetwork, patchWorkerSource};
