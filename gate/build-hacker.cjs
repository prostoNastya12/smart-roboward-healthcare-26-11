"use strict";
// Builds site/hacker-demo.html (the Live hack demo): a copy of the 3D fleet console page
// (output/visualizations/Clinic-World.html, left unchanged) with the demo injected:
//  - fleet-hooks.js runs first and captures the console's controller worker and Three.js scene (no console code is edited),
//  - the real gate code (gate/gate.cjs with a browser-safe crypto shim) sits in front of every dispatch order,
//  - fleet-layer.js draws the angry hacker, the nurse workstation and the gate in the console's own 3D clinic,
//  - fleet-app.js runs the attacks and turns gate decisions into real fleet commands.
// The page already has the Fleet console design, so it needs no theme step. Works offline.
// Usage: node gate/build-hacker.cjs   (rebuild Clinic-World.html first with clinic3d/build_model.py if the console changes)
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const fleetExtra = require("./hacker/fleet-extra.cjs");

// gate.cjs wrapped so it runs without Node: it receives a fake require() and Buffer.
function gateBrowserSource() {
  const shim = read("gate/hacker/shim.js");
  const gate = read("gate/gate.cjs");
  return shim + "\nconst RWGate = (function () {\n" +
    "  const module = {exports: {}};\n" +
    "  (function (require, module, exports, Buffer) {\n" + gate + "\n  })(function (n) { if (n === 'node:crypto') return RWShim.crypto; throw new Error('no ' + n); }, module, module.exports, RWShim.Buffer);\n" +
    "  return module.exports;\n})();\n";
}

function exactlyOne(html, needle) {
  const n = html.split(needle).length - 1;
  if (n !== 1) throw new Error("Expected exactly one " + JSON.stringify(needle) + " in the console page, found " + n);
}

function assemble(consoleHtml) {
  const safe = s => s.replace(/<\/script/gi, "<\\/script");
  const title = "<title>Smart RoboWard | 3D Fleet Control</title>";
  const workerTag = /(<script id="fleet-worker-source" type="text\/plain">\n)([\s\S]*?)(\n<\/script>)/, networkTag = /(<script id="fleet-network" type="application\/json">)([\s\S]*?)(<\/script>)/;
  for (const needle of [title, "<body>", "</body>", "</head>", '<script id="fleet-worker-source"', '<script id="fleet-network"']) exactlyOne(consoleHtml, needle);
  let html = consoleHtml.replace(title, "<title>Smart RoboWard | Live hack demo</title>");
  // Up to ten robots: this page's copy of the fleet controller and map gets seven extra robots, bays and checkpoints (the console itself is not changed).
  html = html.replace(workerTag, (m, open, body, close) => open + fleetExtra.patchWorkerSource(body) + close);
  html = html.replace(networkTag, (m, open, body, close) => open + JSON.stringify(fleetExtra.patchNetwork(JSON.parse(body))) + close);
  html = html.replace("</head>", () => "<style>\n" + read("gate/hacker/fleet-demo.css") + "\n</style>\n</head>");
  html = html.replace("<body>", () => "<body>\n<script>\n" + safe(read("gate/hacker/fleet-hooks.js")) + "\n</script>");   // before the console scripts
  html = html.replace("</body>", () => "<script>\n" + safe(gateBrowserSource()) + "\n</script>\n<script>\n" + safe(read("gate/hacker/fleet-layer.js")) +
    "\n</script>\n<script>\n" + safe(read("gate/hacker/fleet-traffic.js")) + "\n</script>\n<script>\n" + safe(read("gate/hacker/fleet-app.js")) + "\n</script>\n</body>");   // after them
  return html;
}

function build() {
  const html = assemble(read("output/visualizations/Clinic-World.html"));
  fs.writeFileSync(path.join(root, "site", "hacker-demo.html"), html);
  console.log("wrote site/hacker-demo.html", html.length, "bytes");
}
if (require.main === module) build();
module.exports = {gateBrowserSource, assemble, build};
