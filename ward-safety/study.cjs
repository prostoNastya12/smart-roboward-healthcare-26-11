"use strict";
// Deterministic offline simulation. Run "node ward-safety/study.cjs" to regenerate the JSON.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {FleetController} = require("../clinic3d/fleet.js");
const graph = require("../clinic3d/network.json");
const ROOT_SEED = 20261127;
const STEP = .5;
const LIMIT = 300;
const WINDOW = 30;
const CLASSES = ["ordinary", "approved", "fault", "violation"];
const MIX = {training: [5400, 600, 0, 0], calibration: [1600, 200, 100, 100], test: [1600, 200, 100, 100]};
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const rounded = n => Number(n.toFixed(4));
const stations = Object.keys(graph.stations);

function stream(seed) {
  let current = seed >>> 0;
  return () => {
    current = (current + 0x6d2b79f5) >>> 0;
    let x = Math.imul(current ^ current >>> 15, 1 | current);
    x = (x + Math.imul(x ^ x >>> 7, 61 | x)) ^ x;
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
}

function shuffle(values, random) {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function manifest(split, seed = ROOT_SEED, mix = MIX[split]) {
  const splitIndex = Object.keys(MIX).indexOf(split);
  if (splitIndex < 0 || mix.length !== CLASSES.length || !mix.every(n => Number.isInteger(n) && n >= 0)) throw Error("Invalid split.");
  const labels = CLASSES.flatMap((label, i) => Array(mix[i]).fill(label));
  if (labels.length % 2) throw Error("Workloads contain two missions.");
  const offset = splitIndex * 1000000;
  const shuffled = shuffle(labels, stream(seed + offset));
  return Array.from({length: labels.length / 2}, (_, i) => ({
    id: split + "-" + (i + 1), split, seed: (seed + offset + i + 1) >>> 0, labels: shuffled.slice(i * 2, i * 2 + 2)
  }));
}

function workload(group) {
  const routes = stream(group.seed);
  const environment = stream(group.seed ^ 0xcd096897);
  const radio = stream(group.seed ^ 0x174b727a);
  const fleet = new FleetController(graph);
  // The batch supplies both dispatches instead of the console's startup demonstration.
  fleet.pending.length = 0;
  fleet.robots = shuffle(fleet.robots, routes).slice(0, 2);
  const stops = shuffle(stations, routes);
  const load = environment() < .5 ? "busy" : "light";
  const shift = environment() < .5 ? "day" : "night";
  const missions = fleet.robots.map((robot, i) => {
    const origin = stops[i], dest = stops[i + 2], label = group.labels[i];
    robot.at = graph.stations[origin].node;
    robot.pose = {...graph.nodes[robot.at], yaw: 0};
    robot.seen = {...robot.pose};
    robot.speed *= (.8 + environment() * .4) * (load === "busy" ? .85 : 1);
    const start = 2 + Math.floor(environment() * 6);
    const routineWait = 1 + Math.floor(environment() * (load === "busy" ? 9 : 4));
    const duration = {ordinary: routineWait, approved: 13 + Math.floor(environment() * 29),
      fault: 5 + Math.floor(environment() * 23), violation: 0}[label];
    const gapStart = Math.floor(radio() * 42), gapLength = radio() < .45 ? 1 + Math.floor(radio() * 7) : 0;
    const id = group.id + "/" + robot.id;
    fleet.enqueue({id, action: "dispatch", robot: robot.id, destination: dest});
    return {id, robot, label, origin, dest, load, shift, start, duration, gapStart, gapLength,
      approvedStop: label === "approved", submittedDestination: label === "violation" ? origin : dest,
      requestAt: null, onset: null, done: false, outcome: "timeout", visible: true, samples: []};
  });

  for (let tick = 0; tick < LIMIT / STEP && missions.some(m => !m.done); tick++) {
    const now = tick * STEP;
    const before = missions.map(m => ({at: m.robot.at, segment: m.robot.segment, pose: m.robot.pose}));
    for (const m of missions) {
      if (m.done) continue;
      const r = m.robot;
      if (m.onset === null && now >= m.start && r.segment && !r.segment.vertical) m.onset = now;
      if (m.onset === now) {
        m.requestAt = now;
        r.paused = true;
        // An inconsistent simulated destination is refused against the dispatcher’s assignment.
        if (m.submittedDestination !== m.dest) m.outcome = "request refused";
      }
      if (m.onset !== null && now >= m.onset + m.duration && m.outcome !== "request refused") r.paused = false;
    }
    fleet.step(STEP);
    missions.forEach((m, i) => {
      if (m.done) return;
      const r = m.robot, prior = before[i], t = now + STEP;
      const visible = !(now >= m.gapStart && now < m.gapStart + m.gapLength);
      const moved = r.pose.x !== prior.pose.x || r.pose.y !== prior.pose.y || r.pose.z !== prior.pose.z;
      const from = prior.at, to = r.at !== from ? r.at : (prior.segment || r.segment)?.to ?? null;
      const inStop = m.onset !== null && now >= m.onset && now < m.onset + m.duration;
      const phase = inStop && m.approvedStop ? "authorized stop" :
        r.waitReason && !r.booked ? "traffic queue" :
        to && graph.nodes[from].floor !== graph.nodes[to].floor ? "lift cabin" : "lane";
      // Sensor stream contains permit/intent and observations; ground truth and future outcomes stay outside.
      const requested = m.requestAt === now ? m.submittedDestination : null;
      m.samples.push({t, from, to, traversed: visible && m.visible && r.at !== from, visible, moved, phase,
        load, requested, assigned: m.dest});
      m.visible = visible;
      if (m.outcome === "request refused") m.done = true;
      else if (r.mission?.stage === "arrived") {
        const result = fleet.apply(r, {action: "receipt"});
        if (!result) { m.done = true; m.outcome = "one ward receipt"; }
      }
    });
  }
  return missions.map(({id, robot, origin, dest, load, shift, onset, label, outcome, samples}) => ({
    id, group: group.id, seed: group.seed, robot: robot.id, origin, dest, load, shift, outcome, samples,
    truth: {label, onset: label === "violation" || label === "fault" ? onset : null}
  }));
}

function episodes(samples) {
  const result = [];
  let stall = null;
  for (const s of samples) {
    if (!s.visible || s.moved) stall = null;
    if (!s.visible) continue;
    if (s.requested && s.requested !== s.assigned) {
      result.push({kind: "scope", first: s.t, last: s.t, from: s.from, to: s.to});
    }
    if (s.moved) continue;
    const key = s.phase + "/" + s.load;
    if (!stall || key !== stall.key || s.from !== stall.from || s.to !== stall.to) {
      stall = {kind: "stationary", key, first: s.t, last: s.t, from: s.from, to: s.to};
      result.push(stall);
    } else stall.last = s.t;
  }
  return result;
}

const elapsed = event => event.last - event.first + STEP;
function quantile(sorted, q) {
  return sorted.length ? sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] : null;
}

function train(missions) {
  const times = {all: []};
  for (const m of missions) for (const event of m.events) if (event.kind === "stationary") {
    times.all.push(elapsed(event));
    (times[event.key] ??= []).push(elapsed(event));
  }
  for (const arr of Object.values(times)) arr.sort((a, b) => a - b);
  return times;
}

function thresholds(times, q, conditional) {
  const result = {all: Math.max(STEP, quantile(times.all, q) ?? STEP)};
  if (conditional) for (const [key, values] of Object.entries(times)) {
    if (values.length >= 20) result[key] = Math.max(STEP, quantile(values, q));
  }
  return result;
}

function detect(events, model) {
  const alerts = [];
  for (const event of events) {
    const limit = model[event.key] ?? model.all;
    if (event.kind === "scope") alerts.push({time: event.first, from: event.from, to: event.to, kind: "assignment mismatch"});
    else if (elapsed(event) > limit) alerts.push({time: event.first + limit, from: event.from, to: event.to, kind: "dwell"});
  }
  return alerts;
}

function evaluate(missions, model) {
  const kinds = Object.fromEntries(["fault", "violation"].map(k => [k, {total: 0, delays: []}]));
  let benign = 0, benignSeconds = 0, falseBenign = 0, emitted = 0, detected = 0;
  const byClass = {}, byLoad = {}, byRobot = {}, byFloorPair = {};
  for (const m of missions) {
    const alerts = detect(m.events, model);
    emitted += alerts.length;
    const type = m.truth.label;
    const incident = kinds[type];
    const signal = type === "fault" ? "dwell" : "assignment mismatch";
    const hit = incident && m.truth.onset !== null && alerts.find(a =>
      a.kind === signal && a.time >= m.truth.onset && a.time <= m.truth.onset + WINDOW);
    if (incident) {
      incident.total++;
      if (hit) { incident.delays.push(hit.time - m.truth.onset); detected++; }
    } else { benign++; benignSeconds += m.observed; falseBenign += alerts.length; }
    const floorPair = graph.nodes[graph.stations[m.origin].node].floor + " → " + graph.nodes[graph.stations[m.dest].node].floor;
    for (const [table, key] of [[byClass, type], [byLoad, m.load], [byRobot, m.robot], [byFloorPair, floorPair]]) {
      const cell = table[key] ??= {missions: 0, incidents: 0, detected: 0, alerts: 0, falseBenign: 0};
      cell.missions++; cell.alerts += alerts.length;
      cell.incidents += incident ? 1 : 0; cell.detected += hit ? 1 : 0;
      if (!incident) cell.falseBenign += alerts.length;
    }
  }
  const counts = {};
  for (const [kind, value] of Object.entries(kinds)) {
    const d = value.delays.sort((a, b) => a - b);
    counts[kind] = {total: value.total, detected: d.length, missed: value.total - d.length,
      medianLatencySeconds: quantile(d, .5), p95LatencySeconds: quantile(d, .95)};
  }
  return {missions: missions.length, windowSeconds: WINDOW, alerts: emitted, trueAlerts: detected,
    falseAlerts: emitted - detected, precision: emitted ? rounded(detected / emitted) : null,
    benignMissions: benign, benignObservedHours: rounded(benignSeconds / 3600), falseBenign,
    falsePer100: benign ? rounded(falseBenign * 100 / benign) : null,
    falsePerBenignHour: benignSeconds ? rounded(falseBenign * 3600 / benignSeconds) : null,
    ...counts, byClass, byLoad, byRobot, byFloorPair};
}

function calibrate(times, missions, conditional) {
  // Freeze on calibration only. Prefer the most detected incidents within an
  // explicit simulation budget, then fewer false alarms. A site sets its own budget.
  const options = [.95, .975, .99, .995, 1].map(q => {
    const model = thresholds(times, q, conditional);
    const result = evaluate(missions, model);
    return {q, model, hits: result.trueAlerts, falsePer100: result.falsePer100, falseAlerts: result.falseAlerts};
  });
  options.sort((a, b) => {
    const aOver = Math.max(0, a.falsePer100 - 3), bOver = Math.max(0, b.falsePer100 - 3);
    return aOver - bOver || b.hits - a.hits || a.falseAlerts - b.falseAlerts || a.q - b.q;
  });
  return options[0];
}

function heatmap() {
  const edges = new Map(graph.edges.map(([from, to]) => [from + ">" + to, {
    from, to, zone: graph.nodes[from].floor === graph.nodes[to].floor ? "lane" : "lift cabin",
    missions: 0, traversals: 0, seconds: 0, alerts: 0, example: null
  }]));
  return {edges, missingSeconds: 0, stationSeconds: 0, stationAlerts: 0, missionSeconds: 0};
}

function recordTrace(map, id, samples) {
  const seen = new Set();
  let observed = 0;
  for (const s of samples) {
    map.missionSeconds += STEP;
    if (!s.visible) { map.missingSeconds += STEP; continue; }
    observed += STEP;
    if (!s.to) { map.stationSeconds += STEP; continue; }
    const key = s.from + ">" + s.to;
    const cell = map.edges.get(key);
    if (!cell) throw Error("Unmapped directed edge " + key);
    cell.seconds += STEP;
    if (s.traversed) { cell.traversals++; seen.add(key); cell.example ??= id; }
  }
  for (const edge of seen) map.edges.get(edge).missions++;
  return observed;
}

function runStudy({seed = ROOT_SEED, counts = MIX} = {}) {
  const map = heatmap(), splits = {}, sets = {}, routes = new Set(), outcomes = {};
  const traceHash = crypto.createHash("sha256");
  let sample, baseline, advisory;
  for (const split of Object.keys(MIX)) {
    if (split === "test") {
      const data = train(sets.training);
      baseline = calibrate(data, sets.calibration, false);
      advisory = calibrate(data, sets.calibration, true);
    }
    const groups = manifest(split, seed, counts[split]);
    const missions = sets[split] = [];
    const byClass = Object.fromEntries(CLASSES.map(k => [k, 0]));
    const splitOutcomes = {};
    for (const group of groups) {
      for (const m of workload(group)) {
        const {samples, ...facts} = m;
        const events = episodes(samples);
        const observed = recordTrace(map, m.id, samples);
        missions.push({...facts, events, observed});
        routes.add(m.origin + " → " + m.dest);
        byClass[m.truth.label]++;
        outcomes[m.outcome] = (outcomes[m.outcome] || 0) + 1;
        splitOutcomes[m.outcome] = (splitOutcomes[m.outcome] || 0) + 1;
        traceHash.update(JSON.stringify([m.id, m.origin, m.dest, m.outcome, samples]));
        if (!sample && split === "test") sample = {id: m.id, group: m.group, seed: m.seed, origin: m.origin,
          destination: m.dest, observedSeconds: observed, intervals: events.slice(0, 6)};
      }
    }
    splits[split] = {missions: missions.length, groups: groups.length, byClass, outcomes: splitOutcomes,
      seedFrom: groups[0]?.seed ?? null, seedTo: groups.at(-1)?.seed ?? null};
  }
  const metrics = {baseline: evaluate(sets.test, baseline.model), advisory: evaluate(sets.test, advisory.model)};
  for (const missions of Object.values(sets)) for (const m of missions) for (const a of detect(m.events, advisory.model)) {
    const cell = map.edges.get(a.from + ">" + a.to);
    if (cell) cell.alerts++; else map.stationAlerts++;
  }
  const all = Object.values(splits).reduce((n, s) => n + s.missions, 0);
  const edges = [...map.edges.values()].map(e => ({...e, missionsPer100: rounded(e.missions * 100 / all),
    alertsPerHour: e.seconds ? rounded(e.alerts * 3600 / e.seconds) : null}));
  const digest = file => sha(fs.readFileSync(path.join(__dirname, file)));
  return {version: 1, seed, stepSeconds: STEP, missions: all, splits, outcomes, uniqueStationPairs: routes.size,
    graphSHA256: digest("../clinic3d/network.json"), controllerSHA256: digest("../clinic3d/fleet.js"),
    generatorSHA256: digest("study.cjs"), traceSHA256: traceHash.digest("hex"), edges, metrics,
    thresholds: {baseline, advisory}, sample, exposure: {totalSeconds: map.missionSeconds, missingSeconds: map.missingSeconds,
      observedSeconds: map.missionSeconds - map.missingSeconds, stationSeconds: map.stationSeconds, stationAlerts: map.stationAlerts,
      cabinSeconds: edges.filter(e => e.zone === "lift cabin").reduce((n, e) => n + e.seconds, 0)},
    scope: "Two concurrent simulated missions per workload use the clinic fleet controller on a 0.5 s step. Lane counts use distinct observed mission IDs. Exposure excludes sampled radio gaps. Stationary time outside a lane is counted separately. Both detectors score identical recorded observations after the run.",
    model: "A fixed matching-assignment rule is shared by both detectors. The baseline learns one stationary-time threshold. The advisory learns thresholds by reported phase and traffic, using training data and mixed calibration groups. One episode fires per continuous hold, resetting after movement, phase or segment change, or loss of observation. A hit falls within 30 s of a labeled onset.",
    limits: "Synthetic study at one site and one map. The faults are unexpected equipment holds. Violations are mismatched destination records. An authorized stop has a dispatch signal. Simulated timeouts and refusals are retained. The run supplies no clinical accuracy, physical lift response, vendor validation, or measured operator alarm budget."};
}

if (require.main === module) {
  const id = process.argv[2];
  if (id) {
    const m = /^(training|calibration|test)-(\d+)$/.exec(id);
    if (!m) throw Error("Supply a workload ID such as test-7.");
    const group = manifest(m[1])[Number(m[2]) - 1];
    if (!group) throw Error("Unknown workload.");
    process.stdout.write(JSON.stringify(workload(group)) + "\n");
  } else {
    const summary = runStudy();
    fs.writeFileSync(path.join(__dirname, "study-summary.json"), JSON.stringify(summary, null, 2) + "\n");
    console.log(summary.missions + " missions, " + summary.uniqueStationPairs + " station pairs, " + summary.traceSHA256);
  }
}
module.exports = {manifest, workload, episodes, train, thresholds, detect, evaluate, heatmap, recordTrace, runStudy, STEP};
