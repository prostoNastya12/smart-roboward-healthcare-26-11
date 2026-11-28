"use strict";
// Runs the adopted pipeline over real sockets: the fleet relay and the lift adapter are HTTP servers on this machine,
// the robot is a client, and the attacker is a separate process that holds no keys and only sees what crossed the network.
// Usage: node secure-comms/network-demo.cjs [pipeline]      (default: the adopted pipeline from results.json)
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawn} = require("node:child_process");
const SC = require("./comms.js");

async function main(id) {
  const w = await SC.makeWorld(id), inProcess = w.net.rpc.bind(w.net);
  const wireFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "roboward-wire-")), "wire.jsonl");
  const urls = {}, servers = [];
  // One HTTP server per node. Each request body is one frame. What arrives is appended to the wire file, as a network tap would record it.
  for (const node of ["fleet", "adapter"]) {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
      req.on("end", async () => {
        const origin = String(req.headers["x-origin"] || "unknown");
        let reply = null;
        try { reply = await inProcess(node === "fleet" ? "wifi" : "backbone", origin, node, body, {}); } catch { reply = null; }
        fs.appendFileSync(wireFile, JSON.stringify({to: node, origin, frame: body, reply}) + "\n");
        if (typeof reply !== "string") { res.writeHead(204); res.end(); return; }
        res.writeHead(200, {"content-type": "application/json"}); res.end(reply);
      });
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    urls[node] = "http://127.0.0.1:" + server.address().port + "/";
    servers.push(server);
  }
  // From here on every frame between robot, relay and adapter crosses a real socket.
  w.net.rpc = async (hop, origin, to, frame) => {
    const res = await fetch(urls[to], {method: "POST", headers: {"x-origin": origin}, body: frame});
    return res.status === 200 ? res.text() : null;
  };
  const deliver = async trip => {
    await w.dispatch(trip, "RX-01", "L2");
    w.tick(5); w.arrive("RX-01");
    const mission = await w.pipe.acceptMission(w.nodes["RX-01"], await w.pipe.mission(trip));
    const r = await w.pipe.call(w.nodes["RX-01"], SC.claimsFor("RX-01", trip));
    return {mission: mission.accepted, decision: r.decision, reason: r.reason};
  };
  const say = (label, value) => console.log(label.padEnd(46), value);
  console.log("Pipeline " + id + " · " + SC.PIPELINES[id].name + " over HTTP on this machine\n");
  say("Fleet relay listening at", urls.fleet);
  say("Lift adapter listening at", urls.adapter);
  const first = await deliver("TRIP-WB");
  say("Genuine delivery 1: mission accepted", first.mission);
  say("Genuine delivery 1: lift adapter answered", first.decision + " · " + first.reason);
  say("Lift calls so far", w.lift.calls.length);
  const before = w.lift.calls.length;

  console.log("\n--- attacker process (no keys, sees only the network) ---");
  // Not spawnSync: this process must keep serving while the attacker runs.
  const attack = await new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, "network-attacker.cjs"), urls.fleet, urls.adapter, wireFile], {stdio: ["ignore", "inherit", "inherit"]});
    const timer = setTimeout(() => child.kill(), 120000);
    child.on("exit", status => { clearTimeout(timer); resolve({status}); });
  });
  console.log("--- attacker finished ---\n");

  w.tick(90);
  const second = await deliver("TRIP-2");
  const extra = w.lift.calls.length - before - (second.decision === "allow" ? 1 : 0);
  say("Lift calls caused by the attacker", extra);
  say("Genuine delivery 2 after the attack", second.decision + " · " + second.reason);
  const logOk = await w.pipe.verifyAudit();
  say("Audit log entries / verifies", w.pipe.log.length + " / " + logOk);
  for (const server of servers) server.close();
  const ok = first.decision === "allow" && second.decision === "allow" && extra === 0 && logOk === true && attack.status === 0;
  console.log("\n" + (ok ? "RESULT: the attacker caused no lift call and normal service continued." : "RESULT: something got through or service broke. See above."));
  return ok;
}
if (require.main === module) {
  const adopted = JSON.parse(fs.readFileSync(path.join(__dirname, "results.json"), "utf8")).decision.adopted;
  main(process.argv[2] || adopted).then(ok => process.exit(ok ? 0 : 1), error => { console.error(error); process.exit(2); });
}
module.exports = {main};
