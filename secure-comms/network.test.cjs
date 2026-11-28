"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const path = require("node:path");
const run = id => spawnSync(process.execPath, [path.join(__dirname, "network-demo.cjs"), id], {encoding: "utf8", timeout: 120000});

test("over real sockets, a keyless attacker process causes no lift call on the adopted pipeline", () => {
  const r = run("I");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /nothing readable beyond which robot spoke/);
  assert.match(r.stdout, /Lift calls caused by the attacker\s+0/);
});

test("the same attacker process succeeds against the open network, so the demo can fail", () => {
  const r = run("A");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /learned: trip, floor, medication order, patient marker/);
});
