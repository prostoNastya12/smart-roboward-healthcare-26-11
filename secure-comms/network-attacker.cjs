"use strict";
// The attacker in the network demo. A separate process: it has the two addresses and a recording of what crossed the network. No keys.
// It knows the protocol (the code is public) and brings its own home-made keys and certificate.
// Usage: node secure-comms/network-attacker.cjs <fleet url> <adapter url> <wire file>
const fs = require("node:fs");
const {tools} = require("./comms.js");
const [fleet, adapter, wireFile] = process.argv.slice(2);
const say = (label, value) => console.log(label.padEnd(46), value);
const post = async (url, frame, origin = "fleet") => {
  try { const res = await fetch(url, {method: "POST", headers: {"x-origin": origin}, body: frame}); return res.status === 200 ? await res.text() : "(no answer)"; }
  catch { return "(connection failed)"; }
};
const brief = text => { const f = tools.parse(text); return f ? (f.t === "err" ? "refused: " + f.why : f.decision ? "decision " + f.decision : f.t ?? "answered") : String(text).slice(0, 40); };
const tally = answers => Object.entries(answers.reduce((n, a) => { n[a] = (n[a] || 0) + 1; return n; }, {})).map(([a, n]) => n + "× " + a).join(", ");

(async () => {
  const recorded = fs.readFileSync(wireFile, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const everything = recorded.map(r => r.frame + (r.reply || "")).join("\n");
  const found = [["TRIP-WB", "trip"], ['"Upper"', "floor"], ["MED-ORDER", "medication order"], ["ZETA-PRIVATE", "patient marker"]].filter(([needle]) => everything.includes(needle)).map(([, label]) => label);
  say("1 Read the recording (" + recorded.length + " frames)", found.length ? "learned: " + found.join(", ") : "nothing readable beyond which robot spoke");

  const call = {type: "LIFT_CALL", robot: "RX-01", trip: "TRIP-WB", lift: "Lift 1", rawFloor: "Upper", mapRevision: "map-7", requestId: "req-attacker"};
  say("2 Plain forged lift call", tally([brief(await post(fleet, JSON.stringify({v: "A", claims: call}), "RX-01")), brief(await post(adapter, JSON.stringify({v: "A", claims: call})))]));

  // Home-made certificate authority and certificate in RX-01's name, then a proper handshake attempt.
  const ca = {key: await tools.signingKey(), next: 1}, key = await tools.signingKey(), eph = await tools.exchangeKey();
  const hello = {v: "I", t: "hello", eph: eph.pub, cert: await tools.issueCert(ca, "RX-01", "agv", key.pub, 1e9), nonce: tools.random()};
  const asFleet = {...hello, cert: await tools.issueCert(ca, "fleet", "fleet", key.pub, 1e9)};
  say("3 Handshake with a home-made certificate", tally([brief(await post(fleet, JSON.stringify(hello), "RX-01")), brief(await post(adapter, JSON.stringify(asFleet)))]));

  const replays = [];
  for (const r of recorded) replays.push(brief(await post(r.to === "fleet" ? fleet : adapter, r.frame, r.origin)));
  say("4 Replay all " + recorded.length + " recorded frames", tally(replays));

  const flipped = [];
  for (const r of recorded) {
    const f = tools.parse(r.frame);
    if (!f || f.t !== "rec") continue;
    f.ct = f.ct.slice(0, -2) + (f.ct.at(-2) === "A" ? "B" : "A") + f.ct.at(-1);
    flipped.push(brief(await post(r.to === "fleet" ? fleet : adapter, JSON.stringify(f), r.origin)));
  }
  say("5 Recorded frames with one bit changed", tally(flipped));

  const junk = [];
  for (let i = 0; i < 300; i++) junk.push(brief(await post(i % 2 ? fleet : adapter, JSON.stringify({t: "rec", sid: "x" + i, n: 0, ct: "AAAA"}), "RX-01")));
  say("6 300 junk frames", tally(junk));
})().catch(error => { console.error(error); process.exit(1); });
