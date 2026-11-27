# Smart RoboWard test matrix (fictional data only)

Status: **planned**. Observed/Pass columns are intentionally blank until run. Seed, command and config go in `experiments/runs/` once measured.

Definitions
- **Blocked before disclosure or action** = robot performs no movement/pickup/unlock AND the response/log reveals no patient data (name, diagnosis, bed-to-patient link, medication).
- **Completed** = authorized task reaches `DELIVERED` and the nurse view shows its status; robot payload contained only `task_id` + `destination`.

| ID | Type | Request (synthetic) | Expected | Observed | Pass |
|---|---|---|---|---|---|
| U01 | Unauthorized | No token | Block, 401, no action | | |
| U02 | Unauthorized | Forged signature | Block | | |
| U03 | Unauthorized | Expired token | Block | | |
| U04 | Unauthorized | Replay of already-used token | Block | | |
| U05 | Unauthorized | Valid nurse, wrong ward | Block | | |
| U06 | Unauthorized | Valid token, tampered destination | Block (signature mismatch) | | |
| U07 | Unauthorized | Payload includes extra patient field (name) | Reject; field never stored or forwarded | | |
| U08 | Unauthorized | Task ID not in active task list | Block | | |
| U09 | Unauthorized | Revoked/disabled user | Block | | |
| U10 | Unauthorized | Burst of 20 requests/s from one source | Rate-limited; no action beyond limit | | |
| A01 | Authorized | Nurse N1, task T1 → Room 12 | Delivered, status visible | | |
| A02 | Authorized | Nurse N1, task T2 → Pharmacy | Delivered | | |
| A03 | Authorized | Nurse N2, task T3 → Lab | Delivered | | |
| A04 | Authorized | Nurse N2, task T4 → Room 7 | Delivered | | |
| A05 | Authorized | Porter P1, linen task → Storage | Delivered | | |
| A06 | Authorized | Nurse N1 re-issues new token for new task | Delivered | | |
| A07 | Authorized | Token near (not past) expiry | Delivered | | |
| A08 | Authorized | Nurse tracks own task status | Status shown, no patient data | | |
| A09 | Authorized | Two valid tasks back to back | Both delivered | | |
| A10 | Authorized | Nurse cancels own task | Cancelled, logged | | |

## Containment scenarios (added 2026-11-27 before any run; scored separately from the 20 rows above)
Core problem: a hack must not stop the whole hospital. "Ward actions" = nurse view loads, a task can be created as manual, status can be read, and a task can be cancelled.

| ID | Scenario (synthetic) | Expected | Observed | Pass |
|---|---|---|---|---|
| C01 | Attack burst trips the breaker | Robot zone isolated; zero further forwards to robot | | |
| C02 | Ward actions during isolation | All four ward actions still succeed | | |
| C03 | Compromised robot sends unexpected/oversized messages | Gate drops them; robot cannot reach ward data or the audit log | | |
| C04 | Authorized manual reset after the attack ends | Robot zone re-enabled; next legitimate task delivered | | |

Containment measures (leave blank until measured):
- **Retained service level** = legitimate tasks handled during the attack window ÷ tasks handled in an equal-length no-attack window, same seed and workload. Proposed acceptance ≥ 80% (team to confirm). Report robot-delivered and manual-fallback counts separately. Run it for every method (M0–M4) so the comparison is fair: __% each.
- Ward actions still succeeded during attack __/4 · time from first attack request to isolation __ ms · audit entries for the event __.

Headline (leave blank until measured)
- Unauthorized blocked before disclosure or action: __/10 (__%)
- Legitimate tasks completed: __/10
- Containment scenarios passed: __/4
