"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const SC = require("./comms.js");
const {tools, makeWorld, claimsFor} = SC;

test("canonical form is independent of key order", () => {
  assert.equal(tools.canon({b: 1, a: [2, {d: 3, c: 4}]}), tools.canon({a: [2, {c: 4, d: 3}], b: 1}));
});

test("a signature fails for a changed message or another key", async () => {
  const a = await tools.signingKey(), b = await tools.signingKey(), sig = await tools.sign(a.priv, "floor L2");
  assert.equal(await tools.verify(a.pub, sig, "floor L2"), true);
  assert.equal(await tools.verify(a.pub, sig, "floor L1"), false);
  assert.equal(await tools.verify(b.pub, sig, "floor L2"), false);
});

test("both ends derive the same session keys and a record opens only in its own slot", async () => {
  const c = await tools.exchangeKey(), s = await tools.exchangeKey();
  const kc = await tools.sessionKeys(c.priv, s.pub, "transcript"), ks = await tools.sessionKeys(s.priv, c.pub, "transcript");
  const sealed = await tools.seal(kc.c2s, 0, "sid|c2s", "call");
  assert.equal(await tools.unseal(ks.c2s, 0, "sid|c2s", sealed), "call");
  assert.equal(await tools.unseal(ks.c2s, 1, "sid|c2s", sealed), null);           // wrong counter
  assert.equal(await tools.unseal(ks.c2s, 0, "other|c2s", sealed), null);         // wrong session
  assert.equal(await tools.unseal(ks.s2c, 0, "sid|c2s", sealed), null);           // wrong direction
  const other = await tools.sessionKeys(s.priv, c.pub, "another transcript");
  assert.equal(await tools.unseal(other.c2s, 0, "sid|c2s", sealed), null);        // keys are bound to the handshake
});

test("a certificate is refused when forged, revoked, expired or of the wrong role", async () => {
  const w = await makeWorld("D"), cert = w.nodes["RX-01"].cert;
  assert.equal(await tools.certProblem(w, cert, "agv"), null);
  assert.match(await tools.certProblem(w, cert, "adapter"), /wrong role/);
  assert.match(await tools.certProblem(w, {body: {...cert.body, role: "adapter"}, sig: cert.sig}, "adapter"), /not issued/);
  w.crl.add(cert.body.serial);
  assert.match(await tools.certProblem(w, cert, "agv"), /revoked/);
  w.crl.clear(); w.now = cert.body.notAfter + 1;
  assert.match(await tools.certProblem(w, cert, "agv"), /expired/);
});

test("every pipeline completes a routine call with exactly one lift call for L2", async () => {
  for (const id of Object.keys(SC.PIPELINES)) {
    const w = await makeWorld(id);
    await w.dispatch("TRIP-WB", "RX-01", "L2");
    w.arrive("RX-01");
    const r = await w.pipe.call(w.nodes["RX-01"], claimsFor("RX-01", "TRIP-WB"));
    assert.equal(r.decision, "allow", id);
    assert.deepEqual(w.lift.calls.map(c => c.floor), ["L2"], id);
  }
});

test("the layered pipeline gives the intended reason for each refusal", async () => {
  const run = async (prepare, floor = "Upper", edit = c => c) => {
    const w = await makeWorld("G");
    await w.dispatch("TRIP-WB", "RX-01", "L2");
    w.arrive("RX-01");
    await prepare(w);
    const r = await w.pipe.call(w.nodes["RX-01"], edit(claimsFor("RX-01", "TRIP-WB", floor)));
    return [r.decision, r.reason, w.lift.calls.length];
  };
  assert.deepEqual(await run(() => {}, "Ground"), ["deny", "Requested destination is outside this trip", 0]);
  assert.deepEqual(await run(w => { w.site.priority = true; }), ["hold", "Facilities has priority for a patient transfer", 0]);
  assert.deepEqual(await run(w => { w.feedBlocked = true; w.tick(60); w.arrive("RX-01"); }), ["hold", "Lift status is stale", 0]);
  assert.deepEqual(await run(w => { w.presence = {}; }), ["hold", "Robot was not observed at the lift", 0]);
  assert.deepEqual(await run(() => {}, "Upper", c => ({...c, mapRevision: "map-8"})), ["hold", "Facilities must verify the landing mapping", 0]);
  assert.deepEqual(await run(w => { w.pipe.revokedCaps.add(w.nodes["RX-01"].x.caps["TRIP-WB"].body.capId); }), ["deny", "capability was withdrawn", 0]);
  assert.deepEqual(await run(w => { w.tick(700); w.arrive("RX-01"); }), ["deny", "capability is outside its time window", 0]);
});

test("the breaker isolates a flooding robot for a limited time and never counts a late message", async () => {
  const w = await makeWorld("G"), sup = w.nodes["SUP-03"];
  for (let i = 0; i < 8; i++) await w.pipe.call(sup, claimsFor("SUP-03", "JUNK-" + i), {noRetry: true});
  assert.equal(w.pipe.isolated("SUP-03"), true);
  assert.equal(w.pipe.isolated("RX-01"), false);
  w.tick(SC.LIMITS.isolationSeconds + 1);
  assert.equal(w.pipe.isolated("SUP-03"), false);
  assert.equal(await w.pipe.verifyAudit(), true);
  assert.ok(w.pipe.log.some(e => e.event === "breaker"));
});

test("a revoked fleet manager loses its open connection to the adapter", async () => {
  const w = await makeWorld("G");
  await w.dispatch("TRIP-WB", "RX-01", "L2"); await w.dispatch("TRIP-2", "RX-01", "L2");
  w.arrive("RX-01");
  assert.equal((await w.pipe.call(w.nodes["RX-01"], claimsFor("RX-01", "TRIP-WB"))).decision, "allow");
  w.revoke("fleet");
  const r = await w.pipe.call(w.nodes["RX-01"], claimsFor("RX-01", "TRIP-2"));
  assert.notEqual(r.decision, "allow");
  assert.equal(w.lift.calls.length, 1);
});

test("a call with a non-numeric time or an unexpected envelope field is refused", async () => {
  for (const id of ["D", "F"]) {
    const w = await makeWorld(id), rx = w.nodes["RX-01"];
    await w.dispatch("TRIP-WB", "RX-01", "L2");
    const good = JSON.parse(await w.pipe.frame(rx, claimsFor("RX-01", "TRIP-WB")));
    for (const edit of [f => { f.env.hdr.ts = "never"; }, f => { f.env.extra = "x"; }, f => { f.env.hdr.note = "x"; }]) {
      const f = structuredClone(good); edit(f);
      f.sig = await tools.sign(rx.key.priv, tools.canon(f.env));
      await w.net.rpc("backbone", "fleet", "adapter", JSON.stringify(f));
    }
    assert.equal(w.lift.calls.length, 0, id);
  }
});

test("the log survives an adapter key change, and a history rebuilt with the adapter's own key is caught by the witness", async () => {
  const w = await makeWorld("I");
  const deliver = async trip => { await w.dispatch(trip, "RX-01", "L2"); w.tick(3); w.arrive("RX-01"); return w.pipe.call(w.nodes["RX-01"], claimsFor("RX-01", trip)); };
  await deliver("TRIP-1");
  await w.pipe.call(w.nodes["RX-01"], claimsFor("RX-01", "TRIP-NONE"));
  await w.rotate("adapter");
  assert.equal((await deliver("TRIP-2")).decision, "allow");
  assert.equal(await w.pipe.verifyAudit(), true);
  // An attacker holding the adapter's key drops the refusal and re-signs everything after it.
  const kept = w.pipe.chain.filter(e => e.event !== "deny"), me = w.nodes.adapter;
  let prev = "genesis";
  for (const [i, e] of kept.entries()) {
    e.seq = i; e.prev = prev; e.key = me.key.pub;
    e.hash = prev = await tools.sha256hex(e.prev + JSON.stringify([e.seq, e.ts, e.event, e.detail]));
    e.sig = await tools.sign(me.key.priv, e.hash);
    w.witness.accept(e);                                                   // the witness refuses: it already holds a different history
  }
  w.pipe.chain.splice(0, w.pipe.chain.length, ...kept);
  assert.equal(await w.pipe.verifyAudit(), false);
});

test("a sealed mission opens once, only for its robot, and only in order", async () => {
  const w = await makeWorld("I"), rx = w.nodes["RX-01"], sup = w.nodes["SUP-03"];
  await w.dispatch("TRIP-1", "RX-01", "L2"); await w.dispatch("TRIP-2", "RX-01", "L2");
  const first = await w.pipe.mission("TRIP-1"), second = await w.pipe.mission("TRIP-2");
  assert.ok(!JSON.stringify(first).includes("WARD-B") && !JSON.stringify(first).includes("TRIP-1"));
  assert.equal((await w.pipe.acceptMission(sup, first)).accepted, false);
  assert.equal((await w.pipe.acceptMission(rx, second)).accepted, true);
  assert.match((await w.pipe.acceptMission(rx, second)).reason, /already opened/);
  assert.match((await w.pipe.acceptMission(rx, first)).reason, /older than the last one/);
});

test("in the zero-trust relay, answers have one size and the relay's labels cannot isolate a robot", async () => {
  const w = await makeWorld("I"), rx = w.nodes["RX-01"], upstream = w.pipe.upstream.bind(w.pipe), sizes = new Set();
  w.pipe.upstream = async text => { const out = await upstream(text.replace('{"tunnel"', '{"onBehalfOf":"LAB-02","tunnel"')); if (out && out.includes('\\"t\\":\\"rec')) sizes.add(out.length); return out; };
  await w.dispatch("TRIP-1", "RX-01", "L2"); w.arrive("RX-01");
  assert.equal((await w.pipe.call(rx, claimsFor("RX-01", "TRIP-1"))).decision, "allow");
  for (let i = 0; i < 5; i++) { w.tick(1); assert.equal((await w.pipe.call(rx, claimsFor("RX-01", "TRIP-NONE" + i))).decision, "deny"); }
  assert.equal(w.pipe.adapterIsolated("RX-01"), true);                       // five refusals of its own doing do isolate it
  assert.equal((await w.pipe.call(rx, claimsFor("RX-01", "TRIP-NONE9"))).decision, null);
  assert.equal(w.pipe.adapterIsolated("LAB-02"), false);
  assert.ok(sizes.size <= 1, [...sizes].join(","));
});

test("a signed answer is refused when it is old or belongs to another request", async () => {
  const w = await makeWorld("F");
  const reply = await tools.signedReply(w.nodes.adapter, w, "req-1", "allow", "ok");
  assert.equal((await tools.readSignedReply(w, reply, "req-1")).decision, "allow");
  assert.equal((await tools.readSignedReply(w, reply, "req-2")).decision, null);
  w.tick(31);
  assert.equal((await tools.readSignedReply(w, reply, "req-1")).decision, null);
});

test("the layered pipeline's log verifies, and fails after an edit or a cut", async () => {
  const w = await makeWorld("G");
  await w.dispatch("TRIP-WB", "RX-01", "L2");
  w.arrive("RX-01");
  await w.pipe.call(w.nodes["RX-01"], claimsFor("RX-01", "TRIP-WB"));
  await w.pipe.call(w.nodes["RX-01"], claimsFor("RX-01", "TRIP-NONE"));
  assert.ok(w.pipe.log.length >= 2);
  assert.equal(await w.pipe.verifyAudit(), true);
  assert.ok(!JSON.stringify(w.pipe.log).includes(SC.MARKER));
  const kept = w.pipe.log[0].detail;
  w.pipe.log[0].detail = {edited: true};
  assert.equal(await w.pipe.verifyAudit(), false);
  w.pipe.log[0].detail = kept;
  assert.equal(await w.pipe.verifyAudit(), true);
  w.pipe.log.pop();
  assert.equal(await w.pipe.verifyAudit(), false);
});
