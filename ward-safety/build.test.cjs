"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {buildPage, buildFloors} = require("./build.cjs");
const network = require("../clinic3d/network.json");

test("the floor plan shares the lane graph's metric frame", () => {
  const floors = buildFloors();
  for (const name of ["L1", "L2"]) {
    const xs = floors[name].polygons.flat().map(p => p[0]), zs = floors[name].polygons.flat().map(p => p[1]);
    assert.ok(floors[name].walls.length > 100);
    for (const node of Object.values(network.nodes).filter(n => n.floor === name)) {
      assert.ok(node.x >= Math.min(...xs) && node.x <= Math.max(...xs) && node.z >= Math.min(...zs) && node.z <= Math.max(...zs));
    }
  }
});

test("the built page embeds every input and scripts that parse", () => {
  const html = buildPage();
  assert.ok(!/<!--WARD_/.test(html));
  for (const id of ["network-data", "floor-data", "study-data", "preview-data"]) {
    const json = html.match(new RegExp('<script type="application/json" id="' + id + '">(.*?)</script>', "s"));
    assert.ok(json, id);
    JSON.parse(json[1]);
  }
  new vm.Script(fs.readFileSync(path.join(__dirname, "panel.js"), "utf8"));
});

test("the committed page matches its sources", () => {
  assert.equal(fs.readFileSync(path.join(__dirname, "index.html"), "utf8"), buildPage());
});
