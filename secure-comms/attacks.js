// Attack suite and legitimate workload for the secure communication pipelines. See IMPLEMENTATION-PLAN.md, section 5.
// Every attack decides its result from effects only: what the lift received, what the attacker could read, what the robot believed.
// Attack code uses the same client code as a real device, with stolen, forged or missing key material.
(function (root, create) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = create(require("./comms.js"));
  else root.SecureAttacks = create(root.SecureComms);
})(globalThis, function (SC) {
  "use strict";
  const {makeWorld, claimsFor, MARKER, tools} = SC;
  const {parse, canon, random, signingKey, sign, issueCert, sha256hex, signedReply, transcriptOf, exchangeKey} = tools;
  const TRIP = "TRIP-WB";
  const calls = w => w.lift.calls.length;
  const wire = w => w.net.captured.map(f => f.frame).join("\n");

  // The page sets an observer to show the frames of the last run. It has no effect on results.
  let observer = null;
  const observe = fn => { observer = fn; };
  const world = async id => { const w = await makeWorld(id); if (observer) observer(w); return w; };
  async function fresh(id) {
    const w = await world(id);
    await w.dispatch(TRIP, "RX-01", "L2");
    w.arrive("RX-01");
    return w;
  }
  const rx = w => w.nodes["RX-01"];
  const legit = (w, o) => w.pipe.call(rx(w), claimsFor("RX-01", TRIP), o);

  // An outsider brings their own certificate authority, keys, a home-made capability and a home-made ticket.
  async function outsider(w, name, pretend) {
    const ca = {key: await signingKey(), next: 900}, key = await signingKey(), boss = await signingKey();
    const mat = {id: name, role: "agv", key, cert: await issueCert(ca, pretend, "agv", key.pub, 1e9), x: {seq: 50, tickets: {}, caps: {}, sent: {}}};
    const body = {capId: "cap-forged", trip: TRIP, robot: pretend, robotKey: key.pub, lift: "Lift 1", origin: "L1", floor: "L2", nbf: w.now - 1, exp: w.now + 600};
    mat.x.caps[TRIP] = {body, sig: await sign(boss.priv, canon(body)), cert: await issueCert(ca, "dispatcher", "dispatcher", boss.pub, 1e9)};
    const ticket = tools.b64(new TextEncoder().encode(JSON.stringify({u: pretend, t: TRIP, d: "L2", exp: w.now * 1000 + 300000, n: "forged"})));
    mat.x.tickets[TRIP] = ticket + "." + random(32);
    return mat;
  }
  // Walk a parsed frame and apply `edit` to every object. Returns true when something changed.
  function walk(value, edit) {
    let changed = false;
    if (value && typeof value === "object") {
      if (edit(value)) changed = true;
      for (const child of Object.values(value)) if (walk(child, edit)) changed = true;
    }
    return changed;
  }
  const flip = text => text.slice(0, -2) + (text.at(-2) === "A" ? "B" : "A") + text.at(-1);
  // Change a frame in transit: edit the readable field if there is one, otherwise damage the ciphertext.
  function alter(frame, edit) {
    const f = parse(frame);
    if (!f) return undefined;
    if (walk(f, edit)) return JSON.stringify(f);
    if (f.t === "rec" && typeof f.ct === "string") { f.ct = flip(f.ct); return JSON.stringify(f); }
    return undefined;
  }
  const stolenFrom = w => {
    const bag = {};
    for (const item of w.net.captured) walk(parse(item.frame), o => {
      if (typeof o.token === "string") bag.token = o.token;
      if (o.cap && o.cap.body) bag.cap = o.cap;
      if (o.cert && o.cert.body && o.cert.body.id === "RX-01") bag.cert = o.cert;
      return false;
    });
    return bag;
  };

  const ATTACKS = [
    {id: "T01", name: "Eavesdrop on a delivery", position: "PATH", wins: "Captured frames reveal the trip, the floor or a private marker",
      async run(id) {
        const w = await fresh(id);
        await legit(w);
        const text = wire(w), read = [[TRIP, "trip"], ['"Upper"', "floor"], [MARKER, "private marker"]].filter(([needle]) => text.includes(needle)).map(([, label]) => label);
        return {blocked: read.length === 0, detail: read.length ? "Read from the wire: " + read.join(", ") : "Nothing readable on the wire"};
      }},
    {id: "T02", name: "Inject a lift call from outside", position: "OUT", wins: "The lift receives a call",
      async run(id) {
        const w = await fresh(id), mat = await outsider(w, "GUEST-LAPTOP", "RX-01");
        await w.pipe.call(mat, claimsFor("RX-01", TRIP));
        await w.pipe.direct(mat, claimsFor("RX-01", TRIP));
        return {blocked: calls(w) === 0, detail: calls(w) + " lift call(s) from a device with no hospital credentials"};
      }},
    {id: "T03", name: "Replay a recorded lift call a minute later", position: "PATH", wins: "The lift receives a second call",
      async run(id) {
        const w = await fresh(id);
        await legit(w);
        const before = calls(w), recorded = w.net.captured.filter(f => f.dir === "request").map(f => ({...f}));
        w.tick(60);
        for (const f of recorded) await w.net.rpc(f.hop, f.origin, f.to, f.frame, {inside: true});
        return {blocked: calls(w) === before, detail: (calls(w) - before) + " extra lift call(s) after replaying " + recorded.length + " recorded frame(s)"};
      }},
    {id: "T04", name: "Change the floor in transit", position: "PATH", wins: "The lift is called for a floor the robot did not ask for",
      async run(id) {
        let wrong = 0;
        for (const hop of ["wifi", "backbone"]) {
          const w = await fresh(id);
          w.net.taps.push({hop, request: frame => alter(frame, o => { if (o.rawFloor === "Upper") { o.rawFloor = "Ground"; return true; } return false; })});
          await legit(w);
          wrong += w.lift.calls.filter(c => c.floor !== "L2").length;
        }
        return {blocked: wrong === 0, detail: wrong + " lift call(s) for the attacker's floor"};
      }},
    {id: "T05", name: "One robot pretends to be another", position: "DEV", wins: "The lift receives a call in RX-01's name",
      async run(id) {
        const w = await fresh(id), sup = w.nodes["SUP-03"];
        await w.pipe.call(sup, claimsFor("RX-01", TRIP));
        await w.pipe.call(sup, claimsFor("RX-01", TRIP), {claimFrom: "RX-01"});
        const n = w.lift.calls.filter(c => c.robot === "RX-01").length;
        return {blocked: n === 0, detail: n + " lift call(s) in RX-01's name from SUP-03"};
      }},
    {id: "T06", name: "A robot calls the lift with no delivery of its own", position: "DEV", wins: "The lift receives a call",
      async run(id) {
        const w = await fresh(id);
        await w.pipe.call(w.nodes["SUP-03"], claimsFor("SUP-03", TRIP));
        return {blocked: calls(w) === 0, detail: calls(w) + " lift call(s) for a robot with no trip"};
      }},
    {id: "T07", name: "Compromised fleet manager invents a lift call", position: "FLEET", wins: "The lift receives a call",
      async run(id) {
        const w = await fresh(id);
        // The fleet manager relayed RX-01's mission, so it holds whatever travelled with it.
        const stolen = {token: rx(w).x.tickets[TRIP], cap: rx(w).x.caps[TRIP], cert: rx(w).cert};
        await w.pipe.direct(w.nodes.fleet, claimsFor("RX-01", TRIP), {stolen, claimFrom: "RX-01", inside: true});
        return {blocked: calls(w) === 0, detail: calls(w) + " lift call(s) the robot never made"};
      }},
    {id: "T08", name: "Genuine robot asks for the wrong floor", position: "DEV", wins: "The lift is called for L1 on a trip to L2",
      async run(id) {
        const w = await fresh(id);
        await w.pipe.call(rx(w), claimsFor("RX-01", TRIP, "Ground"));
        const n = w.lift.calls.filter(c => c.floor === "L1").length;
        return {blocked: n === 0, detail: n + " lift call(s) for L1"};
      }},
    {id: "T09", name: "A retired robot keeps working", position: "DEV", wins: "The lift receives a call",
      async run(id) {
        const w = await fresh(id), sup = w.nodes["SUP-03"];
        w.revoke("SUP-03");
        await w.pipe.call(sup, claimsFor("SUP-03", TRIP));
        await w.pipe.call(sup, claimsFor("RX-01", TRIP), {claimFrom: "RX-01"});
        return {blocked: calls(w) === 0, detail: calls(w) + " lift call(s) from a revoked robot"};
      }},
    {id: "T10", name: "Steal a credential off the wire and use it elsewhere", position: "PATH", wins: "The lift receives a call triggered by the attacker's device",
      async run(id) {
        const w = await fresh(id);
        // Let the handshake through, hold back the robot's actual call, and keep a copy.
        w.net.taps.push({hop: "wifi", request: frame => { const f = parse(frame); return f && (f.t === "hello" || f.t === "fin") ? undefined : null; }});
        await legit(w, {noRetry: true});
        w.net.taps.length = 0;
        const stolen = stolenFrom(w);
        await w.pipe.call(w.nodes["SUP-03"], claimsFor("RX-01", TRIP), {stolen, claimFrom: "RX-01"});
        const found = Object.keys(stolen).join(", ") || "nothing";
        return {blocked: calls(w) === 0, detail: calls(w) + " lift call(s) from SUP-03. Lifted off the wire: " + found};
      }},
    {id: "T11", name: "Hold a lift call for two minutes, then release it", position: "PATH", wins: "The lift receives the stale call",
      async run(id) {
        const w = await fresh(id);
        let held = null;
        w.net.taps.push({hop: "wifi", request: frame => { const f = parse(frame); if (f && (f.t === "hello" || f.t === "fin")) return undefined; held = frame; return null; }});
        await legit(w, {noRetry: true});
        w.net.taps.length = 0;
        w.tick(120);
        w.arrive("RX-01");
        if (held) await w.net.rpc("wifi", "RX-01", "fleet", held, {inside: true});
        return {blocked: calls(w) === 0, detail: calls(w) + " lift call(s) from a message delivered 120 s late"};
      }},
    {id: "T12", name: "Forge or replay the adapter's reply", position: "PATH", wins: "The robot believes a refused call was allowed",
      async run(id) {
        let fooled = 0;
        for (const variant of ["edit", "replay"]) {
          const w = await fresh(id);
          await legit(w);
          const earlier = w.net.captured.filter(f => f.hop === "wifi" && f.dir === "reply").at(-1)?.frame;
          w.net.taps.push({hop: "wifi", response: reply => {
            if (typeof reply !== "string" || parse(reply)?.t === "ack" || parse(reply)?.t === "ok") return undefined;
            return variant === "replay" ? earlier : alter(reply, o => { if (typeof o.decision === "string" && o.decision !== "allow") { o.decision = "allow"; return true; } return false; });
          }});
          // RX-01 asks for a trip that was never dispatched. Every design refuses it; the attacker rewrites the refusal.
          const result = await w.pipe.call(rx(w), claimsFor("RX-01", "TRIP-UNKNOWN", "Upper"));
          if (result.decision === "allow") fooled++;
        }
        return {blocked: fooled === 0, detail: fooled + " of 2 forged answers accepted by the robot"};
      }},
    {id: "T13", name: "Impersonate the lift adapter", position: "PATH", wins: "The robot accepts an answer from the attacker",
      async run(id) {
        const w = await fresh(id), me = w.nodes["SUP-03"];
        // The attacker sits on the Wi-Fi hop and answers instead of the hospital, using a compromised robot's genuine credentials.
        w.net.taps.push({hop: "wifi", request: async frame => {
          const f = parse(frame);
          if (f && f.t === "hello") {
            const eph = await exchangeKey(), ack = {t: "ack", sid: random(), eph: eph.pub, cert: me.cert};
            ack.sig = await sign(me.key.priv, transcriptOf(f, ack));
            return {answer: JSON.stringify(ack)};
          }
          if (f && f.t === "fin") return {answer: JSON.stringify({t: "ok"})};
          const requestId = f?.env?.hdr?.requestId ?? f?.claims?.requestId;
          if (f && f.env) return {answer: await signedReply(me, w, requestId, "allow", "go ahead")};
          return {answer: JSON.stringify({decision: "allow", reason: "go ahead"})};
        }});
        const result = await w.pipe.call(rx(w), claimsFor("RX-01", "TRIP-UNKNOWN"));
        return {blocked: result.decision !== "allow", detail: result.decision === "allow" ? "Robot accepted the attacker's answer" : "Robot refused the answer: " + result.reason};
      }},
    {id: "T14", name: "Flood from one compromised robot", position: "DEV", wins: "Fewer than 90% of other robots' legitimate calls are served",
      async run(id) {
        const w = await world(id), seconds = 5, junkPerSecond = 100, robots = ["RX-01", "LAB-02"], perSecond = 4;
        w.capacity = 20;
        const trips = [];
        for (let i = 0; i < seconds * perSecond; i++) { trips.push({trip: "TRIP-F" + i, robot: robots[i % 2]}); await w.dispatch("TRIP-F" + i, robots[i % 2], "L2"); }
        let seed = 20261128;
        const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
        const start = w.now + 1;
        for (let s = 0; s < seconds; s++) {
          const work = Array.from({length: junkPerSecond}, () => null).concat(trips.slice(s * perSecond, (s + 1) * perSecond));
          for (let i = work.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [work[i], work[j]] = [work[j], work[i]]; }
          for (let i = 0; i < work.length; i++) {
            w.setTime(start + s + i / work.length);
            const job = work[i];
            if (job) { w.arrive(job.robot); await w.pipe.call(w.nodes[job.robot], claimsFor(job.robot, job.trip), {noRetry: true}); }
            else await w.pipe.call(w.nodes["SUP-03"], claimsFor("SUP-03", "JUNK-" + s + "-" + i), {noRetry: true});
          }
        }
        const served = new Set(w.lift.calls.filter(c => c.trip.startsWith("TRIP-F")).map(c => c.trip)).size, pct = Math.round(1000 * served / trips.length) / 10;
        return {blocked: pct >= 90, detail: served + " of " + trips.length + " legitimate calls served (" + pct + "%), adapter refused " + w.overloaded + " frames as overloaded", retainedPct: pct};
      }},
    {id: "T15", name: "Decrypt recorded traffic with keys stolen later", position: "LEAK", wins: "The recorded lift calls can be read",
      async run(id) {
        const w = await fresh(id);
        await legit(w);
        if (wire(w).includes('"Upper"')) return {blocked: false, detail: "Nothing to decrypt: the calls were recorded in clear"};
        // With every long-term key stolen, look for anything left behind that could rebuild a session key.
        const seen = new Set(), leftovers = [];
        (function scan(v) {
          if (!v || typeof v !== "object" || seen.has(v)) return;
          seen.add(v);
          if (typeof CryptoKey !== "undefined" && v instanceof CryptoKey) {
            if ((v.type === "private" && v.algorithm.name === "X25519") || (v.type === "secret" && v.extractable)) leftovers.push(v.algorithm.name);
            return;
          }
          for (const child of v instanceof Map ? v.values() : Object.values(v)) scan(child);
        })({nodes: w.nodes, pipe: {...w.pipe, w: null}});
        return {blocked: leftovers.length === 0, detail: leftovers.length ? "Session secrets left in memory: " + leftovers.join(", ")
          : "Long-term keys sign only. No key-agreement secret or exportable session key was kept"};
      }},
    {id: "T16", name: "Rewrite or cut the audit log and repair its hashes", position: "LOG", wins: "Verification still passes",
      async run(id) {
        const undetected = [];
        for (const variant of ["edit", "cut"]) {
          const w = await fresh(id);
          await legit(w);
          const log = w.pipe.log;
          if (!log.length) return {blocked: false, detail: "No audit record exists"};
          if (variant === "edit") log[0].detail = "edited by the attacker"; else log.pop();
          let prev = "genesis";
          for (const e of log) if ("hash" in e) { e.prev = prev; e.hash = prev = await sha256hex(prev + JSON.stringify([e.seq, e.ts, e.event, e.detail])); }
          if (await w.pipe.verifyAudit()) undetected.push(variant);
        }
        return {blocked: undetected.length === 0, detail: undetected.length ? "Undetected: " + undetected.join(" and ") + " of the log" : "Signatures and the witnessed head exposed both the edit and the cut"};
      }},
    {id: "T17", name: "Over-sharing", position: "NONE", wins: "A private marker reaches the lift-side log",
      async run(id) {
        const w = await fresh(id);
        await legit(w, {rawSender: true});
        const kept = JSON.stringify([w.pipe.log, w.pipe.inbox ?? [], w.lift.calls]).includes(MARKER);
        return {blocked: !kept, detail: kept ? "The private marker is stored on the lift side" : "The private marker was not stored on the lift side"};
      }},
    {id: "T18", name: "Suppress lift status updates", position: "PATH", wins: "The lift receives a call while the adapter's status is older than 10 seconds",
      async run(id) {
        const w = await fresh(id);
        w.feedBlocked = true;
        w.tick(60);
        w.arrive("RX-01");
        await legit(w);
        const stale = w.lift.calls.filter(c => c.statusAge > SC.LIMITS.statusSeconds).length;
        return {blocked: stale === 0, detail: stale + " lift call(s) forwarded on 60 s old status"};
      }},
    {id: "T19", name: "Robot calls the lift when it is not at the lift", position: "DEV", wins: "The lift receives a call",
      async run(id) {
        const w = await fresh(id);
        w.presence = {};
        await legit(w);
        return {blocked: calls(w) === 0, detail: calls(w) + " lift call(s) with no robot seen at the lift"};
      }},
    {id: "T20", name: "Compromised dispatcher issues a wrong grant", position: "DISPATCHER", wins: "The lift is called for the wrong floor", limit: true,
      async run(id) {
        const w = await fresh(id);
        await w.dispatch("TRIP-EVIL", "SUP-03", "L1");
        w.arrive("SUP-03");
        await w.pipe.call(w.nodes["SUP-03"], claimsFor("SUP-03", "TRIP-EVIL", "Ground"));
        const n = w.lift.calls.filter(c => c.trip === "TRIP-EVIL").length;
        return {blocked: n === 0, detail: n + " lift call(s) on a grant the dispatcher should not have issued"};
      }},
    {id: "T21", name: "Traffic analysis", position: "PATH", wins: "The attacker can tell when a robot called the lift", limit: true,
      async run(id) {
        const w = await fresh(id);
        w.tick(7);
        w.arrive("RX-01");
        await legit(w);
        const visible = w.net.captured.some(f => f.hop === "wifi" && f.origin === "RX-01" && f.at === w.now);
        return {blocked: !visible, detail: visible ? "Frame timing and sender show when RX-01 called" : "No frame visible"};
      }}
  ];

  const LEGIT = [
    {id: "L01", name: "Routine lift call",
      async run(id) {
        const w = await fresh(id), r = await legit(w);
        return {pass: r.decision === "allow" && calls(w) === 1 && w.lift.calls[0].floor === "L2", detail: (r.decision ?? "no answer") + ", " + calls(w) + " lift call(s)"};
      }},
    {id: "L02", name: "Reply lost, robot retries",
      async run(id) {
        const w = await fresh(id), claims = claimsFor("RX-01", TRIP);
        let dropped = false;
        w.net.taps.push({hop: "wifi", response: reply => { const t = parse(reply)?.t; if (dropped || t === "ack" || t === "ok") return undefined; dropped = true; return null; }});
        let r = await w.pipe.call(rx(w), claims);
        if (r.decision !== "allow") r = await w.pipe.call(rx(w), claims);
        return {pass: r.decision === "allow" && calls(w) === 1, detail: (r.decision ?? "no answer") + ", " + calls(w) + " lift call(s)"};
      }},
    {id: "L03", name: "Wi-Fi handover mid-trip",
      async run(id) {
        const w = await fresh(id);
        await legit(w);
        w.handover("RX-01");
        w.tick(20);
        await w.dispatch("TRIP-2", "RX-01", "L2");
        w.arrive("RX-01");
        const r = await w.pipe.call(rx(w), claimsFor("RX-01", "TRIP-2"));
        return {pass: r.decision === "allow" && calls(w) === 2, detail: (r.decision ?? "no answer") + " after reconnect, " + calls(w) + " lift call(s)"};
      }},
    {id: "L04", name: "Two robots, two trips",
      async run(id) {
        const w = await fresh(id);
        await w.dispatch("TRIP-LAB", "LAB-02", "L2");
        w.arrive("LAB-02");
        const a = await legit(w), b = await w.pipe.call(w.nodes["LAB-02"], claimsFor("LAB-02", "TRIP-LAB"));
        return {pass: a.decision === "allow" && b.decision === "allow" && calls(w) === 2, detail: [a.decision, b.decision].join(" and ") + ", " + calls(w) + " lift call(s)"};
      }},
    {id: "L05", name: "Key rotation",
      async run(id) {
        const w = await fresh(id);
        await legit(w);
        await w.rotate("RX-01");
        w.tick(20);
        await w.dispatch("TRIP-3", "RX-01", "L2");
        w.arrive("RX-01");
        const r = await w.pipe.call(rx(w), claimsFor("RX-01", "TRIP-3"));
        return {pass: r.decision === "allow" && calls(w) === 2, detail: (r.decision ?? "no answer") + " with the new key, " + calls(w) + " lift call(s)"};
      }}
  ];

  // Bytes on the wire and processing time for a routine call.
  async function cost(id, runs = 200) {
    const w = await makeWorld(id), bytes = () => w.net.captured.reduce((n, f) => n + f.frame.length, 0);
    for (let i = 0; i <= runs; i++) await w.dispatch("TRIP-C" + i, "RX-01", "L2");
    w.arrive("RX-01");
    await w.pipe.call(rx(w), claimsFor("RX-01", "TRIP-C0"));
    const first = bytes();
    const next = i => { w.tick(1); w.arrive("RX-01"); return w.pipe.call(rx(w), claimsFor("RX-01", "TRIP-C" + i)); };
    await next(1);
    const steady = bytes() - first, started = performance.now();
    for (let i = 2; i <= runs; i++) await next(i);
    const ms = (performance.now() - started) / (runs - 1);
    return {bytesPerCall: steady, setupBytes: first - steady, msPerCall: Math.round(ms * 100) / 100, calls: calls(w)};
  }

  async function runPipeline(id, o = {}) {
    const attacks = {}, legit = {};
    for (const a of ATTACKS) attacks[a.id] = await a.run(id);
    for (const l of LEGIT) legit[l.id] = await l.run(id);
    const core = ATTACKS.filter(a => !a.limit);
    return {attacks, legit, cost: o.skipCost ? null : await cost(id, o.costRuns),
      summary: {blocked: core.filter(a => attacks[a.id].blocked).length, of: core.length,
        limitsBlocked: ATTACKS.filter(a => a.limit && attacks[a.id].blocked).length, limits: ATTACKS.length - core.length,
        legitPassed: LEGIT.filter(l => legit[l.id].pass).length, legitOf: LEGIT.length}};
  }
  // Selection rule from IMPLEMENTATION-PLAN.md section 6, fixed before the first run.
  function choose(results, vendorNeeds) {
    const eligible = Object.keys(results).filter(id => results[id].summary.legitPassed === results[id].summary.legitOf);
    eligible.sort((a, b) => results[b].summary.blocked - results[a].summary.blocked || vendorNeeds[a] - vendorNeeds[b] ||
      (results[a].cost?.bytesPerCall ?? 0) - (results[b].cost?.bytesPerCall ?? 0));
    return {eligible, winner: eligible[0] ?? null};
  }

  return {ATTACKS, LEGIT, runPipeline, cost, choose, fresh, observe};
});
