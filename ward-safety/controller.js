// Hospital-side lift admission and a deterministic, offline mock installation.
(function (root, create) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = create(require("../clinic3d/fleet.js").FleetController);
  else root.WardSafety = create(FleetController);
})(globalThis, function (Fleet) {
  "use strict";
  const rounds = ["approved", "unverified", "forbidden", "priority", "roam"];
  const mapping = Object.freeze({Upper: "L2", Ground: "L1"});
  const liftLabels = Object.freeze({"01": "L2", G: "L1"});
  const decision = (outcome, reason) => ({outcome, reason});

  function evaluate(request, grant, site, now) {
    if (!grant || !grant.active || request.robot !== grant.robot || request.trip !== grant.trip ||
        request.lift !== grant.lift || now < grant.from || now >= grant.until) {
      return decision("deny", "No current dispatch grant for this robot and lift");
    }
    if (request.mapRevision !== site.approvedRevision || !Object.hasOwn(mapping, request.rawFloor) ||
        !Object.hasOwn(liftLabels, site.destinationLabel)) {
      return decision("hold", "Facilities must verify the landing mapping");
    }
    if (mapping[request.rawFloor] !== grant.floor || liftLabels[site.destinationLabel] !== grant.floor) {
      return decision("deny", "Requested destination is outside this trip");
    }
    if (site.priority) return decision("hold", "Facilities has priority for a patient transfer");
    if (site.seenAt === null || now - site.seenAt > 10 || site.seenAt > now) {
      return decision("hold", "Lift status is stale");
    }
    if (site.landing !== grant.origin) return decision("hold", "Awaiting car at the pickup landing");
    return decision("allow", "Dispatch, approved landing and facilities status agree");
  }

  // This mock owns received calls, car position and observation time independently of the AGV pose.
  class MockLift {
    constructor(round) {
      this.calls = new Map();
      this.receivedCount = 0;
      this.reservation = null;
      this.priority = round === "priority";
      this.connected = round !== "roam";
      this.seenAt = this.connected ? 0 : null;
      this.landing = "L1";
      this.physicalLanding = "L1";
      this.destinationLabel = "01";
      this.approvedRevision = "map-7";
      this.arrivalAt = null;
    }
    receive(request) {
      this.receivedCount++;
      const key = request.id;
      const fingerprint = JSON.stringify([request.robot, request.trip, request.lift, request.rawFloor, request.mapRevision]);
      if (this.calls.has(key)) return this.calls.get(key) === fingerprint ? "existing" : "conflict";
      this.calls.set(key, fingerprint);
      this.reservation = key;
      return "accepted";
    }
    update(now) {
      if (this.arrivalAt !== null && now >= this.arrivalAt) this.physicalLanding = "L2";
      if (this.connected && (this.seenAt === null || now - this.seenAt >= 0.99)) {
        this.seenAt = now;
        this.landing = this.physicalLanding;
      }
    }
  }

  class WardFleet extends Fleet {
    // The presenter controls a single delivery. Other fleet units stay at their own stations.
    enqueue(cmd) {
      if (cmd.id !== "DEMO-001") super.enqueue(cmd);
    }
    constructor(network, round) {
      super(network);
      this.round = round;
      this.site = new MockLift(round);
      this.cabins = new Set(network.cabins);
      this.journal = [];
      this.journey = {phase:"approach", outcome:"pending", reason:"Awaiting the lift approach",
        holder:"RX-01", receipts:0, cabinEntries:0, confirmedLandings:0,
        rawFloor:round === "forbidden" ? "Ground" : "Upper", mapRevision:round === "unverified" ? "map-8" : "map-7"};
      this.request = {id:"RX-WB-01", robot:"RX-01", trip:"TRIP-WB", lift:"Lift 1",
        rawFloor:this.journey.rawFloor, mapRevision:this.journey.mapRevision};
      this.grant = {robot:"RX-01", trip:"TRIP-WB", lift:"Lift 1", origin:"L1", floor:"L2", active:true, from:0, until:3600};
      this.porterArrival = null;
      this.porterAtWard = false;
      this.tickCount = 0;
      this.capture("dispatch", "Dispatcher", "Pharmacy parcel assigned to RX-01 for Ward B on L2");
      if (this.site.priority) this.capture("priority", "Facilities", "Patient transfer has priority");
      if (!this.site.connected) this.capture("telemetry", "Facilities feed", "Wireless handover awaiting a fresh lift observation");
      this.enqueue({id:"ward-dispatch", robot:"RX-01", action:"dispatch", destination:"WARD-B"});
    }
    capture(kind, source, text) { this.journal.push({time:+this.time.toFixed(2), kind, source, text}); }
    authorize(r) {
      const result = r.id === this.request.robot && r.mission?.dest === "WARD-B"
        ? evaluate(this.request, this.grant, this.site, this.time)
        : decision("deny", "Current fleet assignment differs from dispatch");
      if (result.outcome !== this.journey.outcome || result.reason !== this.journey.reason) {
        this.capture(result.outcome, "Lift adapter", result.reason);
      }
      Object.assign(this.journey, result);
      if (result.outcome !== "allow") {
        this.journey.phase = result.outcome === "deny" ? "denied" : "waiting";
        r.booked = false;
        r.path = [];
        r.retryAt = this.time + .5;
        if (result.outcome === "deny") r.paused = true;
        return false;
      }
      if (!this.journey.callId) {
        const reply = this.site.receive(this.request);
        if (reply === "conflict") throw Error("Conflicting service request ID");
        this.journey.callId = this.request.id;
        this.capture("forward", "Mock lift", "Received service call RX-WB-01 for landing 01");
      }
      return true;
    }
    liftRequest(r, floor) {
      return this.site.reservation === this.request.id && r.id === this.grant.robot && floor === this.grant.floor &&
        this.journey.cabinEntries === 1;
    }
    move(r, dt) {
      if (!r.mission || r.paused || r.isolated || r.alert || r.mission.stage !== "travel") return;
      if (!r.booked && this.time >= r.retryAt) this.reserve(r);
      if (!r.booked) return;
      const next = r.path[0], at = r.at, j = this.journey;
      if (!r.segment && next && this.net.nodes[at].floor === "L1" && !this.cabins.has(at) && this.liftZone.has(next)) {
        // First checkpoint is upstream of the whole shared zone. Check again immediately before boarding.
        if (!this.authorize(r)) return;
        if (this.cabins.has(next)) {
          j.phase = "boarding";
          this.capture("boarding", "AGV", "Entering the origin cabin");
        }
      }
      if (!r.segment && this.cabins.has(at) && this.net.nodes[at].floor === "L2" && next && !this.cabins.has(next)) {
        const fresh = this.site.seenAt !== null && this.time - this.site.seenAt <= 10;
        if (!fresh || this.site.landing !== "L2") {
          if (j.phase !== "landing") this.capture("waiting", "Lift adapter", "Waiting for confirmed L2 landing");
          j.phase = "landing";
          return;
        }
        if (!j.confirmedLandings) {
          j.confirmedLandings = 1;
          this.capture("landing", "Facilities feed", "Confirmed landing 01 at L2");
        }
        j.phase = "delivering";
      }
      super.move(r, dt);
      if (r.at !== at && this.cabins.has(at) && !this.cabins.has(r.at)) this.site.reservation = null;
      if (r.at !== at && !this.cabins.has(at) && this.cabins.has(r.at)) {
        j.cabinEntries++;
        j.phase = "riding";
        this.site.arrivalAt = this.time + 8;
        this.site.physicalLanding = "in transit";
        this.capture("entry", "AGV", "Origin cabin entry observed");
      }
      if (r.mission.stage === "arrived" && j.phase !== "awaiting_receipt") {
        j.phase = "awaiting_receipt";
        this.capture("arrival", "Ward dock", "Parcel at Ward B awaiting a scanner receipt");
      }
    }
    tick() {
      this.site.update(this.time);
      super.step(.1);
      this.tickCount++;
      if (this.porterArrival !== null && this.time >= this.porterArrival && !this.porterAtWard) {
        this.porterAtWard = true;
        this.journey.phase = "awaiting_receipt";
        this.capture("arrival", "Ward dock", "Porter arrived at Ward B");
      }
      // The original engine's transient buffers are unnecessary after a tick in this projection.
      this.messages.length = 0;
      this.acks.length = 0;
    }
  }

  class WardSimulation {
    constructor({network, round = "approved"}) {
      if (!rounds.includes(round)) throw Error("Unknown exercise");
      this.fleet = new WardFleet(network, round);
      this.remainder = 0;
    }
    advance(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) throw Error("Invalid time step");
      this.remainder += seconds;
      const ticks = Math.floor((this.remainder + 1e-9) * 10);
      this.remainder = Math.max(0, this.remainder - ticks / 10);
      for (let i = 0; i < ticks; i++) this.fleet.tick();
    }
    actions() {
      const f = this.fleet, j = f.journey, a = [];
      if (j.phase === "waiting") {
        if (f.site.approvedRevision !== j.mapRevision) a.push("approveMapping");
        if (f.site.priority) a.push("clearPriority");
        if (!f.site.connected) a.push("restoreFeed");
        a.push("offerPorter");
      }
      if (j.phase === "porter_offered") a.push("acceptPorter");
      if (j.phase === "landing" && !f.site.connected) a.push("restoreFeed");
      if (j.phase === "awaiting_receipt") a.push("wardScan");
      return a;
    }
    act(action) {
      if (!this.actions().includes(action)) return false;
      const f = this.fleet, j = f.journey, r = f.robots[0];
      switch (action) {
        case "approveMapping":
          f.site.approvedRevision = j.mapRevision;
          f.capture("review", "Facilities", "Facilities verified Upper and 01 against the revised map");
          break;
        case "clearPriority":
          f.site.priority = false;
          f.capture("priority", "Facilities", "Patient transfer cleared");
          break;
        case "restoreFeed":
          f.site.connected = true;
          f.site.update(f.time);
          f.capture("telemetry", "Facilities feed", "Reconnected and reconciled the lift state");
          break;
        case "offerPorter":
          r.paused = true;
          r.booked = false;
          j.phase = "porter_offered";
          f.capture("offer", "Logistics", "Porter handoff offered. RX-01 retains custody");
          break;
        case "acceptPorter":
          j.phase = "porter_transit"; j.holder = "Porter"; f.grant.active = false;
          f.site.reservation = null;
          f.porterArrival = f.time + 12;
          f.capture("handoff", "Porter scanner", "Porter accepted the parcel for Ward B");
          break;
        case "wardScan":
          if (j.holder === "RX-01" && f.apply(r, {action:"receipt", id:"ward-receipt"})) return false;
          j.receipts = 1; j.holder = "Ward B"; j.phase = "received"; f.grant.active = false;
          f.capture("receipt", "Ward scanner", "Ward B confirmed one parcel receipt");
          break;
      }
      return true;
    }
    state() {
      const f = this.fleet;
      return {time:+f.time.toFixed(2), round:f.round,
        journey:{...f.journey, forwardedCalls:f.site.receivedCount, trip:f.grant.trip, destination:"Ward B", approvedRevision:f.site.approvedRevision},
        robots:f.robots.map(r => ({id:r.id, at:r.at, pose:{...r.pose}})),
        facilities:{priority:f.site.priority, seenAt:f.site.seenAt, landing:f.site.landing, connected:f.site.connected},
        actions:this.actions(), events:f.journal.map(e => ({...e}))};
    }
  }
  return {WardSimulation, evaluate, MockLift};
});
