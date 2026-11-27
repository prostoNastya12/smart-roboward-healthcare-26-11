(function (root, createWorkflows) {
  "use strict";
  const api = createWorkflows();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WardWorkflows = api;
})(globalThis, function () {
  "use strict";

  const row = (label, active, candidate) => ({label, active, candidate});
  const previewCases = [
    ["A01", "Routine Ward B delivery"],
    ["U06", "Wrong floor"],
    ["A05", "Ward B after patient priority"],
    ["A02", "Routine Ward A delivery"]
  ];

  // The site builder embeds this result. The replay owns its simulated world and
  // downstream outputs. Each policy gets a fresh copy of the same fixture state.
  function buildPreview(fixtures) {
    if (fixtures.format_version !== 1 || !Array.isArray(fixtures.scenarios)) {
      throw new Error("The policy preview requires C09 version 1 scenario inputs.");
    }
    const {spawnSync} = require("node:child_process");
    const path = require("node:path");
    const replayPath = path.join(__dirname, "..", "output", "simulation", "replay.py");
    const ids = new Set(previewCases.map(([id]) => id));
    const inputs = fixtures.scenarios.filter(c => ids.has(c.case_id)).map(c => ({
      id: c.case_id, initial: c.initial_state, events: c.events
    }));
    const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("ward_replay", sys.argv[1])
replay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(replay)
inputs = json.load(sys.stdin)
active_rule = replay.decide_trip

def candidate_rule(event, *facts):
    decision, reason = active_rule(event, *facts)
    # Remove Ward B from SIM-R1's final dispatch permissions. Preserve an
    # existing refusal or temporary safety hold, including facilities priority.
    if decision == "allow" and event["robot_id"] == "SIM-R1" and event["payload"]["destination"] == "WARD-B":
        return "deny", "ward_b_omitted"
    return decision, reason

def run(case, rule):
    replay.decide_trip = rule
    state, _, outputs, waits = replay.simulate(case["initial"], case["events"], inputs["rules"], inputs["lift"])
    return {
        "decisions": [{"id": o["request_id"], "time": o["t_s"], "decision": o["decision"], "reason": o["reason"]}
                      for o in outputs if o["channel"] == "robot"],
        "grants": state["robot_lift_grants"], "receipts": state["distinct_ward_receipts"],
        "holder": state["final_parcel_holder"], "completedBy": state["completed_by"],
        "priority": [{"id": o["call_id"], "time": o["t_s"], "wait": waits[o["call_id"]]}
                     for o in outputs if o["channel"] == "lift" and o.get("type") == "priority_accepted"]
    }

print(json.dumps({c["id"]: {"active": run(c, active_rule), "candidate": run(c, candidate_rule)}
                  for c in inputs["cases"]}))
`;
    const result = spawnSync("python3", ["-I", "-B", "-c", script, replayPath], {
      input: JSON.stringify({cases: inputs, rules: fixtures.replay, lift: fixtures.demo_world.shared_lift_id}),
      encoding: "utf8", timeout: 15000
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error("Policy replay failed. " + result.stderr.trim());
    return {schema: "ward-policy-preview/1", cases: JSON.parse(result.stdout)};
  }

  function decisionText(run, comparison) {
    const reasons = {authorized: "", ward_b_omitted: "Ward B omitted", floor_mismatch: "wrong floor",
      urgent_transfer_active: "patient priority"};
    const changed = comparison && run.decisions.find((d, i) => {
      const previous = comparison.decisions[i];
      return d.id !== previous?.id || d.decision !== previous.decision || d.reason !== previous.reason;
    });
    return run.decisions.map(d => {
      const reason = reasons[d.reason] ?? d.reason.replaceAll("_", " ");
      const regression = d === changed && comparison.decisions.some(previous => previous.id === d.id && previous.decision === "allow");
      return d.id + " " + d.decision + (reason ? " (" + reason + ")" : "") + (regression ? " · regression" : "");
    }).concat([count(run.grants, "grant") + ", " + count(run.receipts, "receipt")]).join(" · ");
  }

  function priorityText(run) {
    if (!run || run.priority.length === 0) return "Untested";
    return run.priority.map(p => "Acknowledged at " + p.time + " s · " + p.wait + " s wait").join(", ");
  }

  function count(value, noun) { return value + " " + noun + (value === 1 ? "" : "s"); }

  function demoPreview(fixtures) {
    const evidence = fixtures.schema === "ward-policy-preview/1" ? fixtures : buildPreview(fixtures);
    const results = previewCases.map(([id, label]) => {
      const c = evidence.cases[id];
      return row(id + " · " + label, c ? decisionText(c.active) : "Untested", c ? decisionText(c.candidate, c.active) : "Untested");
    });
    const priority = evidence.cases.A05;
    results.push(row("A05 · Facilities priority call", priorityText(priority?.active), priorityText(priority?.candidate)));
    const wardB = ["A01", "A05"].map(id => evidence.cases[id]).filter(Boolean);
    if (wardB.length) {
      const received = policy => wardB.filter(c => c[policy].receipts > 0).length + "/" + wardB.length + " deliveries received";
      results.push(row("Ward B receiving nurse", received("active"), received("candidate") + " · dispatch reviews rule"));
    }
    results.push(row("Fire-service operation", "Untested", "Untested"));
    return results;
  }

  // All holders, scanners and reviewers below are fictional roles in local memory.
  class CustodyLedger {
    constructor() {
      this.trips = new Map();
      this.totes = new Map();
      this.records = new Map();
    }

    open(tripId, parcel, ward, robot) {
      if (![tripId, parcel, ward, robot].every(value => typeof value === "string" && value.length)) return false;
      if (this.trips.has(tripId) || [...this.trips.values()].some(trip => trip.parcel === parcel)) return false;
      this.trips.set(tripId, {tripId, parcel, ward, robot, holder: "Pharmacy", tote: null,
        carrier: null, offeredTo: null, arrived: false, unloaded: false, receipt: null});
      return true;
    }

    load(tripId, tote) {
      const trip = this.trips.get(tripId);
      if (!trip || trip.holder !== "Pharmacy" || !tote || this.totes.has(tote)) return false;
      this.totes.set(tote, tripId);
      trip.tote = tote;
      trip.holder = trip.carrier = trip.robot;
      return true;
    }

    readTote(tote) {
      const trip = this.trips.get(this.totes.get(tote));
      return trip ? {tripId: trip.tripId, parcel: trip.parcel, holder: trip.holder} : null;
    }

    offer(tripId, porter) {
      const trip = this.trips.get(tripId);
      if (!trip || !porter || trip.holder !== trip.robot || trip.arrived) return false;
      trip.offeredTo = porter;
      return true;
    }

    accept(tripId, porter) {
      const trip = this.trips.get(tripId);
      if (!trip || !porter || trip.holder !== trip.robot || trip.offeredTo !== porter || trip.arrived) return false;
      trip.holder = trip.carrier = porter;
      trip.offeredTo = null;
      return true;
    }

    arrive(tripId, station, carrier) {
      const trip = this.trips.get(tripId);
      if (!trip || !trip.carrier || trip.receipt || station !== trip.ward || carrier !== trip.holder) return false;
      trip.arrived = true;
      trip.offeredTo = null;
      return true;
    }

    unload(tripId, tote, parcel) {
      const trip = this.trips.get(tripId);
      if (!trip || !trip.arrived || trip.parcel !== parcel || this.totes.get(tote) !== tripId) return false;
      this.totes.delete(tote);
      trip.tote = null;
      trip.unloaded = true;
      return true;
    }

    // Receipt and correction IDs share one immutable event history. A repeat
    // is idempotent only if the submission still describes the same event.
    repeat(record) {
      const earlier = this.records.get(record.id);
      if (!earlier) return null;
      return JSON.stringify(earlier) === JSON.stringify(record) ? "duplicate" : "conflict";
    }

    close(trip, record) {
      this.records.set(record.id, Object.freeze(record));
      trip.receipt = record.id;
      trip.holder = trip.ward;
      return "recorded";
    }

    canReceive(trip, parcel, station) {
      return trip && !trip.receipt && trip.arrived && trip.unloaded && trip.parcel === parcel && trip.ward === station;
    }

    scan({id, tripId, parcel, station, role}) {
      if (role !== "ward-scanner" || !id) return "rejected";
      const record = {type: "receipt", id, tripId, parcel, station, role};
      const earlier = this.repeat(record);
      if (earlier) return earlier;
      const trip = this.trips.get(tripId);
      if (!this.canReceive(trip, parcel, station)) return "rejected";
      return this.close(trip, record);
    }

    correct({id, originalId, tripId, parcel, station, originalHolder, role, reconciled}) {
      if (role !== "ward-reviewer" || reconciled !== true || !id) return "rejected";
      const record = {type: "correction", id, originalId, tripId, parcel, station, originalHolder, role};
      const earlier = this.repeat(record);
      if (earlier) return earlier;
      const original = this.records.get(originalId);
      const previousTrip = this.trips.get(original?.tripId);
      const trip = this.trips.get(tripId);
      if (!previousTrip || previousTrip.receipt !== originalId || original.station !== station ||
        previousTrip.carrier !== originalHolder || !this.canReceive(trip, parcel, station)) return "rejected";
      // Physical reconciliation established which parcel is at the ward and who
      // still has the other one. Re-open the latter until its own ward scan.
      previousTrip.receipt = null;
      previousTrip.holder = originalHolder;
      previousTrip.arrived = false;
      return this.close(trip, record);
    }

    effectiveReceipts() {
      return [...this.trips.values()].filter(trip => trip.receipt !== null).length;
    }
  }

  function stageAtWard(ledger, tripId, tote) {
    const trip = ledger.trips.get(tripId);
    ledger.load(tripId, tote);
    ledger.arrive(tripId, trip.ward, trip.holder);
    ledger.unload(tripId, tote, trip.parcel);
  }

  function demoCustody() {
    const ledger = new CustodyLedger();
    const tote = "T7", ward = "Ward B", robot = "RX-01";
    const scan = (id, tripId, parcel, station = ward) => ({id, tripId, parcel, station, role: "ward-scanner"});
    ledger.open("D1", "A", ward, robot);
    stageAtWard(ledger, "D1", tote);
    ledger.scan(scan("R1", "D1", "A"));

    ledger.open("D2", "B", ward, robot);
    ledger.load("D2", tote);
    const today = ledger.trips.get("D2");
    const binding = ledger.readTote(tote);
    const rows = [row("Tote T7 reused", "D1 · parcel A received", binding.tripId + " · now bound to parcel " + binding.parcel)];
    rows.push(row("Doorway read", "T7 observed", today.receipt || "Parcel B pending · " + today.holder + " holds it"));
    ledger.offer("D2", "Porter 2");
    const offered = today.holder;
    ledger.accept("D2", "Porter 2");
    rows.push(row("Porter handoff", "Offer · " + offered + " holds B", "Accepted · " + today.holder + " holds B"));
    ledger.arrive("D2", ward, "Porter 2");
    ledger.unload("D2", tote, "B");
    const oldParcel = ledger.scan(scan("R-old", "D2", "A"));
    const wrongStation = ledger.scan(scan("R-other", "D2", "B", "Ward A"));
    rows.push(row("Scan at receiving station", "Yesterday’s A · " + oldParcel, "B at Ward A · " + wrongStation));
    const receipt = scan("R2", "D2", "B");
    const recorded = ledger.scan(receipt);
    const repeat = ledger.scan(receipt);
    rows.push(row("Matching ward scan", "R2 " + recorded + " · " + today.holder, "Repeat " + repeat + " · effective receipt " + today.receipt));

    const review = new CustodyLedger();
    review.open("D3", "C", ward, robot);
    review.open("D4", "D", ward, "LAB-02");
    stageAtWard(review, "D3", "T8");
    stageAtWard(review, "D4", "T9");
    review.scan(scan("R3", "D3", "C"));
    const correction = {id: "C4", originalId: "R3", tripId: "D4", parcel: "D", station: ward,
      originalHolder: robot, role: "ward-reviewer", reconciled: true};
    review.correct(correction);
    rows.push(row("Staff reconcile a mistaken receipt", "R3 recorded C · staff found D",
      "C4 links R3 to D · C outstanding with " + review.trips.get("D3").holder));
    const repeatCorrection = review.correct(correction);
    rows.push(row("Correction retried", "C4 " + repeatCorrection,
      count(review.effectiveReceipts(), "effective receipt") + " · " + review.records.size + " records retained"));
    return rows;
  }

  // One shared lift serves a bounded number of routine jobs, including its
  // occupant. Vendors take turns and each vendor's eligible jobs are FIFO.
  class RoutineQueue {
    constructor(vendors, capacity, perRobot = 1) {
      if (!Array.isArray(vendors) || !vendors.length || new Set(vendors).size !== vendors.length ||
        ![capacity, perRobot].every(n => Number.isSafeInteger(n) && n > 0)) {
        throw new Error("Specify unique vendors and positive queue limits.");
      }
      this.vendors = [...vendors];
      this.capacity = capacity;
      this.perRobot = perRobot;
      this.jobs = new Map();
      this.requests = new Map();
      this.pending = [];
      this.occupant = null;
      this.cursor = 0;
      this.priority = null;
      this.now = 0;
    }

    tick(now) {
      if (!Number.isFinite(now) || now < this.now) throw new Error("Queue time must advance monotonically.");
      this.now = now;
    }

    submit({tripId, requestId, vendor, robot, destination}, now) {
      this.tick(now);
      if (![tripId, requestId, vendor, robot, destination].every(id => typeof id === "string" && id.length) ||
        !this.vendors.includes(vendor)) return {status: "invalid"};
      const requestKey = JSON.stringify([vendor, requestId]);
      const semantics = JSON.stringify([tripId, vendor, robot, destination]);
      const priorRequest = this.requests.get(requestKey);
      const existing = this.jobs.get(tripId);
      if ((priorRequest && priorRequest !== semantics) || (existing && existing.semantics !== semantics)) {
        return {status: "conflict"};
      }
      if (existing) {
        this.requests.set(requestKey, semantics);
        return {status: "duplicate", phase: existing.phase};
      }
      const outstanding = this.occupant ? this.pending.concat(this.occupant) : this.pending;
      const sameRobot = outstanding.filter(job => job.vendor === vendor && job.robot === robot).length;
      if (sameRobot >= this.perRobot || outstanding.length >= this.capacity) {
        return {status: "deferred", reason: sameRobot >= this.perRobot ? "Robot limit" : "Shared limit",
          owner: "Logistics", retry: "Retry after a slot opens"};
      }
      const job = {tripId, vendor, robot, destination, semantics, phase: "queued", queuedAt: now};
      this.jobs.set(tripId, job);
      this.requests.set(requestKey, semantics);
      this.pending.push(job);
      return {status: "queued"};
    }

    acknowledgePriority(now) {
      this.tick(now);
      if (!this.priority) this.priority = {requestedAt: now, acknowledgedAt: now, availableAt: this.occupant ? null : now};
      return {...this.priority};
    }

    clearPriority(now) {
      this.tick(now);
      if (!this.priority || this.occupant) return false;
      this.priority = null;
      return true;
    }

    board(now, eligible = () => true) {
      this.tick(now);
      if (this.priority) return {status: "held for patient transfer"};
      if (this.occupant) return {status: "occupied"};
      for (let offset = 0; offset < this.vendors.length; offset++) {
        const vendorIndex = (this.cursor + offset) % this.vendors.length;
        const index = this.pending.findIndex(job => job.vendor === this.vendors[vendorIndex] && eligible(job));
        if (index === -1) continue;
        const [job] = this.pending.splice(index, 1);
        job.phase = "boarded";
        job.boardedAt = now;
        this.occupant = job;
        this.cursor = (vendorIndex + 1) % this.vendors.length;
        return {status: job.phase, tripId: job.tripId, age: now - job.queuedAt};
      }
      return {status: "no eligible job"};
    }

    finish(tripId, now) {
      this.tick(now);
      if (this.occupant?.tripId !== tripId) return false;
      this.occupant.phase = "completed";
      this.occupant = null;
      if (this.priority) this.priority.availableAt = now;
      return true;
    }
  }

  function demoQueue() {
    const queue = new RoutineQueue(["Fleet A", "Fleet B"], 2);
    const request = (tripId, vendor, robot) => ({tripId, requestId: "req-" + tripId, vendor, robot, destination: "Ward B"});
    const a = request("J1", "Fleet A", "RX-01");
    const b = request("J2", "Fleet B", "LAB-02");
    const c = request("J3", "Fleet A", "SUP-03");
    queue.submit(a, 0);
    queue.submit(b, 0);
    const deferred = queue.submit(c, 0);
    const duplicate = queue.submit(a, 0);
    const results = [row("Three routine requests", queue.pending.length + " of 2 slots filled", "J3 " + deferred.status + " · " + deferred.reason),
      row("J1 retries", duplicate.status + " · " + duplicate.phase, count(queue.pending.length, "queued job")),
      row("J3 retry owner", deferred.owner, deferred.retry)];
    const first = queue.board(1);
    const urgent = queue.acknowledgePriority(3);
    const held = queue.board(4);
    queue.finish(first.tripId, 7);
    const wait = queue.priority.availableAt - urgent.requestedAt;
    const whileEmpty = queue.board(8);
    results.push(row("Facilities priority during J1", (urgent.acknowledgedAt - urgent.requestedAt) + " s acknowledgement", wait + " s until car available"),
      row("Routine boarding during priority", "J1 in cabin · " + held.status, "Cabin empty · " + whileEmpty.status));
    queue.submit(c, 8);
    queue.clearPriority(12);
    const second = queue.board(12);
    queue.finish(second.tripId, 15);
    const third = queue.board(15);
    queue.finish(third.tripId, 19);
    results.push(row("Next after clearance", second.tripId + " · Fleet B · queued " + second.age + " s",
      third.tripId + " · Fleet A · queued " + third.age + " s"));
    const completed = [...queue.jobs.values()].filter(job => job.phase === "completed").length;
    results.push(row("Final disposition", [first.tripId, second.tripId, third.tripId].join(" → "),
      count(completed, "completed job") + " · " + queue.pending.length + " waiting"));
    return results;
  }

  return {buildPreview, demoPreview, CustodyLedger, demoCustody, RoutineQueue, demoQueue};
});
