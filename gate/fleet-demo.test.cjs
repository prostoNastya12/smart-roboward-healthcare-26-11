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
  assert.ok(page.includes("<title>Smart RoboWard | Live simulation</title>"));
  assert.ok(page.includes('aria-pressed="true">Live simulation</button>') && page.includes('aria-pressed="false">View the route</button>') && page.includes("<h1>Live simulation</h1>"));
  assert.ok(!page.includes(">Fleet console</button>") && !page.includes(">Case replay</button>"));
  const hooks = page.indexOf("window.RWHooks"), consoleScripts = page.indexOf("clinic-3d-assets:start");
  const layer = page.indexOf("const DemoLayer"), app = page.indexOf("window.RWDemo");
  assert.ok(hooks > 0 && hooks < consoleScripts, "hooks must run before the console scripts");
  assert.ok(layer > consoleScripts && app > layer, "layer and app must run after the console scripts");
  assert.ok(page.includes("const RWGate"), "the real gate code is included");
  // everything of the original console is still there, in the same order
  const stripped = page.replace(/<style>\n[\s\S]*?hk-bar[\s\S]*?<\/style>\n<\/head>/, "</head>");
  for (const marker of ["id=\"model-panel\"", "id=\"fleet-worker-source\"", "window.makeFleetScene"]) assert.ok(stripped.includes(marker), marker);
});

test("the injected scripts add exactly six balanced script blocks", () => {
  const count = (s, re) => (s.match(re) || []).length;
  assert.equal(count(page, /<script/gi), count(page, /<\/script/gi));
  assert.equal(count(page, /<script/gi) - count(consoleHtml, /<script/gi), 6);   // hooks, gate, pipelines, layer, traffic, app
  assert.ok(page.indexOf("const FleetTraffic") > page.indexOf("const DemoLayer") && page.indexOf("window.RWDemo") > page.indexOf("const FleetTraffic"));
});

test("this page's embedded fleet controller and map have ten robots; the original console page is unchanged", () => {
  assert.ok(page.includes('home:"BAY-7"') && page.includes('fleetsize') && page.includes('"BAY-7":{"name":"Parking bay 7"'));
  assert.ok(!consoleHtml.includes("fleetsize") && !consoleHtml.includes("BAY-1"));
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

test("the nine secure pipelines run inside the page's own scripts and decide like the secure-comms results", async () => {
  const {pipelinesSource} = require("./build-hacker.cjs");
  assert.ok(page.includes("root.SecureAttacks") && page.includes('<optgroup label="Lift-call pipelines (real cryptography)">'));
  // run the page's gate and pipeline scripts in a fresh browser-like context
  const ctx = vm.createContext({console, TextEncoder, TextDecoder, btoa, atob, performance, setTimeout, clearTimeout, crypto: globalThis.crypto, URL});
  ctx.globalThis = ctx; ctx.window = ctx;
  vm.runInContext(gateBrowserSource() + "\nglobalThis.RWGate = RWGate;", ctx);
  vm.runInContext(pipelinesSource(), ctx);
  const A = ctx.SecureAttacks, saved = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "secure-comms", "results.json"), "utf8"));
  assert.equal(Object.keys(ctx.SecureComms.PIPELINES).join(""), "ABCDEFGHI");
  const t06 = A.ATTACKS.find(x => x.id === "T06"), l01 = A.LEGIT[0];
  for (const id of ["A", "G", "I"]) {
    assert.equal((await t06.run(id)).blocked, saved.results[id].attacks.T06.blocked, "T06 on " + id + " matches the saved result");
    assert.equal((await l01.run(id)).pass, true, "a routine lift call passes on " + id);
  }
  assert.equal((await t06.run("A")).blocked, false);
  assert.equal((await t06.run("I")).blocked, true);
});
