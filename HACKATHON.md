# Hackathon Control Board — Smart RoboWard

## Brief
- Challenge: IFOHRA Challenge #9 — Secure integration of robotics in clinical environments (Healthcare Hackathon Bayern). Rules: https://www.bayern-innovativ.de/events-termine/detail/events-termine/healthcare-hackathon-bayern-hacken-bis-der-arzt-kommt-november2026 (user-supplied brief; not independently re-read)
- Judging: creativity, technical skill, feasibility; no published rubric or weights (external-source, per user). Our priority: practical patient/ward-staff impact.
- Deadline: 28 Nov 2026, 11:00 CET. **Assumption flag:** brief also says "submission noon"; we plan to 11:00.
- Team (4): Product manager (scope, pitch) · Robotics dev (mock robot workflow) · Data scientist (synthetic data, metrics) · Claude-proficient manager (prototype, demo integration).
- Constraints: €0, open-source only, local synthetic data, no physical robot (an imported, AI-generated 3D simulator exists, see Reuse). Reused code must respect licenses, be disclosed to the jury, and code/results made available for review.
- Target user and pain: ward nurse tracking a delivery; robots can leak patient data or be commanded by attackers.
- **Core problem (user, 2026-11-27, from on-site discussion; not yet checked against the official brief):** if the system is hacked, the *whole hospital* has to stop: patients cannot be treated and staff cannot work. So the main risk is **losing the whole hospital (availability)**, not only a data leak. A compromised robot system must be contained so that patient care can continue.
- Objective: Let ward nurses track robot deliveries while the robot sees only task ID and destination, blocking unauthorized requests before any disclosure or action, with a local synthetic-data demo.

## Objective & acceptance
- Primary metric (higher better): unauthorized requests blocked before disclosure or action, of 10. Acceptance (proposed, team to confirm): 10/10.
- Co-primary: legitimate tasks completed, of 10. Proposed: 10/10.
- Evaluation set: `experiments/test-matrix.md` (20 rows + C01-C04, fictional). Results measured 2026-11-27 (see Five methods).
- **Proposed new co-primary (team to confirm): containment under attack.** While the robot subsystem is under attack or compromised, ward workflows keep running (the nurse view stays up and switches to manual/degraded mode), and the attack does not spread beyond the robot zone. Measured as: **retained service level** = legitimate ward tasks handled during an attack window (robot or manual fallback) ÷ tasks handled in an equal no-attack window, plus time to isolate the subsystem. Perfect service is not required: **proposed acceptance ≥ 80% retained (team to confirm)**, versus the whole-hospital shutdown (0%) we are preventing. Robot-delivered and manual tasks are reported separately so the 80% is not inflated. Whether M0 really drops to 0% is a hypothesis until measured.
- Secondary: decision latency, audit-log completeness, zero patient fields in robot payload/logs.
- Demo journey: nurse requests delivery → robot receives task ID + destination → status in nurse view → attacker replay/forgery blocked with audit entry.

## Five methods (all implemented and measured on synthetic data, 2026-11-27)
| ID | Candidate / distinct hypothesis | Status | Evidence | Blocker |
|---|---|---|---|---|
| M0 | Baseline: static allowlist of task IDs, no auth | measured | 1/10 blocked (measured, synthetic; `experiments/runs/latest/results.json`) | — |
| M1 | Signed, expiring, single-use task tokens (HMAC) | measured | 7/10 blocked (measured, synthetic; `experiments/runs/latest/results.json`) | — |
| M2 | Role/ward policy check (RBAC/ABAC) on requester | measured | 3/10 blocked (measured, synthetic; `experiments/runs/latest/results.json`) | — |
| M3 | Data-minimization gate: strict schema allowing only task_id + destination | measured | 2/10 blocked (measured, synthetic; `experiments/runs/latest/results.json`) | — |
| M4 | Containment: circuit breaker, robot-zone isolation, degraded manual mode | measured | 2/10 blocked; 100% retained service (measured, synthetic; `experiments/runs/latest/results.json`) | — |

Details: `experiments/methods.md`. The hash-chained audit log is now shared plumbing for all methods, not a candidate.

Result summary (measured, synthetic, author-written rows): full stack 10/10 blocked and 10/10 completed; M0 baseline 1/10 blocked. Under a 40 req/s flood against a 20 req/s gate, M0 to M3 retain 50.7% of legitimate tasks, M4 and the full stack 100% (149 of 150 via manual fallback, 1 by robot). Caveats: the rows and the capacity model were written by us, the full-stack 10/10 is partly by design, and the "Completed" check only requires the robot payload to have task_id and destination, not that it contains nothing else.

## Systems Engineering Lite
- Needs/requirements/architecture/contracts: `docs/` not created yet. Draft REQ-001..006 inside this file if time is short.
- Top risks: (1) five-method scope vs deadline; (2) synthetic results mistaken for clinical evidence, so label every claim as synthetic; (3) integration left late, so a smoke test runs from hour one.

## Reuse vs on-site (license check required before use)
- **Clinic simulator (disclose to jury):** `clinic3d/` and `output/` (3D fleet console, scenario fixtures, Python replay runner) were generated earlier with an AI coding assistant (commit author "Codex") and imported into this repo on 2026-11-27. Third-party: Three.js (MIT, `clinic3d/vendor/`), Open-RMF map files (Apache-2.0, `output/simulation/open-rmf/LICENSE`). We have **not** independently re-run its results; its numbers are `unverified` until we do.
- Reused: Node.js standard library only (crypto, node:test, fs). No packages installed.
- Built on site (2026-11-27): `gate/gate.cjs` (allowlist, tokens, policy, minimization, breaker, audit chain, simulated robot), `gate/run.cjs` (benchmark), `gate/*.test.cjs`, results page `site/gate-results.html`, and `site/live-simulation.html` (the Live simulation page): the unchanged 3D fleet console with the live attack demo injected (`gate/build-hacker.cjs`; browser copy of the gate; tests assert it answers exactly like the Node gate). Fleet size: a slider sets 3 to 10 robots on duty. The extra seven robots, their parking bays and patrol checkpoints exist only in this page's copy of the fleet controller (`gate/hacker/fleet-extra.cjs`, applied at build time; `clinic3d/` and the original console still have three). Finding: the console's controller deadlocks under random orders (robots waited up to 14 simulated minutes) and cannot cancel a stuck mission, so the demo sends a robot only when a complete route is free (`gate/hacker/fleet-traffic.js`); with that check ten robots ran 900 simulated seconds with no overlap and no waiting (`gate/fleet-extra.test.cjs`). Two scenarios added 2026-11-28: (1) a vendor account (user V1, role vendor, no delivery rights) asks for the lift with no delivery: the gate's new `lift` request type denies it ("no task assigned"), no robot moves, and the audit log records user V1 (`gate/vendor-lift.test.cjs`, plus a demo button); (2) one visible incident: a breaker trip writes an alert record naming the recipient ("Security duty lead") with the evidence, the robots stay isolated with NO automatic reset, and only a supervisor clicking Restore brings them back, after which the next task goes by robot (`gate/incident.test.cjs`, incident card in the demo). Neither scenario is in the measured benchmark; `results.json` is unchanged (a fresh run is identical). Site layout (2026-11-28, redesigned after the reference design the user supplied): five pages, Overview, Live simulation, Lift replay, Incident review and Gate results, with the same header; Incident review (`gate/incident-template.html`) compares the recorded decision of each defence for one request, using `results.json` and the shared `gate/request-meta.json`; the plain `Clinic-World.html` console is no longer published (the Live simulation page replaces it, with the tabs "View the route" and "Open-RMF demo"); `gate/site.test.cjs` checks the navigation and that every link points to a published file. Added by teammates / another session after my last edit; I have read the build notes and run the tests but not watched the demo in a browser.

## Integration heartbeat
- Input fixture: YES (synthetic, in code) · Algorithm invoked: YES (`node gate/run.cjs`) · Tests: `node --test gate/ clinic3d/` 54/54 pass (re-run 2026-11-28) · Backend/API: N/A (static Pages site, gate runs in the browser or as a script) · Frontend consumes real gate: YES in `site/live-simulation.html` (per its build notes and tests; not visually verified by me) · One-command start: open `site/live-simulation.html`; rebuild with `node gate/build-hacker.cjs` · Live demo tested end-to-end by a person: NO · Offline fallback: pages are single-file and work offline; video not recorded

## Pitch and submission
- Core proof: filled only from measured results. Format/duration: TODO (unknown). Slides: `presentation/`. Submission links: TODO.

## Latest decisions
| Date | Decision | Why | Next test |
|---|---|---|---|
| 2026-11-27 | Software-only mock robot, stdlib stack | No hardware, €0, no installs | Smoke test baseline |
| 2026-11-27 | Recorded "hack → whole hospital stops" as the core problem; containment proposed as co-primary | Raised by the user from on-site discussion | Team confirms |
| 2026-11-27 | Claims fixed in public repo: README 10/10 relabelled "imported fixture replay, unverified"; AI-generated/third-party disclosure added (README, NOTICE.md, landing page); organizer brief image removed from the repo (logos, no redistribution licence) | Release audit found overclaim and disclosure gaps | Re-check README before submission. Image later purged from git history (history rewritten and force-pushed 2026-11-27, so older commit IDs changed); GitHub may keep old commits reachable by exact ID until its own cleanup |
| 2026-11-27 | Built gate, benchmark and results page; measured all five methods and the full stack | Plan said measure everything once | Review rows, wire nurse view to gate, record fallback |
| 2026-11-27 | M4 changed from rate limiting + audit log to containment (breaker, isolation, manual mode); audit log became shared plumbing; rows C01–C04 added | User approved the swap; none of the methods had been run, so no result was affected | Build breaker and degraded mode after M0/M1/M3 |

## Next 3 actions
1. A team member watches `site/live-simulation.html` end to end (cold start, realistic resolution) and confirms every claim on screen matches `results.json`.
2. Confirm owners, acceptance bars (10/10, containment >= 80%) and the 11:00 cutoff; write the pitch from measured numbers only and record the offline fallback video.
3. Work is on `origin/master` up to commit 05b47ec (the Pages workflow deploys from it; I have not checked the live site). Only this `HACKATHON.md` fix is uncommitted. Submission to organizers needs the team's approval.
