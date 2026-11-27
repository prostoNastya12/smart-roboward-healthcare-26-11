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
  assert.deepEqual(fresh.variants, saved.variants);
});

test("the selection rule picks the layered pipeline among the seven candidates", () => {
  assert.equal(saved.decision.winner, "G");
  assert.deepEqual([...saved.decision.eligible].sort(), ["A", "B", "C", "D", "E", "F", "G"]);
  for (const id of saved.decision.eligible) assert.equal(saved.results[id].summary.legitPassed, saved.results[id].summary.legitOf, id);
  const others = saved.decision.eligible.filter(id => id !== "G").map(id => saved.results[id].summary.blocked);
  assert.ok(saved.results.G.summary.blocked > Math.max(...others));
});

test("with a trip table the simpler designs improve, and still stay behind the chosen pipeline", () => {
  for (const [id, v] of Object.entries(saved.variants)) {
    assert.ok(v.summary.blocked >= saved.results[id].summary.blocked, id);
    assert.ok(v.summary.blocked < saved.results.G.summary.blocked, id);
  }
  assert.ok(!saved.variants.D.through.includes("T08"));
  assert.ok(saved.variants.E.through.includes("T07"));
});

test("the chosen pipeline meets the plan's acceptance bar and still loses the two stated limits", () => {
  const g = saved.results.G;
  assert.equal(g.summary.legitPassed, g.summary.legitOf);
  assert.ok(g.summary.blocked >= g.summary.of - 1);
  for (const limit of A.ATTACKS.filter(a => a.limit)) assert.equal(g.attacks[limit.id].blocked, false, limit.id);
});

test("the dual-control extension closes the dispatcher limit without losing anything the chosen pipeline had", () => {
  const g = saved.results.G, h = saved.results.H;
  assert.equal(h.attacks.T20.blocked, true);
  assert.equal(h.attacks.T21.blocked, false);
  assert.equal(h.summary.legitPassed, h.summary.legitOf);
  for (const a of A.ATTACKS) if (g.attacks[a.id].blocked) assert.equal(h.attacks[a.id].blocked, true, a.id);
  assert.ok(!saved.decision.eligible.includes("H"));
});

test("each simpler design fails where the plan says it should", () => {
  const blocked = (id, t) => saved.results[id].attacks[t].blocked;
  assert.equal(blocked("B", "T02"), true);  assert.equal(blocked("B", "T05"), false);   // admission stops outsiders only
  assert.equal(blocked("C", "T04"), true);  assert.equal(blocked("C", "T10"), false);   // tickets bind the floor but can be copied
  assert.equal(blocked("C", "T09"), false);                                             // and a retired robot keeps the ticket it was given
  assert.equal(blocked("D", "T05"), true);  assert.equal(blocked("D", "T08"), false);   // identity is not permission
  assert.equal(blocked("E", "T01"), true);  assert.equal(blocked("E", "T07"), false);   // a channel ends at each hop
  assert.equal(blocked("F", "T07"), true);  assert.equal(blocked("F", "T01"), false);   // a grant is end to end but in clear
});

test("the committed comparison page matches its sources", () => {
  const {buildPage} = require("./build-page.cjs");
  assert.equal(fs.readFileSync(path.join(__dirname, "../site/security-pipelines.html"), "utf8"), buildPage());
});
