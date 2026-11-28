"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const {manifest, workload, episodes, thresholds, detect, heatmap, recordTrace, runStudy, STEP} = require("./study.cjs");
const summary = require("./study-summary.json");
const graph = require("../clinic3d/network.json");

test("the published run used 10,000 attempted missions in disjoint paired workload and seed groups", () => {
  const seeds = new Set(), ids = new Set();
  for (const [name, count] of [["training", 6000], ["calibration", 2000], ["test", 2000]]) {
    const groups = manifest(name);
    assert.equal(groups.length * 2, count);
    for (const group of groups) {
      assert.ok(!seeds.has(group.seed) && !ids.has(group.id));
      seeds.add(group.seed); ids.add(group.id);
    }
    assert.equal(Object.values(summary.splits[name].outcomes).reduce((a,b) => a+b), count);
  }
  assert.deepEqual(summary.splits.test.byClass, {ordinary:1600, approved:200, fault:100, violation:100});
  assert.equal(summary.splits.training.byClass.fault + summary.splits.training.byClass.violation, 0);
  assert.equal(summary.missions, 10000);
  assert.equal(summary.uniqueStationPairs, 30);
  for (const [file, key] of [["./study.cjs", "generatorSHA256"], ["../clinic3d/fleet.js", "controllerSHA256"],
    ["../clinic3d/network.json", "graphSHA256"]]) {
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(require.resolve(file))).digest("hex"), summary[key]);
  }
});

test("concurrent workloads replay deterministically with no incident labels or future outcomes in observations", () => {
  const group = manifest("test").find(g => g.labels.includes("approved"));
  const out = workload(group);
  assert.deepEqual(out, workload(group));
  assert.equal(out.length, 2);
  assert.ok(out.some(m => m.samples.some(s => s.phase === "authorized stop")));
  const edges = new Set(graph.edges.map(([a,b]) => a + ">" + b));
  for (const m of out) for (const s of m.samples) {
    assert.deepEqual(Object.keys(s).sort(), ["assigned","from","load","moved","phase","requested","t","to","traversed","visible"]);
    if (s.to) assert.ok(edges.has(s.from + ">" + s.to));
  }
});

test("hand-counted repeated lane, reverse traversal, missing interval, station wait and cabin have separate exposure", () => {
  const map = heatmap();
  const [from, to] = graph.edges[0], [a,b] = graph.cabins;
  const trace = [[from,to,true,true], [to,from,true,true], [from,to,true,true], [from,to,false,false],
    [from,null,false,true], [a,b,true,true]].map(([from,to,traversed,visible]) => ({from,to,traversed,visible}));
  assert.equal(recordTrace(map, "test-trip", trace), 5 * STEP);
  assert.equal(map.missingSeconds, STEP); assert.equal(map.stationSeconds, STEP);
  const lane = map.edges.get(from + ">" + to);
  assert.deepEqual([lane.missions, lane.traversals, lane.seconds], [1, 2, 2 * STEP]);
  assert.equal(map.edges.get(to + ">" + from).missions, 1);
  assert.equal(map.edges.get(a + ">" + b).zone, "lift cabin");
  assert.equal(map.edges.get(a + ">" + b).seconds, STEP);
  assert.equal(summary.exposure.observedSeconds + summary.exposure.missingSeconds, summary.exposure.totalSeconds);
  assert.equal(summary.edges.reduce((total, e) => total + e.seconds, 0) + summary.exposure.stationSeconds, summary.exposure.observedSeconds);
});

test("nearest-rank thresholds condition on supported phases and alert once per observed continuous episode", () => {
  const trained = {all: [1,2,3,4], "lane/light": Array(20).fill(1)};
  assert.deepEqual(thresholds(trained, .5, false), {all:2});
  assert.deepEqual(thresholds(trained, .5, true), {all:2, "lane/light":1});
  const sample = {from:"a", to:"b", visible:true, moved:false, phase:"lane", load:"light", assigned:"B"};
  const timeline = [0,1,2,3,4,5,6,7].map(i => ({...sample, t:(i+1)*STEP, visible:i!==4}));
  const features = episodes(timeline);
  assert.equal(features.length, 2);
  assert.deepEqual(detect(features, {"lane/light":1, all:2}).map(a => a.time), [1.5, 4]);
  assert.equal(detect(episodes([{...sample, t:1, requested:"A", visible:false}]), {all:3}).length, 0);
});

test("repeated seeded study yields identical traces, frozen models and blind metrics", () => {
  const counts = {training:[24,8,0,0], calibration:[8,2,2,2], test:[8,2,2,2]};
  const first = runStudy({counts}), second = runStudy({counts});
  assert.deepEqual(first, second);
  const changedTest = runStudy({counts:{...counts, test:[4,2,4,4]}});
  assert.deepEqual(first.thresholds, changedTest.thresholds);
  for (const result of Object.values(summary.metrics)) {
    assert.equal(result.benignMissions, 1800);
    assert.equal(result.fault.detected + result.fault.missed, 100);
    assert.equal(result.violation.detected + result.violation.missed, 100);
    assert.equal(result.trueAlerts + result.falseAlerts, result.alerts);
  }
});
