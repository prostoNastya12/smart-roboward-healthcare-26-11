"use strict";
// Checks that the browser copy of the gate behaves exactly like the real Node gate.
// The browser copy is run inside a sandbox that has NO Node crypto, Buffer, require or process.
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const crypto = require("node:crypto");
const {gateBrowserSource} = require("./build-hacker.cjs");
const real = require("./gate.cjs");

const sandbox = vm.createContext({});
const web = vm.runInContext(gateBrowserSource() + "\n({RWGate, RWShim})", sandbox);

test("browser sha256 and hmac match Node crypto", () => {
  const inputs = ["", "abc", "x".repeat(55), "x".repeat(56), "x".repeat(64), "x".repeat(200), "Zoë 🙂 日本語", JSON.stringify({a: [1, 2, 3]})];
  for (const s of inputs) {
    assert.equal(Buffer.from(web.RWShim.sha256(web.RWShim.utf8Encode(s))).toString("hex"), crypto.createHash("sha256").update(s).digest("hex"), "sha256 of " + s.slice(0, 12));
    assert.equal(web.RWShim.crypto.createHmac("sha256", "key").update(s).digest().toString("hex"), crypto.createHmac("sha256", "key").update(s).digest("hex"), "hmac of " + s.slice(0, 12));
  }
  const longKey = "k".repeat(100);
  assert.equal(web.RWShim.crypto.createHmac("sha256", longKey).update("m").digest("hex"), crypto.createHmac("sha256", longKey).update("m").digest("hex"));
});

test("browser base64url and utf8 match Node Buffer", () => {
  for (const s of ["", "a", "ab", "abc", "abcd", "Zoë 🙂 日本語", "{\"u\":\"N1\",\"exp\":1234}"]) {
    assert.equal(web.RWShim.Buffer.from(s).toString("base64url"), Buffer.from(s).toString("base64url"));
    assert.equal(web.RWShim.Buffer.from(Buffer.from(s).toString("base64url"), "base64url").toString(), s);
    assert.equal(web.RWShim.Buffer.byteLength(s), Buffer.byteLength(s));
  }
});

// The same script is run against the real gate and the browser gate; every answer must match.
function script(lib) {
  const out = [];
  const T0 = 1_000_000;
  for (const cfg of [{}, {M1: true}, {M2: true}, {M3: true}, {M4: true}, {M1: true, M2: true, M3: true, M4: true}]) {
    const w = lib.makeWorld(), clock = {t: T0}, g = new lib.Gate(w, cfg, clock, 20);
    const dreq = (u, t, d, extra) => Object.assign({type: "deliver", user: u, task_id: t, destination: d, token: lib.issueToken(u, t, d, clock.t), source: "S-" + u}, extra || {});
    const note = (label, r) => out.push([JSON.stringify(cfg), label, r.ok, r.reason || null, r.mode || null]);
    g.beginSecond();
    note("valid", g.handle(dreq("N1", "T1", "Room 12")));
    const replay = dreq("N1", "T2", "Pharmacy"); g.handle(replay); note("replay", g.handle(Object.assign({}, replay)));
    const forged = dreq("N1", "T1", "Room 12"); forged.token = forged.token.slice(0, -4) + "AAAA"; note("forged", g.handle(forged));
    const old = dreq("N1", "T3", "Lab"); old.token = lib.issueToken("N1", "T3", "Lab", clock.t - 600000, 300000); note("expired", g.handle(old));
    const tamper = dreq("N1", "T1", "Room 12"); tamper.destination = "Pharmacy"; note("tampered", g.handle(tamper));
    note("wrong ward", g.handle(dreq("N2", "T1", "Room 12")));
    note("extra field", g.handle(dreq("N1", "T1", "Room 12", {patient_name: lib.PATIENT_NAMES[0]})));
    note("unknown task", g.handle(dreq("N1", "T99", "Room 12")));
    note("revoked user", g.handle(dreq("N3", "T1", "Room 12")));
    const notoken = dreq("N1", "T1", "Room 12"); delete notoken.token; note("no token", g.handle(notoken));
    for (let i = 0; i < 12; i++) { clock.t += 20; note("flood " + i, g.handle({type: "deliver", user: "N1", task_id: "T1", destination: "Room 12", source: "ATK"})); }
    note("after flood legit", g.handle(dreq("N1", "T6", "Room 12")));
    note("robot msg", g.robotMessage({task_id: "T1", status: "DELIVERED", admin: true, owner: "ATK"}));
    out.push([JSON.stringify(cfg), "reset by nurse", g.reset("N1").ok]);
    out.push([JSON.stringify(cfg), "reset by supervisor", g.reset("S1").ok]);
    out.push([JSON.stringify(cfg), "audit ok", g.verifyAudit()]);
    out.push([JSON.stringify(cfg), "audit hashes", g.audit.map(e => e.hash).join(",")]);
    out.push([JSON.stringify(cfg), "tasks", JSON.stringify(w.tasks)]);
    out.push([JSON.stringify(cfg), "robot inbox", JSON.stringify(w.robot.inbox)]);
    g.audit[1].detail = "edited"; out.push([JSON.stringify(cfg), "audit after tamper", g.verifyAudit()]);
  }
  return out;
}

test("browser gate gives exactly the same answers as the Node gate", () => {
  const a = script(real), b = script(web.RWGate);
  assert.ok(a.length > 150);
  assert.deepEqual(b, a);
});
