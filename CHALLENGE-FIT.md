# How Smart RoboWard answers Challenge 9

**Written 28 November 2026 from the challenge repository** (`hackathon-white-fish-26/challenge-09-ifohra-oth-amberg-weiden`): its README, the challenge image, the submission templates and the team's pitch PDF in `/presentation/`.

## What the challenge asks

> How can robots in hospitals securely handle sensitive data and stay protected against cyber threats? Participants are asked to develop simple, practical ideas to ensure patient data is kept private, systems are protected from hacking, and data is used safely and responsibly within robot-supported healthcare processes.

Topics: automation in healthcare, IT infrastructure, cybersecurity, IoT security, robotics. The event page names three judging criteria, without weights: creativity, technical skill, feasibility.

The team's pitch adds the story. Delivery robots already call lifts through a digital interface. Their fleet software often runs in the cloud. That is a new door into the hospital. Two scenarios: attackers hold every lift on the top floor while a heart-attack patient waits, and attackers send a robot carrying cancer drugs to the basement.

## Requirement by requirement

| The challenge asks for | What we built | Evidence | Open |
| --- | --- | --- | --- |
| **Patient data is kept private** | Robots send only what a lift needs. Calls travel in a session between robot and lift adapter that the fleet manager and the network cannot read. Logs store fingerprints, not text | "Who sees what" table on the comparison page, attacks T01, T15, T17, T23 | Message timing still shows when a robot talks (T21) |
| **Systems are protected from hacking** | Seven candidate pipelines and two stronger ones, attacked with the same suite. The adopted pipeline treats the cloud fleet manager as untrusted | Attack matrix, `secure-comms/RESULTS.md`, two independent reviews | We wrote the attacks. The devices are simulated |
| **Data is used safely and responsibly** | Every lift call needs a grant for this robot, lift, floor and ten minutes, countersigned by the clinical order system. Every decision is logged, signed, and anchored with an outside witness | T06, T08, T16, T20 and the audit tests | Retention periods and role-based access to the log are policy, not code |
| **Simple, practical ideas** | One rule a hospital can say out loud: *nothing in the middle is trusted, and nothing moves without a signed order*. Each layer has one job, listed on the page | Layer table, supplier requirement list per pipeline | The adopted pipeline asks the most of suppliers |
| **Robot-supported healthcare processes** | Patient transfers keep lift priority. A held delivery goes to a porter. The ward scans once and always sees who holds the parcel | Ward safety control room, legitimate cases L06 and L07 | Not tested with staff |
| **Pitch scenario: lifts held hostage** | A compromised fleet manager cannot make the lift move | T07, T26 | It can stop relaying, which pauses robot deliveries. The lift stays free for people (T27) |
| **Pitch scenario: robot rerouted to steal medication** | The robot checks the hospital's signature on a mission before it moves | T25 | A physically stolen robot is out of scope |
| **Hospital keeps working after a hack** | One robot or one supplier is isolated and replaced. Nothing else is switched off | T14, T22, L07, the teammate's containment benchmark | Not measured in a real incident |

## Against the judging criteria

| Criterion | Our case | Weak point |
| --- | --- | --- |
| Creativity | We did not pick a defence and argue for it. We built the alternatives, attacked them identically, and let the result choose. We kept the attacks that still win in the table | The individual mechanisms are known techniques. The contribution is the combination and the comparison |
| Technical skill | Real signatures, key agreement and authenticated encryption. A handshake with fresh keys. A tunnel through an untrusted relay. A second reviewer broke an earlier version, and those breaks are now tests. A demo over real sockets with a separate attacker process | No hardware, no vendor interface, no formal proof |
| Feasibility | Standard library only, no packages, runs offline in a browser. Supplier requirements are listed per pipeline, so a hospital can start with a cheaper one | The adopted pipeline needs signing keys on robots and a lift adapter that verifies grants. Neither exists in today's products as far as we know |

## What the submission needs

From the challenge repository's README and issue template:

1. Final code and slides on that repository's `main` branch. Slides in `/presentation/`.
2. The README describes the solution, how to run it, and links the demo.
3. One "Final submission" issue, opened once, after the final push.

Prepared: the README follows that structure, a PDF of the slides is in `presentation/`, and the demo video is linked. **Not done on purpose:** nothing was pushed to that repository's `main` and no submission issue was opened. Both are the team's decision. The exact commands are in `IMPLEMENTATION-PLAN.md`, section 11.

One observation for the team: the challenge repository's README contains an API key for the provided AI endpoint in clear text. We did not use it, and it is not copied into this repository.
