"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {measure} = require("./run.cjs");
const A = require("./attacks.js");
const saved = JSON.parse(fs.readFileSync(path.join(__dirname, "results.json"), "utf8"));
let fresh;
const outcomes = results => Object.fromEntries(Object.entries(results).map(([id, r]) => [id,
  {attacks: Object.fromEntries(Object.entries(r.attacks).map(([k, v]) => [k, [v.blocked, v.detail]])),
    legit: Object.fromEntries(Object.entries(r.legit).map(([k, v]) => [k, [v.pass, v.detail]])), summary: r.summary}]));

test("a fresh run reproduces every saved outcome and detail", async () => {
  fresh = await measure({skipCost: true});
  assert.deepEqual(outcomes(fresh.results), outcomes(saved.results));
});

test("the selection rule picks the layered pipeline and excludes the two that fail a retry", () => {
  assert.equal(saved.decision.winner, "G");
  assert.deepEqual([...saved.decision.eligible].sort(), ["C", "D", "E", "F", "G"]);
  for (const id of ["A", "B"]) assert.equal(saved.results[id].legit.L02.pass, false);
});

test("the chosen pipeline meets the plan's acceptance bar and still loses the two stated limits", () => {
  const g = saved.results.G;
  assert.equal(g.summary.legitPassed, 5);
  assert.ok(g.summary.blocked >= 18);
  for (const limit of A.ATTACKS.filter(a => a.limit)) assert.equal(g.attacks[limit.id].blocked, false, limit.id);
});

test("each simpler design fails where the plan says it should", () => {
  const blocked = (id, t) => saved.results[id].attacks[t].blocked;
  assert.equal(blocked("B", "T02"), true);  assert.equal(blocked("B", "T05"), false);   // admission stops outsiders only
  assert.equal(blocked("C", "T04"), true);  assert.equal(blocked("C", "T10"), false);   // tickets bind the floor but can be copied
  assert.equal(blocked("D", "T05"), true);  assert.equal(blocked("D", "T08"), false);   // identity is not permission
  assert.equal(blocked("E", "T01"), true);  assert.equal(blocked("E", "T07"), false);   // a channel ends at each hop
  assert.equal(blocked("F", "T07"), true);  assert.equal(blocked("F", "T01"), false);   // a grant is end to end but in clear
});

test("the committed comparison page matches its sources", () => {
  const {buildPage} = require("./build-page.cjs");
  assert.equal(fs.readFileSync(path.join(__dirname, "../site/security-pipelines.html"), "utf8"), buildPage());
});
