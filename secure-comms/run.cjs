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
  return {results, decision: A.choose(results, needs)};
}
if (require.main === module) measure({costRuns: 200}).then(({results, decision}) => {
  const doc = {meta: {label: "measured on simulated devices with fictional data; attacks written by the team", node: process.version, command: "node secure-comms/run.cjs",
      inputs: {"comms.js": hash("comms.js"), "attacks.js": hash("attacks.js")}, flood: {adapterFramesPerSecond: 20, junkPerSecond: 100, legitimatePerSecond: 4, seconds: 5}},
    attacks: A.ATTACKS.map(({id, name, position, wins, limit}) => ({id, name, position, wins, limit: !!limit})),
    legit: A.LEGIT.map(({id, name}) => ({id, name})),
    pipelines: Object.fromEntries(Object.entries(SC.PIPELINES).map(([id, p]) => [id, {name: p.name, short: p.short}])),
    results, decision};
  fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify(doc, null, 1) + "\n");
  for (const [id, r] of Object.entries(results)) {
    console.log(id, SC.PIPELINES[id].name.padEnd(42), "attacks blocked", String(r.summary.blocked).padStart(2) + "/" + r.summary.of,
      " legitimate", r.summary.legitPassed + "/" + r.summary.legitOf, " bytes/call", r.cost.bytesPerCall, " ms/call", r.cost.msPerCall);
  }
  console.log("Eligible:", decision.eligible.join(", "), "· chosen:", decision.winner);
});
module.exports = {measure};
