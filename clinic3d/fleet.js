// Local fleet controller, simulated devices, and a separate observation-based monitor.
"use strict";

const ROBOT_PROFILES = [
  {id:"RX-01", name:"Pharmacy courier", home:"PHARMACY", preferred:"WARD-B", color:"#00856e", speed:1.05, shape:"cabinet"},
  {id:"LAB-02", name:"Specimen courier", home:"COLLECTION", preferred:"LAB", color:"#ba651e", speed:1.20, shape:"pod"},
  {id:"SUP-03", name:"Supply carrier", home:"STORES", preferred:"WARD-A", color:"#7363b2", speed:0.90, shape:"shelves"}
];
const EXAMPLES = new Set(["spin", "silence", "lift"]);
const distance = (a, b) => Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
const angleDifference = (a, b) => Math.atan2(Math.sin(a-b), Math.cos(a-b));

class FleetController {
  constructor(network) {
    this.net = network;
    this.time = 0;
    this.speed = 2;
    this.serial = 0;
    this.eventNumber = 0;
    this.messages = [];
    this.pending = [];
    this.acks = [];
    this.completedCommands = new Map();
    this.adjacent = new Map(Object.keys(network.nodes).map(k => [k, []]));
    for (const [a,b] of network.edges) this.adjacent.get(a).push(b);
    this.liftZone = new Set(network.cabins);
    for (const cabin of network.cabins) {
      for (const neighbor of this.adjacent.get(cabin)) this.liftZone.add(neighbor);
    }
    this.robots = ROBOT_PROFILES.map(profile => {
      const at = network.stations[profile.home].node;
      const pose = {...network.nodes[at], yaw:0};
      return {...profile, at, pose, intentYaw:0, turnUntil:0, seen:{...pose}, lastBeat:0, nextBeat:1,
        spinSeconds:0, quiet:0, spinRate:0, measuredSpeed:0, paused:false, isolated:false, alert:null, example:null,
        mission:null, segment:null, path:[], booked:false, retryAt:0, waitReason:"", completed:0};
    });
    for (const r of this.robots) this.log("LINK", r, "Controller", r.id, "Simulated device connected");
    this.enqueue({id:"DEMO-001", robot:"LAB-02", action:"dispatch", destination:"LAB"});
  }

  log(kind, r, from, to, text, ref="") {
    const entry = {seq:++this.eventNumber, time:this.time, kind, robot:r?.id || "", from, to, text, ref};
    this.messages.push(entry);
    return entry;
  }

  enqueue(cmd) {
    if (!cmd || typeof cmd.id !== "string") return;
    const previous = this.completedCommands.get(cmd.id);
    if (previous) { this.acks.push(previous); return; }
    if (this.pending.some(entry => entry.cmd.id === cmd.id)) return;
    const robot = this.robots.find(r => r.id === cmd.robot);
    this.log("CMD", robot, "Console", "Dispatcher", cmd.action === "dispatch"
      ? "Dispatch to " + (this.net.stations[cmd.destination]?.name || "unknown station")
      : ({pause:"Pause mission",resume:"Resume mission",isolate:"Isolate device",release:"Restore access",
          example:"Start test input",end:"End test input",receipt:"Confirm ward receipt",speed:"Set simulation speed"}[cmd.action] || "Unknown command"), cmd.id);
    this.pending.push({due:this.time+.12, cmd});
  }

  finish(cmd) {
    const r = this.robots.find(robot => robot.id === cmd.robot);
    let error = "";
    if (cmd.action === "speed") {
      if ([1,2,4].includes(cmd.value)) this.speed = cmd.value;
      else error = "Unsupported simulation speed.";
    } else if (!r) error = "Unknown fleet device.";
    else error = this.apply(r, cmd);
    const ack = {id:cmd.id, robot:cmd.robot, ok:!error, reason:error};
    this.completedCommands.set(cmd.id, ack);
    if (this.completedCommands.size > 500) this.completedCommands.delete(this.completedCommands.keys().next().value);
    this.acks.push(ack);
    this.log(error ? "NACK" : "ACK", r, "Dispatcher", "Console", error || "Command accepted", cmd.id);
  }

  apply(r, cmd) {
    switch (cmd.action) {
      case "dispatch": {
        const dest = this.net.stations[cmd.destination];
        if (!dest) return "Unknown destination.";
        if (r.isolated || r.alert) return "Review this robot before dispatch.";
        if (r.mission) return "This robot already has a mission.";
        if (dest.node === r.at) return "The robot is already at that station.";
        if (this.robots.some(other => other !== r && (other.mission?.dest === cmd.destination ||
          (!other.mission && other.at === dest.node)))) return "Another robot occupies or is assigned to that destination.";
        if (!this.pathTo(r.at, dest.node, new Set())) return "No mapped route to that station.";
        const id = "M" + String(++this.serial).padStart(3, "0");
        r.mission = {id, dest:cmd.destination, stage:"travel", issued:this.time, traveled:0};
        r.retryAt = 0;
        r.paused = false;
        this.log("TASK", r, "Dispatcher", r.id, id + " assigned to " + dest.name, cmd.id);
        return "";
      }
      case "pause":
        if (!r.mission || r.mission.stage === "arrived" || r.paused || r.isolated || r.alert) return "No moving mission to pause.";
        r.paused = true; r.booked = false;
        return "";
      case "resume":
        if (r.isolated || r.alert) return "Release the security hold before resuming.";
        if (!r.paused || r.mission?.stage !== "travel") return "No paused mission to resume.";
        r.paused = false; r.retryAt = 0;
        return "";
      case "receipt":
        if (r.mission?.stage !== "arrived" || this.net.stations[r.mission.dest].node !== r.at) return "Wait for a confirmed arrival.";
        this.log("SCAN", r, "Ward scanner", "Dispatcher", "Receipt confirmed for " + r.mission.id, cmd.id);
        r.mission = null; r.completed++; r.paused = false;
        return "";
      case "isolate":
        if (r.isolated) return "Device is already isolated.";
        r.isolated = true; r.booked = false;
        if (r.mission?.stage === "travel") r.paused = true;
        this.log("HOLD", r, "Operator", "Access gate", "Device isolated. Dispatch and lift access revoked.", cmd.id);
        return "";
      case "release":
        if (!r.isolated && !r.alert) return "There is no device hold.";
        if (!this.canRelease(r)) return "End the example and wait for a fresh heartbeat and stable motion.";
        r.isolated = false; r.alert = null; r.spinSeconds = 0;
        this.log("REVIEW", r, "Operator", "Access gate", r.paused ? "Access restored. Mission awaits Resume." : "Access restored after review.", cmd.id);
        return "";
      case "example":
        if (!EXAMPLES.has(cmd.example)) return "Unknown example.";
        if (r.example || r.isolated || r.alert) return "Finish the current example and review the device first.";
        r.example = {kind:cmd.example, since:this.time, emitted:false};
        this.log("TEST", r, "Test console", "Simulator", "Synthetic input enabled", cmd.id);
        return "";
      case "end":
        if (!r.example) return "No example is running.";
        r.example = null; r.quiet = 0;
        this.log("TEST", r, "Test console", "Simulator", "Normal sensor input restored", cmd.id);
        return "";
      default: return "Unknown command.";
    }
  }

  canRelease(r) {
    return !r.example && this.time-r.lastBeat < 2 && r.quiet >= .9;
  }

  pathTo(start, goal, blocked) {
    if (start === goal) return [];
    const costs = new Map([[start,0]]), previous = new Map(), open = new Set([start]);
    while (open.size) {
      let current = null;
      for (const n of open) if (current === null || costs.get(n) < costs.get(current)) current = n;
      if (current === goal) {
        const path = [];
        while (current !== start) { path.push(current); current = previous.get(current); }
        return path.reverse();
      }
      open.delete(current);
      for (const next of this.adjacent.get(current)) {
        if (blocked.has(next)) continue;
        const nextCost = costs.get(current) + distance(this.net.nodes[current],this.net.nodes[next]);
        if (nextCost >= (costs.get(next) ?? Infinity)) continue;
        costs.set(next, nextCost); previous.set(next, current); open.add(next);
      }
    }
    return null;
  }

  claims(r) {
    const claims = new Set([r.at]);
    if (r.segment) claims.add(r.segment.to);
    if (r.booked) for (const n of r.path) claims.add(n);
    if ([...claims].some(n => this.liftZone.has(n))) for (const n of this.liftZone) claims.add(n);
    return claims;
  }

  reserve(r) {
    const blocked = new Set();
    for (const other of this.robots) if (other !== r) for (const n of this.claims(other)) blocked.add(n);
    const base = r.segment?.to || r.at;
    const dest = this.net.stations[r.mission.dest].node;
    let path = this.pathTo(base, dest, blocked);
    // A busy shared lift need not keep another robot at its origin. Reserve the
    // free approach, then plan again before entering a contested lane.
    if (path === null && !blocked.has(base)) {
      const planned = this.pathTo(base, dest, new Set());
      const firstBusy = planned?.findIndex(n => blocked.has(n)) ?? -1;
      if (firstBusy > 0) path = planned.slice(0, firstBusy);
    }
    if (path === null || blocked.has(base)) {
      r.retryAt = this.time + .5;
      if (!r.waitReason) this.log("WAIT",r,"Traffic",r.id,"Waiting for reserved lanes or lift");
      r.waitReason = "Waiting for traffic clearance";
      return false;
    }
    r.path = r.segment ? [r.segment.to, ...path] : path;
    r.booked = true; r.waitReason = "";
    this.log("ROUTE",r,"Traffic",r.id,path.length && path[path.length-1] !== dest
      ? "Approach reserved up to the occupied lane" : "Mapped route reserved",r.mission.id);
    return true;
  }

  flag(r, rule, title, observed, expected) {
    if (r.alert || r.isolated) return;
    r.alert = {rule,title,observed,expected,time:this.time};
    r.booked = false;
    if (r.mission?.stage === "travel") r.paused = true;
    const event = this.log("ALERT",r,"Security monitor","Dispatcher",title,r.mission?.id || "");
    event.observed = observed;
    event.expected = expected;
    this.log("HOLD",r,"Dispatcher",r.id,"Simulated safety interlock engaged");
  }

  liftRequest(r, floor, task) {
    const destination = r.mission?.stage === "travel" && this.net.stations[r.mission.dest];
    const assigned = destination && this.net.nodes[destination.node].floor;
    const valid = !r.isolated && !r.alert && r.mission?.stage === "travel" && r.mission.id === task &&
      assigned === floor && r.booked && this.net.cabins.includes(r.at);
    this.log(valid ? "LIFT" : "DENY",r,"Lift gate",r.id,valid ? "Lift 1 granted to "+floor : "Lift request denied for "+floor,task || "");
    if (!valid) this.flag(r,"lift","Unassigned lift request","Requested "+floor+"; lift access denied.",
      assigned ? "Dispatch authorizes "+assigned+" for "+r.mission.id+"." : "No active lift assignment.");
    return valid;
  }

  move(r, dt) {
    if (r.isolated || r.alert) return;
    const moving = r.mission?.stage === "travel" && !r.paused;
    if (moving && !r.booked && this.time >= r.retryAt) this.reserve(r);
    if (moving && r.booked && !r.segment && r.path.length) {
      const to = r.path[0], a = this.net.nodes[r.at], b = this.net.nodes[to];
      const vertical = a.floor !== b.floor;
      if (vertical && !this.liftRequest(r,b.floor,r.mission.id)) return;
      r.segment = {from:r.at,to, progress:0, length:distance(a,b), vertical};
      if (!vertical) {
        const heading = Math.atan2(b.x-a.x,b.z-a.z);
        if (Math.abs(angleDifference(heading,r.intentYaw))>.12) r.turnUntil = this.time+.35;
        r.intentYaw = heading;
      }
    }
    // The local device fixture changes the measured pose. The detector below only receives observations and intent.
    if (r.example?.kind === "spin") {
      r.pose.yaw = angleDifference(r.pose.yaw+Math.PI*.5*dt,0);
      return;
    }
    if (!moving || !r.booked || !r.segment) return;
    const seg = r.segment, a = this.net.nodes[seg.from], b = this.net.nodes[seg.to];
    const previous = seg.progress;
    seg.progress = Math.min(1,previous + dt*(seg.vertical ? 1.5 : r.speed)/Math.max(.001,seg.length));
    r.mission.traveled += (seg.progress-previous)*seg.length;
    const p = seg.progress;
    r.pose = {x:a.x+(b.x-a.x)*p, y:a.y+(b.y-a.y)*p, z:a.z+(b.z-a.z)*p,
      yaw:r.intentYaw, floor:p<.5 ? a.floor : b.floor};
    if (p < 1) return;
    r.at = seg.to; r.segment = null; r.path.shift();
    if (seg.vertical) this.log("LIFT",r,"Lift 1","Dispatcher","Arrived on "+b.floor,r.mission.id);
    if (!r.path.length) {
      r.booked = false;
      const dest = this.net.stations[r.mission.dest];
      if (r.at === dest.node) {
        r.mission.stage = "arrived";
        this.log("ARRIVE",r,r.id,"Dispatcher","At "+dest.name+". Awaiting receipt.",r.mission.id);
      }
    }
  }

  monitor(r, observation, dt) {
    const speed = distance(observation,r.seen)/dt;
    const rate = Math.abs(angleDifference(observation.yaw,r.seen.yaw))*180/Math.PI/dt;
    r.seen = {...observation}; r.spinRate = rate; r.measuredSpeed = speed;
    const unexplained = this.time > r.turnUntil && speed < .10 && rate >= 60;
    r.spinSeconds = unexplained ? r.spinSeconds+dt : 0;
    r.quiet = unexplained || this.time-r.lastBeat>=2 ? 0 : r.quiet+dt;
    if (r.spinSeconds >= 2-1e-7) this.flag(r,"spin","Uncommanded rotation",
      Math.round(rate)+"°/s for "+r.spinSeconds.toFixed(1)+" s at "+speed.toFixed(2)+" m/s.",
      "No turn commanded. Threshold 60°/s for 2 s while stationary.");
    const lag = this.time-r.lastBeat;
    if (lag >= 4-1e-7) this.flag(r,"silence","Heartbeat overdue",lag.toFixed(1)+" s since the last device heartbeat.",
      "One heartbeat per second. Hold after 4 s of silence.");
  }

  step(dt) {
    this.time += dt;
    while (this.pending.length && this.pending[0].due <= this.time) this.finish(this.pending.shift().cmd);
    // Oldest missions acquire available resources first. Occupancy is retained when a unit stops mid-lane.
    const order = this.robots.slice().sort((a,b)=>(a.mission?.issued ?? Infinity)-(b.mission?.issued ?? Infinity));
    for (const r of order) {
      if (r.example?.kind === "lift" && !r.example.emitted) {
        r.example.emitted = true;
        const destination = r.mission && this.net.nodes[this.net.stations[r.mission.dest].node];
        const otherLanding = this.net.cabins.map(n => this.net.nodes[n])
          .find(n => n.floor !== (destination?.floor || r.pose.floor));
        this.liftRequest(r,otherLanding.floor,r.mission?.id || "");
      }
      this.move(r,dt);
      if (this.time >= r.nextBeat && r.example?.kind !== "silence") {
        r.nextBeat = this.time+1; r.lastBeat = this.time;
      }
      this.monitor(r,r.pose,dt);
    }
  }

  state(r) {
    if (r.isolated) return "Isolated";
    if (r.alert) return "Safety hold";
    if (r.mission?.stage === "arrived") return "Awaiting receipt";
    if (r.paused) return "Paused";
    if (r.segment?.vertical) return "In lift";
    if (r.mission && !r.booked) return "Waiting";
    return r.mission ? "In transit" : "Ready";
  }

  snapshot() {
    const lift = this.robots.find(r => [...this.claims(r)].some(n => this.net.cabins.includes(n)));
    return {time:this.time,speed:this.speed,lift:lift?.id || null,
      robots:this.robots.map(r=>({id:r.id,name:r.name,shape:r.shape,color:r.color,preferred:r.preferred,
        pose:{...r.pose},at:r.at,state:this.state(r),mission:r.mission && {...r.mission},path:r.booked ? [...r.path] : [],
        station:Object.keys(this.net.stations).find(k=>this.net.stations[k].node===r.at && !r.segment) || null,
        heartbeat:r.lastBeat,rate:r.spinRate,measuredSpeed:r.measuredSpeed,example:r.example?.kind || null,alert:r.alert && {...r.alert},
        isolated:r.isolated,paused:r.paused,canRelease:this.canRelease(r),completed:r.completed})),
      events:this.messages.splice(0),acks:this.acks.splice(0)};
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = {FleetController};
if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  let fleet, timer, visible = true, previousTime = performance.now();
  self.onmessage = ({data}) => {
    if (data.type === "init" && !fleet) {
      fleet = new FleetController(data.network);
      self.postMessage(fleet.snapshot());
      timer = setInterval(() => {
        const now = performance.now(), elapsed = Math.min((now-previousTime)/1000,.25);
        previousTime = now;
        if (!visible) return;
        let remaining = elapsed*fleet.speed;
        while (remaining > .00001) {const dt=Math.min(.1,remaining);fleet.step(dt);remaining-=dt;}
        self.postMessage(fleet.snapshot());
      },125);
    } else if (data.type === "visibility") {
      visible = data.visible; previousTime = performance.now();
    } else if (data.type === "command" && fleet) fleet.enqueue(data.command);
    else if (data.type === "close") {clearInterval(timer); self.close();}
  };
}
