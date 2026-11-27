"use strict";
// Builds site/security-pipelines.html: the saved results plus the same protocol and attack code, so the page can re-run them offline.
// Usage: node secure-comms/build-page.cjs   (run node secure-comms/run.cjs first when the code changes)
const fs = require("node:fs");
const path = require("node:path");
const {withTheme} = require("../site/theme.cjs");
const read = name => fs.readFileSync(path.join(__dirname, name), "utf8");

function buildPage() {
  const sources = [read("../clinic3d/fleet.js"), require("../gate/build-hacker.cjs").gateBrowserSource(), read("../ward-safety/controller.js"),
    read("comms.js"), read("attacks.js"), read("info.js"), read("page.js")];
  const scripts = sources.map(s => "<script>\n" + s.replace(/<\/script/gi, "<\\/script") + "\n</script>").join("\n");
  const data = JSON.stringify(JSON.parse(read("results.json"))).replace(/</g, "\\u003c");
  return withTheme(read("page-template.html"), "secure", "Simulated devices · real cryptography")
    .replace("/*__PAGE_CSS__*/", () => read("page.css")).replace("/*__DATA__*/null", () => data).replace("<!--__SCRIPTS__-->", () => scripts);
}
if (require.main === module) {
  const html = buildPage();
  fs.writeFileSync(path.join(__dirname, "../site/security-pipelines.html"), html);
  console.log("wrote site/security-pipelines.html", html.length, "bytes");
}
module.exports = {buildPage};
