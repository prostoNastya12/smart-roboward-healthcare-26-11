# Smart RoboWard implementation plan

**Version 2.1 · written 28 November 2026, 00:30 CET, results and review added 01:30 CET · Submission 28 November 2026, 11:00 CET · IFOHRA Challenge 9**

Version 1 of this plan finished the control room, slides and video. Version 2 changes the focus. The project is about making robot communication in a hospital more secure. The simulator and the pages exist to show and test that. This plan defines the security work, how it is measured, and how one pipeline is chosen.

Sections 1 to 8 are the plan as written before the first run, with additions marked "added after review". Results are in [section 10](#10-results-and-decision) and status in [section 9](#9-work-packages). Everything here runs on local, fictional data. Nothing is merged into `master` until the team says so.

## 1. Goal

Find the most secure practical way for the devices in a robot delivery to talk to each other, prove it by attacking several candidate designs with the same attacks, and build the winner into the platform.

"Secure" means four things, in this order:

1. **Nothing unauthorized moves.** The lift receives a call only for a real, current delivery, from the robot that delivery was given to, for the floor it was given.
2. **Care keeps running.** An attack or a fault degrades one robot or one route. The ward keeps working and knows who holds the parcel.
3. **Private data stays private.** Nobody on the network learns where deliveries go. The lift vendor receives only what a lift needs.
4. **Evidence can be trusted.** Afterwards, staff can show what happened and that the record was not edited.

## 2. The message flow we protect

One delivery, RX-01 from the pharmacy on L1 to Ward B on L2 through Lift 1:

| Step | From | To | Message | What goes wrong if it is forged |
| --- | --- | --- | --- | --- |
| 1 | Hospital dispatcher | Vendor fleet manager | Delivery order | A robot drives somewhere it should not |
| 2 | Fleet manager | Robot, over Wi-Fi | Mission | Same |
| 3 | Robot | Lift adapter, relayed by the fleet manager | **Lift call** for a floor | The lift moves for an attacker. Patients and staff wait |
| 4 | Lift adapter | Robot | **Reply**: allow, hold or deny | A robot enters a lift that was never reserved for it |
| 5 | Facilities | Lift adapter | Lift status and patient priority | The adapter acts on old information |
| 6 | Lift adapter | Audit log | Decision record | An incident cannot be reconstructed |

Steps 3 to 6 are where a network message causes a physical action, so the comparison concentrates there. Step 1 is already covered by the teammate's request gate, which stays in front of dispatch.

There are two network hops: robot to fleet manager over Wi-Fi, and fleet manager to lift adapter over the wired robotics network.

## 3. Who attacks

Five attacker positions. Each attack in section 5 names one.

| Code | Position | Has | Example |
| --- | --- | --- | --- |
| OUT | Outside the robotics network | No keys | Laptop on guest Wi-Fi |
| PATH | On the path inside the robotics network | Reads, changes, drops, delays, replays and injects frames. No keys | Rogue access point, compromised switch, maintenance laptop |
| DEV | A compromised enrolled robot (SUP-03) | That robot's own keys and credentials | Malware on one robot |
| FLEET | The compromised fleet manager | The vendor server's keys and open connections | Supplier breach |
| LEAK | Later theft of long-term keys | Recorded traffic plus every stored private key | Stolen backup |

Out of scope and listed as limits: a compromised lift adapter, a compromised hospital certificate authority, radio jamming, and physical tampering with a robot.

## 4. Candidate pipelines

Seven designs. Each is a complete, runnable implementation of steps 3 and 4 with real cryptography from the platform's standard library (Ed25519 signatures, X25519 key agreement, HKDF, AES-256-GCM, HMAC-SHA-256). No packages are installed.

| ID | Pipeline | Source | Idea |
| --- | --- | --- | --- |
| A | Open network | Baseline | Plain messages. The adapter accepts any call that names a known trip |
| B | Network admission only | Common hospital practice | Enterprise Wi-Fi admits only enrolled devices. Messages inside are plain. The admission step is modelled, the rest is real |
| C | Signed single-use tickets | **Teammate's gate, method M1**, running their real `gate/gate.cjs` | The dispatcher issues a ticket signed with a server secret, bound to robot, trip and floor, valid once |
| D | Per-device signed messages | Standard practice | Every device has its own key and a certificate from the hospital. Each message is signed, numbered and time-stamped |
| E | Encrypted channel with mutual authentication | Standard practice (the idea behind mutual TLS) | Both ends prove their certificate, agree fresh keys, and encrypt everything on each hop |
| F | Trip capability with proof of possession | **Our proposal** from the planning notebook | The dispatcher signs a grant for one robot key, lift, floor and time window. The robot signs each call with that key. The adapter checks both end to end |
| G | Layered pipeline | **Combination** | E on every hop, F end to end, plus the teammate's data minimization (M3) and circuit breaker (M4), our lift admission check, an independent presence check, and a signed audit chain |

| H | Layered pipeline with dual control | **Extension, added after the first results** | G, and the adapter also requires a second signature from the clinical order system, independent of the dispatcher. Reported, not a candidate under the selection rule |

Why these seven: A and B are what exists today. C is the teammate's answer. D and E are the two textbook answers, and they fail in different, instructive ways. F is our answer. G tests whether combining them closes what each one leaves open.

### What each layer in G is for

| Layer | Stops | Taken from |
| --- | --- | --- |
| Encrypted, mutually authenticated hops with fresh keys per session | Eavesdropping, tampering, replay on the wire, impersonating the adapter, later decryption with stolen keys | E |
| Trip capability bound to the robot's key | A compromised fleet manager, another robot, a stolen grant, a wrong floor, a call with no delivery behind it | F |
| Field allowlist at sender and adapter | Private data reaching the lift side | Teammate's M3 |
| Circuit breaker per authenticated source | One flooding device starving the others | Teammate's M4 |
| Lift admission: approved floor mapping, patient priority, fresh lift status | Acting on stale or ambiguous information | Our `ward-safety/controller.js`, reused unchanged |
| Presence corroboration from a lobby sensor | A valid robot calling the lift when it is not there | Notebook proposal 2, new in code |
| Hash-chained audit entries signed by the adapter | Rewriting the record afterwards | Extends the teammate's audit chain |

## 5. Attack suite

Every attack runs against every pipeline. An attack counts as **blocked** only by its effect on the system: what the lift received, what the attacker learned, what the robot believed. A pipeline never reports its own result.

| ID | Attack | Position | The attacker wins if |
| --- | --- | --- | --- |
| T01 | Eavesdrop on a delivery | PATH | Captured frames reveal the trip, the floor or a private marker |
| T02 | Inject a lift call from outside | OUT | The lift receives a call |
| T03 | Replay a recorded lift call a minute later | PATH | The lift receives a second call |
| T04 | Change the floor in transit | PATH | The lift is called for a floor the robot did not ask for |
| T05 | One robot pretends to be another | DEV | The lift receives a call in RX-01's name |
| T06 | A robot calls the lift with no delivery of its own | DEV | The lift receives a call |
| T07 | Compromised fleet manager invents a lift call | FLEET | The lift receives a call |
| T08 | Genuine robot asks for the wrong floor | DEV as RX-01 | The lift is called for L1 on a trip to L2 |
| T09 | A retired robot keeps working | DEV, revoked | The lift receives a call |
| T10 | Steal a credential off the wire and use it elsewhere | PATH and DEV | The lift receives a call triggered by the attacker's device |
| T11 | Hold a lift call for two minutes, then release it | PATH | The lift receives the stale call |
| T12 | Forge or replay the adapter's reply | PATH | The robot believes a refused call was allowed |
| T13 | Impersonate the lift adapter | PATH and DEV | The robot accepts an answer from the attacker |
| T14 | Flood from one compromised robot | DEV | Fewer than 90% of other robots' legitimate calls are served |
| T15 | Decrypt recorded traffic with keys stolen later | LEAK | The recorded lift calls can be read |
| T16 | Rewrite the audit log and repair its hashes | Write access to the log | Verification still passes |
| T17 | Over-sharing | None, a careless sender | A private marker reaches the lift-side log |
| T18 | Suppress lift status updates | PATH | The lift receives a call while the adapter's status is older than 10 seconds |
| T19 | Robot calls the lift when it is not at the lift | DEV as RX-01 | The lift receives a call |
| T20 | Compromised dispatcher issues a wrong grant | Dispatcher | The lift is called for the wrong floor |
| T21 | Traffic analysis | PATH | The attacker can tell when a robot called the lift |

| T22 | Lock out a genuine robot by abusing the breaker *(added after review)* | PATH | RX-01's next legitimate call, two minutes later, is refused |
| T23 | Compromised fleet manager reads the deliveries it relays *(added after review)* | FLEET | The fleet manager sees the trip and the floor |
| T24 | Flood the lift adapter directly, past the fleet manager *(added after review)* | DEV | Fewer than 90% of other robots' legitimate calls are served |

T20, T21, T23 and T24 are known limits. We expect every candidate to lose them, including G. They mark the edge of what this design covers. T20 and T21 were in the plan from the start. T23 and T24 were found by the review and could not be fixed tonight.

The review also made six existing attacks harder: T03 replays under a new request ID, T09 gives the retired robot a real trip first, T12 swaps in a genuine answer obtained by another robot, T16 cuts the log as well as editing it, and T17 hides the marker in the request ID.

### Legitimate workload

A pipeline that blocks everything is useless. Each pipeline must also pass all five:

| ID | Case | Passes if |
| --- | --- | --- |
| L01 | Routine lift call | Allowed, exactly one lift call for L2, robot accepts the reply |
| L02 | Reply lost, robot retries with the same request ID | Allowed, still exactly one lift call |
| L03 | Wi-Fi handover drops the connection mid-trip | The next call succeeds without manual steps |
| L04 | Two robots, two trips | Both allowed, two lift calls |
| L05 | Key rotation: the robot gets a new key and certificate | The next trip succeeds with the new key |
| L06 | Held for a patient transfer, the robot retries every 31 seconds *(added after review)* | Allowed once the hold ends, exactly one lift call, robot not isolated |

### Cost

Measured per pipeline: bytes on the wire for one lift call, extra bytes to open a connection, and mean processing time per call over 200 calls on this laptop. Listed, not measured: number of keys to manage, and what the pipeline needs from each vendor.

## 6. How the winner is chosen

Fixed before the first run, so the numbers cannot steer the rule:

1. A pipeline that fails any legitimate case is out.
2. Among the rest, the one that blocks the most attacks wins.
3. On a tie, the one with fewer vendor requirements wins, then the one with fewer bytes on the wire.
4. If the winner is not G, G is still reported and the platform uses the winner.

Acceptance for this plan: the chosen pipeline passes every legitimate case and blocks all but at most one of the attacks that are not listed as limits. Limits are reported separately.

An extension added after the first results (H) is measured and reported. It does not compete under this rule, because the rule and the candidates were fixed first.

## 7. Architecture

```
secure-comms/
  comms.js          primitives, certificates, network with attacker taps, the seven pipelines
  attacks.js        21 attacks, 5 legitimate cases, cost measurement
  run.cjs           runs everything, writes results.json
  results.json      saved measurement with commit-independent input hashes
  info.js           what each pipeline is and what it needs from suppliers
  report.cjs        writes RESULTS.md from results.json
  comms.test.cjs    unit tests for primitives, certificates and each pipeline's happy path
  attacks.test.cjs  checks the saved results against a fresh run and pins the properties we claim
  build-page.cjs    builds site/security-pipelines.html
  page-template.html, page.js, page.css
```

Rules for the code:

- One file of protocol code runs in Node and in the browser. It uses the Web Crypto interface, which both provide.
- Pipeline C calls the teammate's `gate/gate.cjs` for issuing and checking tickets. Pipeline G calls `ward-safety/controller.js` for the admission decision. Neither file is changed.
- Each pipeline exposes the same three operations: set up keys, make a lift call with a given set of key material, and handle a frame at the fleet manager or adapter. Attacks call these with stolen or empty key material. An attack never reaches into a pipeline's internal state to decide the outcome.
- The network object delivers frames between named nodes and lets an attacker tap a hop. A tap can read, change, drop, hold and answer frames.
- Time is a number the test controls. Nothing reads the wall clock except the cost measurement.
- Randomness for the flood order is seeded. Keys are random, as they must be.

## 8. Protocol details

**Certificates.** The hospital certificate authority signs `{id, role, public key, serial, not after}`. Roles: `agv`, `fleet`, `adapter`, `dispatcher`. A revocation list holds serial numbers. Every pipeline from D up checks signature, expiry, revocation and role.

**D, signed message.** `{header: {from, to, sequence, time, request id}, claims}` signed by the device key, with its certificate. The adapter requires `from` to equal the certificate and the robot named in the claims, a time within 30 seconds, and a sequence number above the last one seen. Replies are signed by the adapter and carry the request ID.

**E, channel.** Three-message handshake. Each side sends a fresh X25519 key and its certificate, and signs the hash of everything exchanged. Keys come from HKDF over the shared secret with the transcript hash as salt, one key per direction. Records are AES-256-GCM with a strict counter as nonce and the session ID and direction as associated data. The fleet manager terminates the robot's channel, checks the robot is speaking for itself, and relays over its own channel to the adapter. The adapter trusts the fleet manager's role.

**F, capability.** The dispatcher signs `{capability id, trip, robot, robot public key, lift, origin, floor, not before, expires}`. The robot sends the capability and a signed call. The adapter checks the dispatcher's certificate and signature, the time window, the revocation list for capabilities, the robot's signature under the key named in the capability, that robot, trip and lift match, that the call is fresh, and that the reported floor maps to the granted floor. One capability yields at most one forwarded call. A repeated request ID returns the earlier answer.

**G, layered.** The F message travels inside E channels. Before sending, the client drops every field outside the allowlist. The fleet manager counts requests and refusals per robot and isolates a robot above 5 requests per second or after 5 refusals. The adapter rejects unknown fields without logging them, then checks the capability, then requires a lobby sensor reading for that robot under 10 seconds old, then calls the admission function with the capability as the grant and the facilities feed as the site state. Every decision is appended to a hash chain and the adapter signs each entry.

**Changes after review.** A retry keeps its request ID and is signed again with a fresh time. Each signed call is accepted once. Signed answers carry a hash of the exact request. Envelope fields and types are validated. Both ends re-check the peer's certificate on every record. A proven new connection retires a device's older sessions. The breaker counts refusals in a 10 second window, ignores stale messages, and isolates for 60 seconds. The head of the audit log is exported to an outside witness on every entry.

**H, dual control.** The clinical order system signs `{trip, robot, floor}` for each real order. The robot sends that statement with its call. The adapter refuses a grant that has no matching statement.

**Capacity model for the flood.** The adapter processes at most 20 frames per second. One compromised robot sends 100 junk calls per second for 5 seconds while two other robots send 4 legitimate calls per second. This is a model, as in the teammate's benchmark, and is labelled so.

## 9. Work packages

| # | Package | Done when | Status |
| --- | --- | --- | --- |
| 1 | Merge the teammate's newest `master` into our branch | Tests pass after the merge | Done, `2963d4c` merged |
| 2 | Primitives and certificates in `comms.js` | Unit tests for sign, verify, key agreement, encryption, certificate checks | Done |
| 3 | Network with attacker taps | A tap can read, change, drop, hold and answer a frame | Done, used by T04, T10 to T13 and T22 |
| 4 | Pipelines A to G | Each passes L01 | Done, plus extension H |
| 5 | Attack suite and legitimate cases | Every cell of the matrix is produced by running code | Done: 24 attacks, 6 legitimate cases, 8 pipelines |
| 6 | Cost measurement | Bytes and time per pipeline in `results.json` | Done |
| 7 | Independent review of the attack code | Findings fixed or listed | Done. Eleven confirmed findings: nine fixed, two reported as limits T23 and T24 |
| 8 | Apply the selection rule and record the decision | Section 10 filled from `results.json` | Done |
| 9 | Comparison page with a live wire | The page shows the matrix, constraints and choice, and re-runs any attack in the browser | Done, `site/security-pipelines.html`. A full re-run in the browser matched the saved run |
| 10 | Chosen pipeline in the control room | The over-the-wire decision agrees with the simulation in each round | Done, agrees in all five rounds |
| 11 | Documents | README, control board, handoff, German summary and slides match the results | Done. `RESULTS.md` and the slide numbers are generated from `results.json` |
| 12 | Tests, commit, push to `feature/ward-safety-console` | All tests pass. Nothing merged to `master` | Done, 57 tests |

Not in this plan, by request: re-recording the video. It is scheduled for the morning and should show the comparison page.

## 10. Results and decision

Measured on 28 November 2026 with `node secure-comms/run.cjs`. Simulated devices, real cryptography, attacks written by the team. The full generated report is [secure-comms/RESULTS.md](secure-comms/RESULTS.md).

| Pipeline | Attacks blocked | Legitimate | Bytes per call | ms per call |
| --- | --- | --- | --- | --- |
| A · Open network | 1 / 20 | 6 / 6 | 480 | 0.01 |
| B · Network admission only | 3 / 20 | 6 / 6 | 480 | 0.01 |
| C · Signed single-use tickets | 7 / 20 | 6 / 6 | 802 | 0.02 |
| D · Per-device signed messages | 11 / 20 | 6 / 6 | 2236 | 0.65 |
| E · Encrypted channel, mutual authentication | 11 / 20 | 6 / 6 | 934 | 0.74 |
| F · Trip capability with proof of possession | 13 / 20 | 6 / 6 | 2946 | 0.78 |
| G · Layered pipeline | 20 / 20 | 6 / 6 | 4132 | 1.79 |
| H · Layered pipeline with dual control | 20 / 20 | 6 / 6 | 5166 | 2.11 |

**Decision: G, the layered pipeline.** Every candidate passes the legitimate cases, so rule 2 decides: G blocks 20 of 20, the next best 13. The acceptance bar in section 6 is met.

What the numbers say about each idea:

- **Admission control (B)** stops outsiders and nothing else. One compromised device inside the network has the same power as on an open network.
- **Tickets (C)**, the teammate's method, bind the floor to the trip and stop replays. A ticket is a bearer token in clear, so whoever copies it first can use it, the fleet manager sees every ticket, and a retired robot keeps the one it was given.
- **Signatures (D)** prove who is asking. They do not say whether that robot may ask for that floor.
- **An encrypted channel (E)** hides and protects each hop. A compromised fleet manager is still trusted by the adapter, and a held message is accepted later.
- **Our trip grant (F)** closes the authorization gap end to end. It travels in clear and does nothing about floods, stale lift status or the log.
- **Layering (G)** closes all of those together.

Fairness check, requested by the review: with an online trip table at the adapter, D and E each block 13 of 20 and A and B block 4 and 6. D then matches F's count. G stays ahead in both readings.

**Known limits of G:** a compromised dispatcher (T20), traffic analysis (T21), a fleet manager that reads what it relays (T23), and a flood sent straight to the adapter (T24). Also untested: a compromised lift adapter or certificate authority, jamming, physical tampering. A log signed by the adapter stops verifying if the adapter's key is replaced.

**Extension H** adds a second signature from the clinical order system. It blocks T20 as well, at the cost of one more supplier integration and about a kilobyte more per call. Recommendation: adopt H where the hospital's order system can sign. Otherwise G.

**What G costs:** seven things to obtain from suppliers, listed in the report, about four kilobytes per lift call and one to two milliseconds of processing on a laptop. The supplier requirements are the real cost. The most demanding are a signing key on each robot and a lift adapter that verifies grants.

**Next security steps, in order:** encrypt the call end to end from robot to adapter so the fleet manager cannot read it (T23). Authenticate before spending capacity at the adapter, or firewall it to the fleet manager (T24). Name the signing key in each log entry. Have outsiders write attacks.

## 11. For the morning

| # | Task | Owner | Latest |
| --- | --- | --- | --- |
| 1 | Read section 10 and open the comparison page. Agree or change the choice between G and H | Team | 08:00 |
| 2 | Decide whether pull request 1 goes into `master`. It now contains the security work as well | Repository owner | 08:30 |
| 3 | Re-record the video with the security comparison first. The current video predates it | Claude-proficient manager | 09:15 |
| 4 | Rehearse the eight slides with the new talk track | Product manager | 09:30 |
| 5 | Dry run on the presentation laptop with Wi-Fi off. Check that "Run now" works in that browser | Claude-proficient manager | 09:45 |
| 6 | Confirm pitch length and deadline with the organizers | Product manager | 09:45 |
| 7 | Re-read claims and disclosure, then submit | Team | 10:45 |
