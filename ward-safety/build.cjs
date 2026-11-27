"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {buildPreview} = require("./workflows.js");
const read = name => fs.readFileSync(path.join(__dirname, name), "utf8");
const load = name => JSON.parse(read(name));

// Floor outlines and walls in the same metric frame as clinic3d/network.json.
// Reuses the map reader and origin from clinic3d/build_model.py so the two cannot drift.
function buildFloors() {
  const {spawnSync} = require("node:child_process");
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("clinic_model", sys.argv[1])
model = importlib.util.module_from_spec(spec)
spec.loader.exec_module(model)
source = open(sys.argv[2], encoding="utf-8").read()
levels = [model.read_level(source, name) for name in ("L1", "L2")]
ox, oz = model.map_origin(levels)
plan = {}
for level in levels:
    scale = level["scale"]
    at = lambda i: [round((level["points"][i][0] - ox) * scale, 2), round((level["points"][i][1] - oz) * scale, 2)]
    plan[level["name"]] = {"polygons": [[at(i) for i in poly] for _, poly in level["floors"]],
                           "walls": [[at(a), at(b)] for a, b, _ in level["walls"]]}
print(json.dumps(plan, separators=(",", ":")))
`;
  const result = spawnSync("python3", ["-I", "-B", "-c", script, path.join(__dirname, "../clinic3d/build_model.py"),
    path.join(__dirname, "../output/simulation/open-rmf/clinic.building.yaml")], {encoding:"utf8", timeout:15000});
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error("Floor plan export failed. " + result.stderr.trim());
  return JSON.parse(result.stdout);
}

function buildPage() {
  const inputs = {
    "network-data":load("../clinic3d/network.json"),
    "floor-data":buildFloors(),
    "study-data":load("study-summary.json"),
    "preview-data":buildPreview(load("../output/simulation/smart-roboward-scenarios.json"))
  };
  const data = Object.entries(inputs).map(([id,value]) => {
    const json = JSON.stringify(value).replaceAll("<","\\u003c");
    return '<script type="application/json" id="' + id + '">' + json + '</script>';
  }).join("\n");
  const scripts = ["../clinic3d/fleet.js","controller.js","workflows.js","panel.js"].map(name =>
    "<script>\n" + read(name).replace(/<\/script/gi,"<\\/script") + "\n</script>").join("\n");
  let html = read("panel.html");
  for (const [slot,content] of Object.entries({WARD_DATA:data, WARD_STYLE:"<style>\n"+read("panel.css")+"\n</style>", WARD_SCRIPTS:scripts})) {
    const marker = "<!--" + slot + "-->";
    if (html.split(marker).length !== 2) throw Error("Expected one " + marker);
    html = html.replace(marker, () => content);
  }
  return html;
}
if (require.main === module) {
  fs.writeFileSync(path.join(__dirname,"index.html"),buildPage());
  console.log("Built ward-safety/index.html");
}
module.exports = {buildPage, buildFloors};
