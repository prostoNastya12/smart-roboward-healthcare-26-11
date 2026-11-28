"use strict";
// Builds the two pages that are drawn from the recorded benchmark run (experiments/runs/latest/results.json), both works offline:
//   site/gate-results.html     from gate/results-template.html
//   site/incident-review.html  from gate/incident-template.html
// The plain-English description of each request is shared: gate/request-meta.json.
// Usage: node gate/build-page.cjs
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const {withTheme} = require("../site/theme.cjs");
const embed = obj => JSON.stringify(obj).replace(/</g, "\\u003c");
const doc = JSON.parse(fs.readFileSync(path.join(root, "experiments/runs/latest/results.json"), "utf8"));
const meta = JSON.parse(fs.readFileSync(path.join(__dirname, "request-meta.json"), "utf8"));

const pages = [
  ["results-template.html", "gate-results.html", "results", "Measured · synthetic data"],
  ["incident-template.html", "incident-review.html", "incident", "Local simulation"]
];
for (const [src, out, active, status] of pages) {
  const template = fs.readFileSync(path.join(__dirname, src), "utf8");
  // function form of replace: no $-pattern surprises in the data
  let html = withTheme(template, active, status).replace("/*__DATA__*/null", () => embed(doc));
  html = html.split("/*__META__*/null").join(embed(meta));
  fs.writeFileSync(path.join(root, "site", out), html);
  console.log("wrote site/" + out, html.length, "bytes");
}
