"use strict";
// Builds site/gate-results.html from gate/results-template.html with results.json embedded (works offline).
// Usage: node gate/build-page.cjs
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const {withTheme} = require("../site/theme.cjs");
const doc = JSON.parse(fs.readFileSync(path.join(root, "experiments/runs/latest/results.json"), "utf8"));
const json = JSON.stringify(doc).replace(/</g, "\\u003c");
const template = fs.readFileSync(path.join(__dirname, "results-template.html"), "utf8");
const html = withTheme(template, "results", "Measured · synthetic data").replace("/*__DATA__*/null", () => json);   // function form: no $-pattern surprises in the JSON
fs.writeFileSync(path.join(root, "site", "gate-results.html"), html);
console.log("wrote site/gate-results.html", html.length, "bytes");
