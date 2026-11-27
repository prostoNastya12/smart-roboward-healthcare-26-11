"use strict";
// Checks how the fleet-based live hack demo page is assembled, and that its browser copy of the gate matches the Node gate.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {assemble, gateBrowserSource} = require("./build-hacker.cjs");
const real = require("./gate.cjs");

const consoleHtml = fs.readFileSync(path.join(__dirname, "..", "output", "visualizations", "Clinic-World.html"), "utf8");
const page = assemble(consoleHtml);

test("the demo is injected into the unchanged fleet console page", () => {
  assert.ok(page.includes("<title>Smart RoboWard | Live hack demo</title>"));
  const hooks = page.indexOf("window.RWHooks"), consoleScripts = page.indexOf("clinic-3d-assets:start");
  const layer = page.indexOf("const DemoLayer"), app = page.indexOf("window.RWDemo");
  assert.ok(hooks > 0 && hooks < consoleScripts, "hooks must run before the console scripts");
  assert.ok(layer > consoleScripts && app > layer, "layer and app must run after the console scripts");
  assert.ok(page.includes("const RWGate"), "the real gate code is included");
  // everything of the original console is still there, in the same order
  const stripped = page.replace(/<style>\n[\s\S]*?hk-bar[\s\S]*?<\/style>\n<\/head>/, "</head>");
  for (const marker of ["id=\"model-panel\"", "id=\"fleet-worker-source\"", "window.makeFleetScene"]) assert.ok(stripped.includes(marker), marker);
});

test("the injected scripts add exactly four balanced script blocks", () => {
  const count = (s, re) => (s.match(re) || []).length;
  assert.equal(count(page, /<script/gi), count(page, /<\/script/gi));
  assert.equal(count(page, /<script/gi) - count(consoleHtml, /<script/gi), 4);   // hooks, gate, layer, app
});

test("the browser copy of the gate answers exactly like the Node gate", () => {
  const web = vm.runInContext(gateBrowserSource() + "\nRWGate", vm.createContext({}));
  const run = lib => {
    const w = lib.makeWorld(), clock = {t: 1000}, g = new lib.Gate(w, {M1: true, M2: true, M3: true, M4: true}, clock, 20), out = [];
    const req = (u, t, d, x) => Object.assign({type: "deliver", user: u, task_id: t, destination: d, token: lib.issueToken(u, t, d, clock.t), source: "S"}, x || {});
    out.push(lib.issueToken("N1", "T1", "Room 12", 5, 1000, "nonce"));
    out.push(g.handle(req("N1", "T1", "Room 12")), g.handle(req("N2", "T1", "Room 12")), g.handle(req("N1", "T1", "Room 12", {patient_name: "x"})));
    for (let i = 0; i < 10; i++) out.push(g.handle({type: "deliver", user: "N1", task_id: "T1", destination: "Room 12", source: "ATK"}));
    out.push(g.verifyAudit(), g.audit.map(e => e.hash).join(","), g.isolated);
    return JSON.stringify(out);
  };
  assert.equal(run(web), run(real));
});
