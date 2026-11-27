# Five methods — Smart RoboWard (all status: planned, none implemented or measured)

Shared setup: the same 20 rows in `experiments/test-matrix.md`, the same synthetic data, same metrics (unauthorized blocked before disclosure or action /10; legitimate completed /10), fixed seed, one machine. Rows are fixed before any method is run; no tuning on them. Each method is run alone first (M1–M4 on top of M0's plumbing), then the combined stack is reported as a separate, clearly labelled row.

Core flow all methods plug into: nurse request → gate → mock robot receives `{task_id, destination}` → status → audit.

## M0 — Baseline: static allowlist, no authentication
- **Hypothesis:** the simplest approach (accept any request whose task ID is on the active list) is what many prototypes do; it sets the floor.
- **Mechanism:** lookup of `task_id` in an in-memory active-task set.
- **Expected weakness (a hypothesis, not a result):** forged, replayed, wrong-ward and tampered requests pass if the ID is known.
- **Covers rows:** U08 directly; the rest are expected to expose it.

## M1 — Signed, expiring, single-use task tokens
- **Hypothesis:** cryptographic binding of requester, task, destination and expiry stops forgery, tampering and replay.
- **Mechanism:** HMAC-SHA256 (stdlib `hmac`) over `{user, task_id, destination, expiry, nonce}`; server keeps used nonces; constant-time compare.
- **Targets:** U01–U04, U06, A07.
- **Limits:** a stolen valid token within its lifetime; key management is simulated (local secret, not production).

## M2 — Role and ward policy check (RBAC/ABAC)
- **Hypothesis:** a valid identity is not enough; the requester must be allowed to request this task type for this ward.
- **Mechanism:** small policy table: role (nurse/porter) × ward × task type; deny by default; revoked-user list.
- **Targets:** U05, U09, plus authorized rows A01–A05 to avoid over-blocking.
- **Limits:** policy is hand-written for the fictional ward; no identity provider.

## M3 — Data-minimization gate (strict schema)
- **Hypothesis:** the robot cannot leak what it never receives; enforcing an allowlist schema prevents disclosure by design.
- **Mechanism:** the gate accepts only `task_id` + `destination`; unknown fields are rejected, not forwarded or logged; patient data stays server-side. A scan checks robot payloads and logs for fictional patient strings.
- **Targets:** U07, A08.
- **Limits:** guarantees only for the fields this prototype handles.

## M4 — Containment: circuit breaker, robot-zone isolation, degraded manual mode
*(Replaces the earlier "rate limiting + audit log" M4 on 2026-11-27, because the core problem is that a hack stops the whole hospital. See `HACKATHON.md`.)*
- **Hypothesis:** if the robot subsystem is attacked or compromised, automatically cutting it off from the ward systems keeps patient care running; prevention alone (M1–M3) cannot guarantee this.
- **Mechanism:** a breaker watches per-source request rate and repeated denials (token bucket + denial counter). On trip it (1) isolates the robot zone: the gate stops forwarding anything to the mock robot, (2) switches the nurse view to degraded/manual mode (tasks shown as manual, status still readable, ward actions still work), (3) logs the event, (4) allows a manual reset by an authorized role.
- **Targets:** U10 (burst), containment rows C01–C04 in `test-matrix.md`, and the retained service level (graceful degradation: reduced but non-zero service, proposed bar ≥ 80%).
- **Limits:** simulated in one process; no real network segmentation, so it demonstrates the logic, not a hardened deployment. Trip thresholds are chosen before running and not tuned on the matrix.

## Shared plumbing (not a method, not scored)
Every method runs through the same gate and writes to the same append-only, hash-chained audit log (each entry stores the hash of the previous one; a verify function detects edits). It is plumbing, so audit completeness is reported as a secondary metric for all methods rather than as a candidate. Rate limiting moved into M4's breaker.

## Why these are distinct
Each tests a different mechanism: no control (M0), identity and integrity of the request (M1), authorization (M2), data exposure (M3), containment and continuity of care after a compromise (M4). If M2 turns out to be only a variant of M1 in implementation, that will be recorded here rather than hidden.

## Status table (update only from real runs)
| ID | Planned | Implemented | Measured | Blocked /10 | Completed /10 | Notes |
|---|---|---|---|---|---|---|
| M0 | yes | no | no | __ | __ | |
| M1 | yes | no | no | __ | __ | |
| M2 | yes | no | no | __ | __ | |
| M3 | yes | no | no | __ | __ | |
| M4 | yes | no | no | __ | __ | |
| Combined stack | yes | no | no | __ | __ | separate row |
