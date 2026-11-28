"use strict";
// Runs every attack and legitimate case against every pipeline and writes secure-comms/results.json.
// Usage: node secure-comms/run.cjs
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const SC = require("./comms.js"), A = require("./attacks.js"), info = require("./info.js");
const hash = name => crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, name))).digest("hex");

async function measure(options = {}) {
  const results = {};
  for (const id of Object.keys(SC.PIPELINES)) results[id] = await A.runPipeline(id, options);
  const needs = Object.fromEntries(Object.entries(info).map(([id, i]) => [id, i.vendorNeeds]));
  // Fairness check asked for by the review: give the identity-only designs an online trip table at the adapter and measure again.
  const variants = {};
  A.setOptions({tripTable: true});
  try {
    for (const id of ["A", "B", "D", "E"]) {
      const r = await A.runPipeline(id, {skipCost: true});
      variants[id] = {summary: r.summary, through: A.ATTACKS.filter(a => !a.limit && !r.attacks[a.id].blocked).map(a => a.id)};
    }
  } finally { A.setOptions({}); }
  const decision = A.choose(results, needs);
  // The team then asked for the strongest design overall, extensions included: most attacks and limits blocked, all legitimate cases passed.
  const score = id => results[id].summary.blocked + results[id].summary.limitsBlocked;
  decision.adopted = Object.keys(results).filter(id => results[id].summary.legitPassed === results[id].summary.legitOf)
    .sort((a, b) => score(b) - score(a) || needs[a] - needs[b])[0];
  return {results, variants, decision};
}
if (require.main === module) measure({costRuns: 200}).then(({results, variants, decision}) => {
  const doc = {meta: {label: "measured on simulated devices with fictional data; attacks written by the team", node: process.version, command: "node secure-comms/run.cjs",
      inputs: {"comms.js": hash("comms.js"), "attacks.js": hash("attacks.js")}, flood: {adapterFramesPerSecond: 20, junkPerSecond: 100, legitimatePerSecond: 4, seconds: 5}},
    attacks: A.ATTACKS.map(({id, name, position, wins, limit, scenario}) => ({id, name, position, wins, limit: !!limit, scenario})),
    fields: A.FIELDS.map(([key, , label]) => ({key, label})),
    legit: A.LEGIT.map(({id, name}) => ({id, name})),
    pipelines: Object.fromEntries(Object.entries(SC.PIPELINES).map(([id, p]) => [id, {name: p.name, short: p.short, extension: !!p.extension}])),
    results, variants, decision};
  fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify(doc, null, 1) + "\n");
  for (const [id, r] of Object.entries(results)) {
    console.log(id, SC.PIPELINES[id].name.padEnd(42), "attacks blocked", String(r.summary.blocked).padStart(2) + "/" + r.summary.of,
      " limits", r.summary.limitsBlocked + "/" + r.summary.limits, " legitimate", r.summary.legitPassed + "/" + r.summary.legitOf, " bytes/call", r.cost.bytesPerCall, " ms/call", r.cost.msPerCall);
  }
  console.log("Eligible:", decision.eligible.join(", "), "· rule winner:", decision.winner, "· adopted:", decision.adopted);
});
module.exports = {measure};
