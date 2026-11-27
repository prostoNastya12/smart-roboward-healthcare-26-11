# Smart RoboWard test matrix (fictional data only)

Status: **measured 2026-11-27** with `node gate/run.cjs` (seed 2611, Node v26.13.1). Observed/Pass columns show the **full stack (M1+M2+M3+M4)**; per-method results are in `experiments/runs/latest/results.json` and `site/gate-results.html`. Rows were written by the team before the first run. They are synthetic, author-written attacks, so passing shows the implementation matches the design, not real-world security. Seed, command and config go in `experiments/runs/` once measured.

Definitions
- **Blocked before disclosure or action** = robot performs no movement/pickup/unlock AND the response/log reveals no patient data (name, diagnosis, bed-to-patient link, medication).
- **Completed** = authorized task reaches `DELIVERED` and the nurse view shows its status; robot payload contained only `task_id` + `destination`.

| ID | Type | Request (synthetic) | Expected | Observed | Pass |
|---|---|---|---|---|---|
| U01 | Unauthorized | No token | Block, 401, no action | blocked: missing token | pass |
| U02 | Unauthorized | Forged signature | Block | blocked: bad signature | pass |
| U03 | Unauthorized | Expired token | Block | blocked: expired token | pass |
| U04 | Unauthorized | Replay of already-used token | Block | blocked: replayed token | pass |
| U05 | Unauthorized | Valid nurse, wrong ward | Block | blocked: destination outside user's ward | pass |
| U06 | Unauthorized | Valid token, tampered destination | Block (signature mismatch) | blocked: token does not match request | pass |
| U07 | Unauthorized | Payload includes extra patient field (name) | Reject; field never stored or forwarded | blocked: unknown field rejected | pass |
| U08 | Unauthorized | Task ID not in active task list | Block | blocked: unknown task | pass |
| U09 | Unauthorized | Revoked/disabled user | Block | blocked: unknown or revoked user | pass |
| U10 | Unauthorized | Burst of 20 requests/s from one source | Rate-limited; no action beyond limit | 0/20 reached the robot | pass |
| A01 | Authorized | Nurse N1, task T1 → Room 12 | Delivered, status visible | delivered | pass |
| A02 | Authorized | Nurse N1, task T2 → Pharmacy | Delivered | delivered | pass |
| A03 | Authorized | Nurse N2, task T3 → Lab | Delivered | delivered | pass |
| A04 | Authorized | Nurse N2, task T4 → Room 7 | Delivered | delivered | pass |
| A05 | Authorized | Porter P1, linen task → Storage | Delivered | delivered | pass |
| A06 | Authorized | Nurse N1 re-issues new token for new task | Delivered | delivered | pass |
| A07 | Authorized | Token near (not past) expiry | Delivered | delivered | pass |
| A08 | Authorized | Nurse tracks own task status | Status shown, no patient data | status minimal | pass |
| A09 | Authorized | Two valid tasks back to back | Both delivered | both delivered | pass |
| A10 | Authorized | Nurse cancels own task | Cancelled, logged | cancelled and logged | pass |

## Containment scenarios (added 2026-11-27 before any run; scored separately from the 20 rows above)
Core problem: a hack must not stop the whole hospital. "Ward actions" = nurse view loads, a task can be created as manual, status can be read, and a task can be cancelled.

| ID | Scenario (synthetic) | Expected | Observed | Pass |
|---|---|---|---|---|
| C01 | Attack burst trips the breaker | Robot zone isolated; zero further forwards to robot | tripped=true, forwards after trip=0 | pass |
| C02 | Ward actions during isolation | All four ward actions still succeed | ward actions ok 4/4 while isolated=true | pass |
| C03 | Compromised robot sends unexpected/oversized messages | Gate drops them; robot cannot reach ward data or the audit log | ward data unchanged=true, audit stayed small=true | pass |
| C04 | Authorized manual reset after the attack ends | Robot zone re-enabled; next legitimate task delivered | nurse reset=false, supervisor reset=true, next task robot | pass |

Containment measures (leave blank until measured):
- **Retained service level** = legitimate tasks handled during the attack window ÷ tasks handled in an equal-length no-attack window, same seed and workload. Proposed acceptance ≥ 80% (team to confirm). Report robot-delivered and manual-fallback counts separately. Run for every method (measured, synthetic): M0 50.7%, M1 50.7%, M2 50.7%, M3 50.7%, M4 100%, ALL 100%. Capacity model: gate evaluates 20 requests/s, 5 legitimate + 40 attack requests/s, 30 s windows.
- Ward actions still succeeded while isolated: 4/4 · time from first attack request to isolation: 89 ms (simulated clock) · robot-delivered 1 / manual 149 during the attack window.

Headline (leave blank until measured)
- Unauthorized blocked before disclosure or action: 10/10 (100%) full stack; baseline M0 1/10 (measured, synthetic)
- Legitimate tasks completed: 10/10 (all methods 10,10,10,10,10,10) (measured, synthetic)
- Containment scenarios passed: 4/4 full stack and M4 alone (n/a for methods without a breaker; C03 only: M0 fail, M3 pass)
