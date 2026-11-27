// Smart RoboWard secure communication pipelines. Written on site, standard library only (Web Crypto).
// Seven ways for a robot to ask a hospital lift for a floor, from an open network (A) to a layered design (G).
// The same file runs in Node and in the browser. All devices, trips and keys are fictional and generated at run time.
// Pipeline C runs the teammate's gate (gate/gate.cjs). Pipeline G runs our lift admission (ward-safety/controller.js).
(function (root, create) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = create({gate: require("../gate/gate.cjs"), evaluate: require("../ward-safety/controller.js").evaluate});
  } else root.SecureComms = create({gate: typeof RWGate === "undefined" ? root.RWGate : RWGate, evaluate: root.WardSafety.evaluate});
})(globalThis, function (deps) {
  "use strict";
  const subtle = globalThis.crypto.subtle;
  const te = new TextEncoder(), td = new TextDecoder();
  const MAP = Object.freeze({Upper: "L2", Ground: "L1"});                 // fleet floor names to hospital landings
  const SCHEMA = Object.freeze(["type", "robot", "trip", "lift", "rawFloor", "mapRevision", "requestId"]);
  const LIFT_LABEL = Object.freeze({L2: "01", L1: "G"});                    // the lift's own names for the same landings
  const MARKER = "ZETA-PRIVATE-7731";                                      // fictional private marker a careless sender attaches
  const LIMITS = Object.freeze({freshSeconds: 30, statusSeconds: 10, presenceSeconds: 10, ratePerSecond: 5, denialsToTrip: 5,
    denialWindowSeconds: 10, isolationSeconds: 60});

  // ---- primitives ---------------------------------------------------------
  const b64 = bytes => btoa(Array.from(bytes, b => String.fromCharCode(b)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64 = text => Uint8Array.from(atob(String(text).replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  // Canonical JSON: object keys sorted, so a signature covers one exact byte string.
  function canon(value) {
    if (Array.isArray(value)) return "[" + value.map(canon).join(",") + "]";
    if (value && typeof value === "object") {
      return "{" + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ":" + canon(value[k])).join(",") + "}";
    }
    return JSON.stringify(value === undefined ? null : value);
  }
  const parse = text => { try { const v = JSON.parse(text); return v && typeof v === "object" ? v : null; } catch { return null; } };
  const random = (n = 12) => b64(globalThis.crypto.getRandomValues(new Uint8Array(n)));
  const sha256hex = async text => hex(new Uint8Array(await subtle.digest("SHA-256", te.encode(text))));

  async function signingKey() {
    const pair = await subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    return {priv: pair.privateKey, pub: b64(new Uint8Array(await subtle.exportKey("raw", pair.publicKey)))};
  }
  const sign = async (priv, text) => b64(new Uint8Array(await subtle.sign("Ed25519", priv, te.encode(text))));
  async function verify(pub, sig, text) {
    try {
      const key = await subtle.importKey("raw", unb64(pub), "Ed25519", false, ["verify"]);
      return await subtle.verify("Ed25519", key, unb64(sig), te.encode(text));
    } catch { return false; }
  }
  async function exchangeKey() {
    const pair = await subtle.generateKey("X25519", false, ["deriveBits"]);   // private half is not extractable
    return {priv: pair.privateKey, pub: b64(new Uint8Array(await subtle.exportKey("raw", pair.publicKey)))};
  }
  // Fresh keys for one session, one per direction, bound to everything both sides said during the handshake.
  async function sessionKeys(priv, peerPub, transcript) {
    const peer = await subtle.importKey("raw", unb64(peerPub), "X25519", false, []);
    const secret = await subtle.deriveBits({name: "X25519", public: peer}, priv, 256);
    const base = await subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
    const salt = await subtle.digest("SHA-256", te.encode(transcript));
    const derive = info => subtle.deriveKey({name: "HKDF", hash: "SHA-256", salt, info: te.encode(info)}, base,
      {name: "AES-GCM", length: 256}, false, ["encrypt", "decrypt"]);
    return {c2s: await derive("client to server"), s2c: await derive("server to client")};
  }
  const nonce = n => { const iv = new Uint8Array(12); new DataView(iv.buffer).setUint32(8, n); return iv; };
  const seal = async (key, n, aad, text) =>
    b64(new Uint8Array(await subtle.encrypt({name: "AES-GCM", iv: nonce(n), additionalData: te.encode(aad)}, key, te.encode(text))));
  async function unseal(key, n, aad, sealed) {
    try { return td.decode(await subtle.decrypt({name: "AES-GCM", iv: nonce(n), additionalData: te.encode(aad)}, key, unb64(sealed))); }
    catch { return null; }
  }

  // ---- certificates -------------------------------------------------------
  async function issueCert(ca, id, role, pub, notAfter) {
    const body = {id, role, pub, serial: ca.next++, notAfter};
    return {body, sig: await sign(ca.key.priv, canon(body))};
  }
  // Returns null when the certificate is good, otherwise the reason it was refused.
  async function certProblem(world, cert, role) {
    if (!cert || !cert.body || typeof cert.sig !== "string") return "missing certificate";
    if (!await verify(world.caPub, cert.sig, canon(cert.body))) return "certificate not issued by the hospital";
    if (world.now > cert.body.notAfter) return "certificate expired";
    if (world.crl.has(cert.body.serial)) return "certificate revoked";
    if (role && cert.body.role !== role) return "certificate has the wrong role";
    return null;
  }

  // ---- network ------------------------------------------------------------
  // Frames are strings. A tap is an attacker on one hop: it can read, change, drop, hold or answer a frame.
  class Net {
    constructor(world) { this.w = world; this.taps = []; this.captured = []; this.handlers = {}; }
    async rpc(hop, origin, to, frame, opts = {}) {
      const w = this.w;
      if (w.admission && !opts.inside && !w.admitted.has(origin)) return null;       // B: the network drops unknown devices
      this.captured.push({hop, dir: "request", origin, to, frame, at: w.now});
      for (const tap of this.taps) {
        if (tap.hop !== hop || !tap.request) continue;
        const r = await tap.request(frame, {hop, origin, to});
        if (r === null) return null;
        if (r && typeof r === "object") return r.answer;
        if (typeof r === "string") frame = r;
      }
      let reply = await this.handlers[to](frame, {hop, origin});
      for (const tap of this.taps) {
        if (tap.hop !== hop || !tap.response) continue;
        const r = await tap.response(reply, {hop, origin, to});
        if (r === null) return null;
        if (typeof r === "string") reply = r;
      }
      if (typeof reply === "string") this.captured.push({hop, dir: "reply", origin: to, to: origin, frame: reply, at: w.now});
      return reply;
    }
  }

  // ---- world --------------------------------------------------------------
  async function makeWorld(id, options = {}) {
    if (!PIPELINES[id]) throw Error("Unknown pipeline " + id);
    const w = {id, tripTable: !!options.tripTable, now: 1000, ca: {key: await signingKey(), next: 1}, crl: new Set(), revokedKeys: new Set(), nodes: {}, trips: new Map(),
      lift: {calls: []}, site: {approvedRevision: "map-7", destinationLabel: "01", priority: false, seenAt: 1000, landing: "L1"},
      presence: {}, admitted: new Set(), admission: false, feedBlocked: false, capacity: Infinity, bucket: {second: -1, used: 0}, overloaded: 0};
    w.caPub = w.ca.key.pub;
    w.enroll = async (node, role) => {
      const key = await signingKey();
      w.nodes[node] = {id: node, role, key, cert: await issueCert(w.ca, node, role, key.pub, 1e9), x: {seq: 0, tickets: {}, caps: {}}};
      w.admitted.add(node);
      return w.nodes[node];
    };
    for (const [node, role] of [["dispatcher", "dispatcher"], ["fleet", "fleet"], ["adapter", "adapter"], ["RX-01", "agv"], ["LAB-02", "agv"], ["SUP-03", "agv"], ["orders", "orders"]]) {
      await w.enroll(node, role);
    }
    w.net = new Net(w);
    w.pipe = new PIPELINES[id].make(w);
    // Time only moves when a test says so. The facilities feed refreshes the lift status unless an attacker blocks it.
    w.setTime = t => { w.now = t; if (!w.feedBlocked) w.site.seenAt = t; };
    w.tick = seconds => w.setTime(w.now + seconds);
    w.arrive = robot => { w.presence[robot] = w.now; };                   // independent lobby sensor sees the robot
    w.forward = (claims, by) => w.lift.calls.push({robot: claims.robot, trip: claims.trip, floor: MAP[claims.rawFloor], rawFloor: claims.rawFloor,
      at: w.now, statusAge: w.site.seenAt === null ? Infinity : w.now - w.site.seenAt, by});
    // A delivery normally starts as a clinical order, which the dispatcher turns into a trip.
    // `rogue` models a compromised dispatcher that creates a trip with no clinical order behind it.
    w.orders = new Map();
    w.dispatch = async (trip, robot, floor = "L2", o = {}) => {
      if (!o.rogue) w.orders.set(trip, {robot, floor});
      w.trips.set(trip, {trip, robot, lift: "Lift 1", origin: "L1", floor});
      await w.pipe.onDispatch(w.trips.get(trip));
    };
    w.revoke = node => {
      const n = w.nodes[node];
      w.crl.add(n.cert.body.serial); w.revokedKeys.add(n.key.pub); w.admitted.delete(node);
      w.pipe.dropPeer(node);
    };
    w.handover = robot => { w.pipe.dropPeer(robot); };                     // the Wi-Fi link was lost and re-established
    w.rotate = async robot => {
      const old = w.nodes[robot], x = old.x;
      w.crl.add(old.cert.body.serial); w.revokedKeys.add(old.key.pub);
      const fresh = await w.enroll(robot, old.role);
      fresh.x = {...x, link: null, tickets: {}, caps: {}, orders: {}};
      w.pipe.dropPeer(robot);
    };
    w.net.handlers.fleet = (frame, meta) => w.pipe.fleet(frame, meta);
    w.net.handlers.adapter = (frame, meta) => {
      const second = Math.floor(w.now);                                    // modelled capacity of the lift adapter
      if (w.bucket.second !== second) w.bucket = {second, used: 0};
      if (++w.bucket.used > w.capacity) { w.overloaded++; return JSON.stringify({overloaded: true}); }
      return w.pipe.adapter(frame, meta);
    };
    await w.pipe.init();
    return w;
  }
  const claimsFor = (robot, trip, rawFloor = "Upper", requestId = "req-" + random(6)) =>
    ({type: "LIFT_CALL", robot, trip, lift: "Lift 1", rawFloor, mapRevision: "map-7", requestId, note: "MED-ORDER 4471 " + MARKER});
  const answer = (decision, reason) => ({decision, reason});
  const noAnswer = reason => ({decision: null, reason});

  // ---- shared building blocks --------------------------------------------
  class Base {
    constructor(world) { this.w = world; this.known = new Set(); this.cache = new Map(); this.entries = []; }
    async init() {}
    async onDispatch(trip) { this.known.add(trip.trip); }
    dropPeer() {}
    get log() { return this.entries; }
    async verifyAudit() { return true; }                                   // a plain list has nothing to verify
    record(event, detail) { this.entries.push({seq: this.entries.length, ts: this.w.now, event, detail}); }
    // Identity-only authorization: the adapter knows which trips exist, and nothing about who may ask for which floor.
    // With `tripTable` (a fairness variant, see run.cjs) the adapter also looks up which robot and floor the trip was given.
    decide(claims) {
      if (!claims || !this.known.has(claims.trip)) return answer("deny", "unknown trip");
      if (!Object.hasOwn(MAP, claims.rawFloor)) return answer("deny", "unknown floor name");
      const trip = this.w.trips.get(claims.trip);
      if (this.w.tripTable && (trip.robot !== claims.robot || trip.floor !== MAP[claims.rawFloor])) return answer("deny", "call does not match the trip table");
      this.w.forward(claims, this.w.id);
      return answer("allow", "known trip");
    }
    cached(id, fingerprint) { const hit = this.cache.get(id); return hit && hit.fingerprint === fingerprint ? hit.reply : null; }
    remember(id, fingerprint, reply) { this.cache.set(id, {fingerprint, reply}); return reply; }
    relay(frame) { return this.w.net.rpc("backbone", "fleet", "adapter", frame); }
    async fleet(frame) { return this.relay(frame); }
    async direct(mat, claims, o = {}) { return this.w.net.rpc("backbone", mat.id, "adapter", await this.frame(mat, claims, o), o); }
  }

  // A signed envelope must have exactly the expected fields and types. This also keeps free text out of the log.
  function malformed(env, headerKeys) {
    const {hdr, claims} = env;
    if (Object.keys(env).some(k => !["hdr", "capId", "claims"].includes(k)) || Object.keys(hdr).some(k => !headerKeys.includes(k))) return "unexpected field in the envelope";
    if (!Number.isFinite(hdr.ts) || !Number.isInteger(hdr.seq)) return "time or sequence number is not a number";
    if (typeof hdr.requestId !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(hdr.requestId) || hdr.requestId !== claims.requestId) return "request ID is malformed";
    if (Object.values(claims).some(v => typeof v !== "string" || v.length > 80)) return "claim value is malformed";
    return null;
  }
  const envelopeHash = frameText => { const env = parse(frameText)?.env; return env ? sha256hex(canon(env)) : null; };
  // Signed reply from the adapter, bound to the exact request it answers and to the time it was given.
  async function signedReply(mat, world, requestId, decision, reason, requestHash) {
    const env = {from: mat.cert.body.id, requestId, requestHash, ts: world.now, decision, reason};
    return JSON.stringify({env, cert: mat.cert, sig: await sign(mat.key.priv, canon(env))});
  }
  async function readSignedReply(world, text, requestId, requestHash) {
    const r = parse(text);
    if (!r || !r.env) return noAnswer("no signed answer");
    if (await certProblem(world, r.cert, "adapter")) return noAnswer("answer is not from the lift adapter");
    if (!await verify(r.cert.body.pub, r.sig, canon(r.env))) return noAnswer("answer signature is wrong");
    if (r.env.requestId !== requestId) return noAnswer("answer belongs to another request");
    if (requestHash !== undefined && r.env.requestHash !== requestHash) return noAnswer("answer was given to a different message");
    if (!Number.isFinite(r.env.ts) || Math.abs(world.now - r.env.ts) > LIMITS.freshSeconds) return noAnswer("answer is stale");
    return answer(r.env.decision, r.env.reason);
  }

  // Three-message handshake and encrypted records, shared by E and G.
  const transcriptOf = (hello, ack) => canon(hello) + "|" + ack.sid + "|" + ack.eph + "|" + canon(ack.cert);
  async function connect(world, mat, hop, server, serverRole, tag, opts) {
    const eph = await exchangeKey();
    const hello = {v: tag, t: "hello", eph: eph.pub, cert: mat.cert, nonce: random()};
    const ack = parse(await world.net.rpc(hop, mat.id, server, JSON.stringify(hello), opts));
    if (!ack || ack.t !== "ack" || await certProblem(world, ack.cert, serverRole)) return null;
    const transcript = transcriptOf(hello, ack);
    if (!await verify(ack.cert.body.pub, ack.sig, transcript)) return null;
    const keys = await sessionKeys(eph.priv, ack.eph, transcript);
    const fin = {v: tag, t: "fin", sid: ack.sid, sig: await sign(mat.key.priv, transcript + "|fin")};
    const ok = parse(await world.net.rpc(hop, mat.id, server, JSON.stringify(fin), opts));
    return ok && ok.t === "ok" ? {sid: ack.sid, keys, out: 0, in: 0, server, serverCert: ack.cert, serverRole} : null;
  }
  async function exchange(world, mat, hop, session, text, opts) {
    if (await certProblem(world, session.serverCert, session.serverRole)) return null;   // revoked since the handshake
    const n = session.out++;
    const frame = {t: "rec", sid: session.sid, n, ct: await seal(session.keys.c2s, n, session.sid + "|c2s", text)};
    const reply = parse(await world.net.rpc(hop, mat.id, session.server, JSON.stringify(frame), opts));
    if (!reply || reply.t !== "rec" || reply.n !== session.in) return null;
    const plain = await unseal(session.keys.s2c, reply.n, session.sid + "|s2c", reply.ct);
    if (plain !== null) session.in++;
    return plain;
  }
  // Server side. `inner(text, peer)` handles a decrypted record and returns the reply text.
  async function serve(world, mat, sessions, frame, inner, gatekeeper) {
    const f = parse(frame);
    const error = why => JSON.stringify({t: "err", why});
    if (!f) return error("unreadable");
    if (f.t === "hello") {
      if (await certProblem(world, f.cert)) return error("certificate refused");
      if (gatekeeper && gatekeeper(f.cert.body)) return error("source isolated");
      const eph = await exchangeKey();
      const ack = {t: "ack", sid: random(), eph: eph.pub, cert: mat.cert};
      const transcript = transcriptOf(f, ack);
      ack.sig = await sign(mat.key.priv, transcript);
      // At most one half-open session per claimed identity, so replayed hellos cannot pile up.
      for (const [sid, old] of sessions) if (!old.ready && old.peer.id === f.cert.body.id) sessions.delete(sid);
      sessions.set(ack.sid, {peer: f.cert.body, peerCert: f.cert, keys: await sessionKeys(eph.priv, f.eph, transcript), transcript, in: 0, out: 0, ready: false});
      return JSON.stringify(ack);
    }
    const s = sessions.get(f.sid);
    if (!s) return error("unknown session");
    if (f.t === "fin") {
      if (!await verify(s.peer.pub, f.sig, s.transcript + "|fin")) { sessions.delete(f.sid); return error("client proof failed"); }
      s.ready = true;
      // One live session per device: a proven new connection retires the old ones, so held-back frames from them are dead.
      for (const [sid, old] of sessions) if (sid !== f.sid && old.peer.id === s.peer.id) sessions.delete(sid);
      return JSON.stringify({t: "ok"});
    }
    if (f.t !== "rec" || !s.ready || f.n !== s.in) return error("out of order");
    s.in++;                                                                // claim the slot before any await: no concurrent replays
    if (await certProblem(world, s.peerCert)) { sessions.delete(f.sid); return error("certificate refused"); }
    const plain = await unseal(s.keys.c2s, f.n, f.sid + "|c2s", f.ct);
    if (plain === null) return error("record refused");
    const out = await inner(plain, s.peer);
    const n = s.out++;
    return JSON.stringify({t: "rec", sid: f.sid, n, ct: await seal(s.keys.s2c, n, f.sid + "|s2c", out)});
  }
  // A client that keeps one session and reconnects once when the link was lost.
  async function viaChannel(world, mat, slot, hop, server, role, tag, text, o = {}) {
    for (let attempt = 0; attempt < (o.noRetry ? 1 : 2); attempt++) {
      if (!slot.session) slot.session = await connect(world, mat, hop, server, role, tag, o);
      if (!slot.session) return null;
      const reply = await exchange(world, mat, hop, slot.session, text, o);
      if (reply !== null) return reply;
      slot.session = null;
    }
    return null;
  }
  const dropSessions = (sessions, id) => { for (const [sid, s] of sessions) if (s.peer.id === id) sessions.delete(sid); };

  // ---- A · open network ---------------------------------------------------
  class Open extends Base {
    async frame(mat, claims) { return JSON.stringify({v: "A", claims}); }
    async call(mat, claims, o = {}) {
      const r = parse(await this.w.net.rpc("wifi", mat.id, "fleet", await this.frame(mat, claims, o), o));
      return r && typeof r.decision === "string" ? answer(r.decision, r.reason) : noAnswer("no answer");
    }
    async adapter(frame) {
      const f = parse(frame);
      if (!f || !f.claims) return JSON.stringify(answer("deny", "unreadable"));
      const hit = this.cached(f.claims.requestId, canon(f.claims));
      if (hit) return hit;
      this.record("call", f.claims);
      return this.remember(f.claims.requestId, canon(f.claims), JSON.stringify(this.decide(f.claims)));
    }
  }

  // ---- B · network admission only ----------------------------------------
  class Admission extends Open {
    async init() { this.w.admission = true; }                              // modelled: enterprise Wi-Fi with per-device certificates
  }

  // ---- C · signed single-use tickets (teammate's gate, method M1) --------
  class Tickets extends Open {
    async init() {
      const w = this.w;
      this.gateWorld = deps.gate.makeWorld();
      this.gate = new deps.gate.Gate(this.gateWorld, {M1: true}, {get t() { return w.now * 1000; }});
    }
    get log() { return this.gate.audit; }
    async verifyAudit() { return this.gate.verifyAudit(); }
    async onDispatch(trip) {
      this.gateWorld.tasks[trip.trip] = {dest: trip.floor, type: "med", owner: trip.robot, status: "REGISTERED"};
      // The ticket travels with the mission, through the fleet manager, to the robot.
      this.w.nodes[trip.robot].x.tickets[trip.trip] = deps.gate.issueToken(trip.robot, trip.trip, trip.floor, this.w.now * 1000);
    }
    async frame(mat, claims, o = {}) {
      return JSON.stringify({v: "C", claims, token: o.stolen?.token ?? mat.x.tickets[claims.trip]});
    }
    async adapter(frame) {
      const f = parse(frame);
      if (!f || !f.claims) return JSON.stringify(answer("deny", "unreadable"));
      const c = f.claims, fingerprint = canon(c) + "|" + f.token;
      const hit = this.cached(c.requestId, fingerprint);
      if (hit) return hit;
      this.record("call", c);
      const result = this.gate.handle({type: "deliver", user: c.robot, task_id: c.trip, destination: MAP[c.rawFloor] ?? "unknown", token: f.token, source: String(c.robot)});
      if (result.ok) this.w.forward(c, "C");
      return this.remember(c.requestId, fingerprint, JSON.stringify(result.ok ? answer("allow", "valid ticket") : answer("deny", result.reason)));
    }
    record(event, detail) { (this.inbox ??= []).push({event, detail}); }  // what a naive adapter keeps of each call
  }

  // ---- D · per-device signed messages ------------------------------------
  class Signed extends Base {
    constructor(world) { super(world); this.lastSeq = new Map(); }
    // A retry keeps its request ID and is signed again with a fresh time and sequence number.
    async frame(mat, claims, o = {}) {
      const env = {hdr: {from: o.claimFrom ?? mat.cert.body.id, to: "adapter", seq: ++mat.x.seq, ts: this.w.now, requestId: claims.requestId}, claims};
      return JSON.stringify({v: "D", env, cert: o.stolen?.cert ?? mat.cert, sig: await sign(mat.key.priv, canon(env))});
    }
    async call(mat, claims, o = {}) {
      const frame = await this.frame(mat, claims, o);
      return readSignedReply(this.w, await this.w.net.rpc("wifi", mat.id, "fleet", frame, o), claims.requestId, await envelopeHash(frame));
    }
    async adapter(frame) {
      const w = this.w, me = w.nodes.adapter, f = parse(frame);
      if (!f || !f.env || !f.env.hdr || !f.env.claims) return signedReply(me, w, undefined, "deny", "unreadable");
      const {hdr, claims} = f.env, requestHash = await sha256hex(canon(f.env));
      const refuse = why => signedReply(me, w, hdr.requestId, "deny", why, requestHash);
      const problem = await certProblem(w, f.cert, "agv");
      if (problem) return refuse(problem);
      if (!await verify(f.cert.body.pub, f.sig, canon(f.env))) return refuse("signature is wrong");
      const shape = malformed(f.env, ["from", "to", "seq", "ts", "requestId"]);
      if (shape) return refuse(shape);
      if (hdr.to !== "adapter" || hdr.from !== f.cert.body.id || claims.robot !== hdr.from) return refuse("sender does not match its certificate");
      if (Math.abs(w.now - hdr.ts) > LIMITS.freshSeconds) return refuse("message is stale");
      const hit = this.cached(hdr.requestId, canon(claims));
      if (hit) return signedReply(me, w, hdr.requestId, hit.decision, hit.reason, requestHash);        // a retry gets the earlier answer, signed for this message
      if (!(hdr.seq > (this.lastSeq.get(hdr.from) ?? 0))) return refuse("sequence number already used");
      this.lastSeq.set(hdr.from, hdr.seq);
      this.record("call", claims);
      const d = this.remember(hdr.requestId, canon(claims), this.decide(claims));
      return signedReply(me, w, hdr.requestId, d.decision, d.reason, requestHash);
    }
  }

  // ---- E · encrypted channel with mutual authentication ------------------
  class Channel extends Base {
    constructor(world) { super(world); this.tag = "E"; this.robotSessions = new Map(); this.adapterSessions = new Map(); this.up = {session: null}; }
    dropPeer(id) { dropSessions(this.robotSessions, id); }
    body(mat, claims) { return canon({claims}); }
    async call(mat, claims, o = {}) {
      mat.x.link ??= {session: null};
      const body = await this.body(mat, claims, o);
      const reply = await viaChannel(this.w, mat, mat.x.link, "wifi", "fleet", "fleet", this.tag, body, o);
      return reply === null ? noAnswer("no secure channel or no answer") : this.readReply(reply, claims, body);
    }
    readReply(text) { const r = parse(text); return r && typeof r.decision === "string" ? answer(r.decision, r.reason) : noAnswer("no answer"); }
    upstream(text) { return viaChannel(this.w, this.w.nodes.fleet, this.up, "backbone", "adapter", "adapter", this.tag, text); }
    async fleet(frame) {
      return serve(this.w, this.w.nodes.fleet, this.robotSessions, frame, async (plain, peer) => {
        const m = parse(plain);
        // The fleet manager only lets a robot speak for itself.
        if (!m || !m.claims || peer.role !== "agv" || m.claims.robot !== peer.id) return canon(answer("deny", "a robot may only speak for itself"));
        return (await this.upstream(canon({claims: m.claims, onBehalfOf: peer.id}))) ?? canon(answer("hold", "lift adapter unavailable"));
      });
    }
    async adapter(frame) {
      return serve(this.w, this.w.nodes.adapter, this.adapterSessions, frame, async (plain, peer) => {
        const m = parse(plain);
        if (!m || !m.claims || peer.role !== "fleet") return canon(answer("deny", "only the fleet manager may relay lift calls"));
        const hit = this.cached(m.claims.requestId, canon(m.claims));
        if (hit) return hit;
        this.record("call", m.claims);
        return this.remember(m.claims.requestId, canon(m.claims), canon(this.decide(m.claims)));
      });
    }
    // A compromised fleet manager uses its own genuine channel to the adapter.
    async direct(mat, claims, o = {}) {
      const slot = mat.id === "fleet" ? this.up : (mat.x.direct ??= {session: null});
      return viaChannel(this.w, mat, slot, "backbone", "adapter", "adapter", this.tag, await this.directBody(mat, claims, o), o);
    }
    directBody(mat, claims) { return canon({claims, onBehalfOf: claims.robot}); }
  }

  // ---- F · trip capability with proof of possession ----------------------
  // Shared by F and G: issue a capability, build a signed call, and check both at the adapter.
  const Capability = {
    async issue(pipe, trip) {
      const w = pipe.w, robot = w.nodes[trip.robot], dispatcher = w.nodes.dispatcher;
      const body = {capId: "cap-" + trip.trip + "-" + random(4), trip: trip.trip, robot: trip.robot, robotKey: robot.key.pub,
        lift: trip.lift, origin: trip.origin, floor: trip.floor, nbf: w.now, exp: w.now + 600};
      robot.x.caps[trip.trip] = {body, sig: await sign(dispatcher.key.priv, canon(body)), cert: dispatcher.cert};
    },
    async request(pipe, mat, claims, o = {}) {
      const cap = o.stolen?.cap ?? mat.x.caps[claims.trip];
      const env = {hdr: {from: o.claimFrom ?? mat.cert.body.id, seq: ++mat.x.seq, ts: pipe.w.now, requestId: claims.requestId}, capId: cap?.body?.capId, claims};
      return JSON.stringify({v: pipe.w.id, cap, env, sig: await sign(mat.key.priv, canon(env)), ...pipe.attach?.(mat, claims, o)});
    },
    // Returns {cap, claims, hdr} when everything checks out, otherwise {refuse: reason}.
    async check(pipe, f) {
      const w = pipe.w;
      if (!f || !f.env || !f.env.hdr || !f.env.claims) return {refuse: "unreadable"};
      const {hdr, claims} = f.env, cap = f.cap;
      if (!cap || !cap.body) return {refuse: "no trip capability"};
      const problem = await certProblem(w, cap.cert, "dispatcher");
      if (problem) return {refuse: "capability issuer: " + problem};
      if (!await verify(cap.cert.body.pub, cap.sig, canon(cap.body))) return {refuse: "capability signature is wrong"};
      if (w.now < cap.body.nbf || w.now >= cap.body.exp) return {refuse: "capability is outside its time window"};
      if (pipe.revokedCaps.has(cap.body.capId)) return {refuse: "capability was withdrawn"};
      if (w.revokedKeys.has(cap.body.robotKey)) return {refuse: "robot key was revoked"};
      if (!await verify(cap.body.robotKey, f.sig, canon(f.env))) return {refuse: "call is not signed by the robot this capability names"};
      if (f.env.capId !== cap.body.capId || claims.robot !== cap.body.robot || claims.trip !== cap.body.trip || claims.lift !== cap.body.lift) {
        return {refuse: "call does not match its capability"};
      }
      const shape = malformed(f.env, ["from", "seq", "ts", "requestId"]);
      if (shape) return {refuse: shape};
      if (Math.abs(w.now - hdr.ts) > LIMITS.freshSeconds) return {refuse: "call is stale"};
      return {cap, claims, hdr};
    },
    // Each signed call is accepted once. A relay that kept a copy cannot submit it again later.
    seenBefore(pipe, hdr) {
      if (!(hdr.seq > (pipe.lastSeq.get(hdr.from) ?? 0))) return true;
      pipe.lastSeq.set(hdr.from, hdr.seq);
      return false;
    }
  };
  class TripCapability extends Base {
    constructor(world) { super(world); this.revokedCaps = new Set(); this.used = new Map(); this.lastSeq = new Map(); }
    async onDispatch(trip) { await Capability.issue(this, trip); }
    frame(mat, claims, o) { return Capability.request(this, mat, claims, o); }
    async call(mat, claims, o = {}) {
      const frame = await this.frame(mat, claims, o);
      return readSignedReply(this.w, await this.w.net.rpc("wifi", mat.id, "fleet", frame, o), claims.requestId, await envelopeHash(frame));
    }
    async adapter(frame) {
      const w = this.w, me = w.nodes.adapter, f = parse(frame);
      const requestHash = f?.env ? await sha256hex(canon(f.env)) : undefined;
      const reply = (decision, reason) => signedReply(me, w, f?.env?.hdr?.requestId, decision, reason, requestHash);
      const checked = await Capability.check(this, f);
      if (checked.refuse) return reply("deny", checked.refuse);
      const {cap, claims, hdr} = checked;
      const hit = this.cached(hdr.requestId, canon(claims));
      if (hit) return reply(hit.decision, hit.reason);
      if (Capability.seenBefore(this, hdr)) return reply("deny", "call was already seen");
      this.record("call", claims);
      if (MAP[claims.rawFloor] !== cap.body.floor) return reply("deny", "requested floor is outside this trip");
      const first = !this.used.has(cap.body.capId);
      if (first) { w.forward(claims, "F"); this.used.set(cap.body.capId, hdr.requestId); }
      const d = this.remember(hdr.requestId, canon(claims), answer("allow", first ? "capability and proof of possession verified" : "lift call for this trip was already forwarded"));
      return reply(d.decision, d.reason);
    }
  }

  // ---- G · layered pipeline ----------------------------------------------
  class Layered extends Channel {
    constructor(world) {
      super(world); this.tag = "G"; this.revokedCaps = new Set(); this.used = new Map(); this.lastSeq = new Map(); this.chain = [];
      this.buckets = new Map(); this.isolatedUntil = new Map();
    }
    get log() { return this.chain; }
    async onDispatch(trip) { await Capability.issue(this, trip); }
    // Hash chain as in the teammate's gate, plus the adapter's signature on every entry.
    async audit(event, detail) {
      const prev = this.chain.length ? this.chain[this.chain.length - 1].hash : "genesis";
      const entry = {seq: this.chain.length, ts: this.w.now, event, detail, prev};
      entry.hash = await sha256hex(prev + JSON.stringify([entry.seq, entry.ts, event, detail]));
      entry.sig = await sign(this.w.nodes.adapter.key.priv, entry.hash);
      this.chain.push(entry);
      // The head of the log is exported to a witness outside the adapter (the hospital's security log) on every append.
      this.w.witness = {seq: entry.seq, hash: entry.hash};
    }
    async verifyAudit() {
      let prev = "genesis";
      for (const e of this.chain) {
        const hash = await sha256hex(prev + JSON.stringify([e.seq, e.ts, e.event, e.detail]));
        if (e.prev !== prev || e.hash !== hash || !await verify(this.w.nodes.adapter.key.pub, e.sig, hash)) return false;
        prev = e.hash;
      }
      // The log must end exactly at the head the outside witness last received: no cut, no fork, no silent append.
      const seen = this.w.witness;
      return !seen ? this.chain.length === 0 : this.chain.length === seen.seq + 1 && this.chain[seen.seq].hash === seen.hash;
    }
    // Data minimization at the sender: only the fields a lift needs leave the robot.
    body(mat, claims, o = {}) {
      const minimal = o.rawSender ? claims : Object.fromEntries(SCHEMA.filter(k => k in claims).map(k => [k, claims[k]]));
      return Capability.request(this, mat, minimal, o);
    }
    async readReply(text, claims, body) { return readSignedReply(this.w, text, claims.requestId, await envelopeHash(body)); }
    directBody(mat, claims, o) { return this.body(mat, claims, o); }
    // Circuit breaker at the fleet manager, per authenticated robot.
    // Refusals are counted in a sliding window and isolation ends by itself, so a burst of bad luck cannot remove a robot for good.
    strike(id, denied) {
      const now = this.w.now, second = Math.floor(now);
      let b = this.buckets.get(id);
      if (!b) this.buckets.set(id, b = {second: -1, count: 0, denials: []});
      if (denied) {
        b.denials = b.denials.filter(t => now - t < LIMITS.denialWindowSeconds).concat(now);
        if (b.denials.length >= LIMITS.denialsToTrip) this.isolate(id, "repeated refusals");
        return;
      }
      if (b.second !== second) { b.second = second; b.count = 0; }
      if (++b.count > LIMITS.ratePerSecond) this.isolate(id, "request rate");
    }
    isolated(id) { return (this.isolatedUntil.get(id) ?? -Infinity) > this.w.now; }
    isolate(id, why) {
      if (this.isolated(id)) return;
      this.isolatedUntil.set(id, this.w.now + LIMITS.isolationSeconds); this.buckets.delete(id); this.dropPeer(id); this.pending = {id, why};
    }
    async fleet(frame) {
      const reply = await serve(this.w, this.w.nodes.fleet, this.robotSessions, frame, async (plain, peer) => {
        const refuse = why => signedReply(this.w.nodes.fleet, this.w, parse(plain)?.env?.hdr?.requestId, "deny", why);
        this.strike(peer.id, false);
        if (this.isolated(peer.id)) return refuse("source isolated");
        const m = parse(plain);
        if (!m || !m.env || !m.env.hdr || peer.role !== "agv" || m.env.hdr.from !== peer.id) { this.strike(peer.id, true); return refuse("a robot may only speak for itself"); }
        const out = await this.upstream(plain);
        if (out === null) return refuse("lift adapter unavailable");
        const verdict = parse(out)?.env;
        if (verdict?.decision === "deny" && !/stale/.test(verdict.reason)) this.strike(peer.id, true);   // a late message is not misbehaviour
        return out;
      }, peer => this.isolated(peer.id));
      if (this.pending) { const p = this.pending; this.pending = null; await this.audit("breaker", {source: p.id, why: p.why}); }
      return reply;
    }
    async adapter(frame) {
      const w = this.w, me = w.nodes.adapter;
      return serve(w, me, this.adapterSessions, frame, async (plain, peer) => {
        const f = parse(plain), requestId = f?.env?.hdr?.requestId;
        const requestHash = f?.env ? await sha256hex(canon(f.env)) : undefined;
        // The log stores a fingerprint of the request, never its free text.
        const reply = async (decision, reason, detail) => {
          await this.audit(decision, {request: requestHash?.slice(0, 16), reason, ...detail});
          return signedReply(me, w, requestId, decision, reason, requestHash);
        };
        if (peer.role !== "fleet") return reply("deny", "only the fleet manager may relay lift calls");
        // Unknown fields are refused and never written to the log.
        if (f?.env?.claims && Object.keys(f.env.claims).some(k => !SCHEMA.includes(k))) return reply("deny", "unknown field rejected");
        const checked = await Capability.check(this, f);
        if (checked.refuse) return reply("deny", checked.refuse);
        const {cap, claims, hdr} = checked, who = {trip: claims.trip, robot: claims.robot};
        const objection = await this.secondOpinion?.(f, cap);
        if (objection) return reply("deny", objection, who);
        const hit = this.cached(hdr.requestId, canon(claims));
        if (hit) return signedReply(me, w, requestId, hit.decision, hit.reason, requestHash);
        if (Capability.seenBefore(this, hdr)) return reply("deny", "call was already seen", who);
        // Lift admission from ward-safety/controller.js: floor mapping, patient priority, fresh lift status.
        const grant = {active: true, robot: cap.body.robot, trip: cap.body.trip, lift: cap.body.lift, origin: cap.body.origin, floor: cap.body.floor,
          from: cap.body.nbf, until: cap.body.exp};
        const verdict = deps.evaluate({robot: claims.robot, trip: claims.trip, lift: claims.lift, rawFloor: claims.rawFloor, mapRevision: claims.mapRevision}, grant,
          {...w.site, destinationLabel: LIFT_LABEL[cap.body.floor]}, w.now);
        if (verdict.outcome !== "allow") return reply(verdict.outcome, verdict.reason, who);
        // Independent corroboration: a lobby sensor must have seen this robot at the lift just now.
        const seen = w.presence[claims.robot];
        if (seen === undefined || w.now - seen > LIMITS.presenceSeconds) return reply("hold", "Robot was not observed at the lift", who);
        const first = !this.used.has(cap.body.capId);
        if (first) { w.forward(claims, w.id); this.used.set(cap.body.capId, hdr.requestId); }
        const d = this.remember(hdr.requestId, canon(claims), answer("allow", first ? verdict.reason : "Lift call for this trip was already forwarded"));
        return reply(d.decision, d.reason, who);
      });
    }
  }

  // ---- H · layered pipeline with dual control ---------------------------
  // Extension added after the first results, to close the "compromised dispatcher" limit: the lift adapter also requires
  // a statement signed by the clinical order system, independent of the dispatcher, naming the same robot and floor.
  class DualControl extends Layered {
    constructor(world) { super(world); this.tag = "H"; }
    async onDispatch(trip) {
      await super.onDispatch(trip);
      const order = this.w.orders.get(trip.trip), signer = this.w.nodes.orders;
      if (!order) return;                                                  // no clinical order, so nothing to countersign
      const body = {trip: trip.trip, robot: order.robot, floor: order.floor};
      (this.w.nodes[trip.robot].x.orders ??= {})[trip.trip] = {body, sig: await sign(signer.key.priv, canon(body)), cert: signer.cert};
    }
    attach(mat, claims, o = {}) { return {order: o.stolen?.order ?? mat.x.orders?.[claims.trip]}; }
    async secondOpinion(f, cap) {
      const order = f.order;
      if (!order || !order.body) return "no clinical order for this trip";
      if (await certProblem(this.w, order.cert, "orders")) return "clinical order is not from the order system";
      if (!await verify(order.cert.body.pub, order.sig, canon(order.body))) return "clinical order signature is wrong";
      if (order.body.trip !== cap.body.trip || order.body.robot !== cap.body.robot || order.body.floor !== cap.body.floor) return "grant does not match the clinical order";
      return null;
    }
  }

  const PIPELINES = {
    A: {make: Open, name: "Open network", short: "Open"},
    B: {make: Admission, name: "Network admission only", short: "Admission"},
    C: {make: Tickets, name: "Signed single-use tickets", short: "Tickets"},
    D: {make: Signed, name: "Per-device signed messages", short: "Signed"},
    E: {make: Channel, name: "Encrypted channel, mutual authentication", short: "Channel"},
    F: {make: TripCapability, name: "Trip capability with proof of possession", short: "Capability"},
    G: {make: Layered, name: "Layered pipeline", short: "Layered"},
    H: {make: DualControl, name: "Layered pipeline with dual control", short: "G + dual", extension: true}
  };

  return {makeWorld, claimsFor, PIPELINES, MAP, SCHEMA, MARKER, LIMITS,
    tools: {canon, parse, random, sha256hex, signingKey, sign, verify, exchangeKey, sessionKeys, seal, unseal, issueCert, certProblem,
      signedReply, readSignedReply, envelopeHash, transcriptOf, connect, exchange, serve, b64, unb64}};
});
