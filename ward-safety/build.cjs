"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {buildPreview} = require("./workflows.js");
const read = name => fs.readFileSync(path.join(__dirname, name), "utf8");
const load = name => JSON.parse(read(name));

function buildPage() {
  const inputs = {
    "network-data":load("../clinic3d/network.json"),
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
module.exports = {buildPage};
