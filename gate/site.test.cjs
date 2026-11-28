"use strict";
// The published site: seven pages with the same navigation, and no link that would be a dead end once deployed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {PAGES} = require("../site/theme.cjs");

const root = path.join(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "pages.yml"), "utf8");
// what the workflow publishes (names inside _site)
const published = new Set(["index.html", "live-simulation.html", "incident-review.html", "gate-results.html", "lift-replay.html", "security-pipelines.html", "ward-safety.html", "Clinic-World.glb", "Clinic-World-3D.png"]);
const sources = {
  "index.html": "site/index.html", "live-simulation.html": "site/live-simulation.html", "incident-review.html": "site/incident-review.html",
  "gate-results.html": "site/gate-results.html", "lift-replay.html": "output/visualizations/Smart-RoboWard-replay.html",
  "security-pipelines.html": "site/security-pipelines.html", "ward-safety.html": "site/ward-safety.html"};
const read = name => fs.readFileSync(path.join(root, sources[name]), "utf8");
const hrefs = html => [...html.matchAll(/\bhref="([^"]+)"/g)].map(m => m[1]);

test("the navigation is Overview, Live simulation, Secure pipelines, Ward safety, Lift replay, Incident review, Gate results", () => {
  assert.deepEqual(PAGES.map(p => p[2]), ["Overview", "Live simulation", "Secure pipelines", "Ward safety", "Lift replay", "Incident review", "Gate results"]);
  assert.deepEqual(PAGES.map(p => p[1]), ["index.html", "live-simulation.html", "security-pipelines.html", "ward-safety.html", "lift-replay.html", "incident-review.html", "gate-results.html"]);
});

test("the workflow publishes exactly the pages and files this site links to, and not the plain console", () => {
  for (const name of published) assert.ok(workflow.includes(name), name + " is published");
  assert.ok(workflow.includes("Smart-RoboWard-replay.html _site/lift-replay.html"), "the replay is published as lift-replay.html");
  assert.ok(!/cp [^\n]*Clinic-World\.html/.test(workflow.replace(/#[^\n]*/g, "")), "the plain Clinic-World.html console is not published");
  assert.ok(!workflow.includes("hacker-demo.html"));
});

for (const name of ["index.html", "incident-review.html", "gate-results.html", "lift-replay.html", "security-pipelines.html"]) {
  test(name + " has the shared header, and every link points to a published page", () => {
    const html = read(name);
    const nav = html.match(/<nav class="mode"[\s\S]*?<\/nav>/)[0];
    for (const [, href, label] of PAGES) assert.ok(nav.includes('href="' + href + '"') && nav.includes(">" + label + "<"), label + " is in the navigation");
    assert.equal((nav.match(/aria-current="page"/g) || []).length, 1, "one current page");
    for (const href of hrefs(html)) {
      if (/^(https?:|#|mailto:)/.test(href)) continue;
      assert.ok(published.has(href.split("#")[0]), name + " links to " + href + ", which is not published");
    }
  });
}

test("the live simulation page links back to the overview and has only published links", () => {
  const html = read("live-simulation.html");
  assert.ok(html.includes("<title>Smart RoboWard | Live simulation</title>"));
  for (const href of hrefs(html)) {
    if (/^(https?:|#|mailto:|blob:)/.test(href) || href === "") continue;
    assert.ok(published.has(href.split("#")[0]) || href.startsWith("data:"), "live-simulation.html links to " + href);
  }
  assert.ok(html.includes('back.href = "index.html"') && html.includes('back.textContent = "← All pages"'), "a way back to the overview (the demo script adds the link when the page loads)");
});

test("the overview follows the example: hero, Cases and results with three cards, the model download", () => {
  const html = read("index.html");
  assert.ok(html.includes("<h1 id=\"hero-title\">"));
  assert.ok(html.includes("Cases and results") && html.includes("View the route map") && html.includes('href="live-simulation.html#route"'));
  for (const card of ["Shared lift replay", "Incident review", "Gate benchmark results", "Secure pipelines", "Ward safety control room"]) assert.ok(html.includes(card), card);
  assert.ok(html.includes("Download the 3D model (.glb)") && html.includes('href="Clinic-World.glb"'));
  assert.ok(html.includes("Source and licenses"));
});

test("the incident review page carries the recorded decisions and request descriptions for all 24 requests", () => {
  const html = read("incident-review.html");
  const meta = JSON.parse(fs.readFileSync(path.join(root, "gate", "request-meta.json"), "utf8"));
  assert.equal(Object.keys(meta).length, 24);
  for (const id of Object.keys(meta)) assert.ok(html.includes('"' + id + '":'), id + " is embedded");
  assert.ok(html.includes("What each defence decided"));
});
