"use strict";
// Builds site/hacker-demo.html: one self-contained page (works offline) that runs the real gate code
// (gate/gate.cjs, wrapped with a browser-safe crypto shim) in a 3D scene.
// Usage: node gate/build-hacker.cjs
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const {withTheme} = require("../site/theme.cjs");
const read = p => fs.readFileSync(path.join(root, p), "utf8");

// gate.cjs wrapped so it runs without Node: it receives a fake require() and Buffer.
function gateBrowserSource() {
  const shim = read("gate/hacker/shim.js");
  const gate = read("gate/gate.cjs");
  return shim + "\nconst RWGate = (function () {\n" +
    "  const module = {exports: {}};\n" +
    "  (function (require, module, exports, Buffer) {\n" + gate + "\n  })(function (n) { if (n === 'node:crypto') return RWShim.crypto; throw new Error('no ' + n); }, module, module.exports, RWShim.Buffer);\n" +
    "  return module.exports;\n})();\n";
}

function build() {
  const safe = s => s.replace(/<\/script/gi, "<\\/script");
  const tpl = read("gate/hacker/template.html");
  const parts = {
    THREE: read("clinic3d/vendor/three.min.js"),
    GATE: gateBrowserSource(),
    SCENE: read("gate/hacker/scene.js"),
    APP: read("gate/hacker/app.js")
  };
  let html = withTheme(tpl, "hack", "Real gate code · local simulation");
  for (const [k, v] of Object.entries(parts)) html = html.replace("/*__" + k + "__*/", () => safe(v));
  fs.writeFileSync(path.join(root, "site", "hacker-demo.html"), html);
  console.log("wrote site/hacker-demo.html", html.length, "bytes");
}
if (require.main === module) build();
module.exports = {gateBrowserSource};
