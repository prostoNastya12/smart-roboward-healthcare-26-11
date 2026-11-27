"use strict";
// Shared look for every page: inlines site/theme.css and the app header (same design as the Fleet console).
// Templates contain /*__THEME__*/ inside <style> and <!--__HEADER__--> as the first child of <main>.
const fs = require("node:fs");
const path = require("node:path");

// Links use the published (flat) layout of the GitHub Pages site, see .github/workflows/pages.yml.
const PAGES = [
  ["index", "index.html", "Overview"],
  ["fleet", "Clinic-World.html", "Fleet console"],
  ["secure", "security-pipelines.html", "Secure pipelines"],
  ["ward", "ward-safety.html", "Ward safety"],
  ["replay", "Smart-RoboWard-replay.html", "Lift replay"],
  ["hack", "hacker-demo.html", "Live hack demo"],
  ["results", "gate-results.html", "Gate results"]
];

function header(active, status) {
  const links = PAGES.map(([id, href, label]) =>
    '<a href="' + href + '"' + (id === active ? ' aria-current="page"' : "") + ">" + label + "</a>").join("");
  return '<header class="app-head"><a class="brand" href="index.html"><i class="brand-mark" aria-hidden="true"></i>Smart RoboWard</a>\n' +
    '  <nav class="mode" aria-label="Pages">' + links + "</nav>\n" +
    '  <div class="sim-bar"><span><i class="sim-ind" aria-hidden="true"></i>' + (status || "Simulated data") + "</span></div>\n</header>";
}

function withTheme(html, active, status) {
  if (!html.includes("/*__THEME__*/") || !html.includes("<!--__HEADER__-->")) throw new Error("template is missing a theme or header placeholder");
  const css = fs.readFileSync(path.join(__dirname, "theme.css"), "utf8");
  return html.replace("/*__THEME__*/", () => css).replace("<!--__HEADER__-->", () => header(active, status));
}

module.exports = {withTheme, header, PAGES};
