"use strict";
// Builds the overview and shared-lift replay pages with the shared Fleet console theme (site/theme.css).
// The gate results and hack demo pages have their own builders, which use the same theme:
//   node gate/build-page.cjs && node gate/build-hacker.cjs
// Usage: node site/build-site.cjs
const fs = require("node:fs");
const path = require("node:path");
const {withTheme} = require("./theme.cjs");
const root = path.join(__dirname, "..");

const pages = [
  ["site/index-template.html", "site/index.html", "index", "Local simulation"],
  ["site/replay-template.html", "output/visualizations/Smart-RoboWard-replay.html", "replay", "Fixture replay · offline"]
];
for (const [src, out, active, status] of pages) {
  const html = withTheme(fs.readFileSync(path.join(root, src), "utf8"), active, status);
  fs.writeFileSync(path.join(root, out), html);
  console.log("wrote", out, html.length, "bytes");
}
