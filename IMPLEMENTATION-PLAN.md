# Smart RoboWard implementation plan

**Status on 27 November 2026, 22:45 CET · Submission 28 November 2026, 11:00 CET · IFOHRA Challenge 9**

This page says what exists, what is left before the deadline, and what comes after the hackathon. Every result below comes from local simulation with fictional data.

## The product in one paragraph

A hospital robot asks a shared lift for a floor. Smart RoboWard answers three questions before the lift moves. Is this request really from an authorized sender? Does the current delivery permit this floor on this lift right now? Who holds the parcel if the trip stops? The project has two halves that now live in one repository.

| Half | Question it answers | Where | Entry point |
| --- | --- | --- | --- |
| Request gate (teammate) | Is the order authentic, permitted and minimal? Does the ward keep working under attack? | `gate/`, `experiments/` | `site/hacker-demo.html`, `site/gate-results.html` |
| Ward safety control room (ours) | May RX-01 call Lift 1 for this trip? What does staff do on a hold? | `ward-safety/` | `ward-safety/index.html` |
| Shared simulator (imported) | Robots, lanes, lift, clinic map | `clinic3d/`, `output/` | `output/visualizations/Clinic-World.html` |

## Where we are

| Piece | State | Evidence |
| --- | --- | --- |
| Five gate methods and full stack | Done, measured | Full stack blocks 10/10 forged requests and completes 10/10 legitimate ones. Under flood, containment retains 100% of tasks, 149 of 150 by manual fallback. `experiments/runs/latest/results.json` |
| Live hack demo in the 3D console | Done | `gate/hacker.test.cjs`, `gate/fleet-demo.test.cjs` |
| Lift admission controller, five rounds | Done | `ward-safety/controller.test.cjs` |
| Policy preview, custody ledger, two-vendor lift queue | Done | `ward-safety/workflows.test.cjs` |
| 10,000-mission study | Done | Advisory detects 90/100 equipment holds and 96/100 wrong destinations at 1.39 false alerts per 100 benign missions. Baseline detects 0/100 and 96/100. `ward-safety/study-summary.json` |
| Control room page | **Done on 27 November.** All five rounds, recovery actions, porter handoff, both floors, heatmap and workflow tables were exercised in a browser | `ward-safety/build.test.cjs` |
| Request gate in front of the control room | Done. The nurse's order passes `gate/gate.cjs` before dispatch. A forged order is refused and the source isolated after five tries | Browser check |
| Landing page, shared header and Pages workflow link to the control room | Done on the feature branch | `site/ward-safety.html` |
| Branch integration | `master` (up to `c7e6a88`) is merged into `feature/ward-safety-console` | 39 Node tests pass. Python replay matches 20/20 cases |
| Pull request into `master` | **Open, waiting for review.** Merging deploys the public site | [Pull request 1](https://github.com/prostoNastya12/smart-roboward-healthcare-26-11/pull/1) |
| Dry run from a local copy of the published site | Done. Hack demo: 194 attacks, 194 stopped, 0 through. Control room: all five rounds | Not yet repeated on the presentation laptop |
| Slides and talk track | Done. Seven slides, layout audit clean at three screen sizes | `presentation/demo.html`, `presentation/SCRIPT.md` |
| Fallback video | Done. 76 seconds, narrated, recorded from the real pages | `presentation/media/smart-roboward-demo-v1.mp4` |
| German jury summary | Done | `docs/Zusammenfassung-DE.md` |

## Before the deadline

Work in this order. Each step has one owner and a check.

| # | Task | Owner | Done when | Latest |
| --- | --- | --- | --- | --- |
| 1 | Review and merge pull request 1 into `master` | Teammate who owns the repository | Pages deploy is green and `ward-safety.html` opens from the live landing page | 28 Nov 08:00 |
| 2 | Repeat the dry run on the presentation laptop with Wi-Fi off | Claude-proficient manager | Slides, video, hack demo and all five rounds run from a fresh browser | 28 Nov 08:30 |
| 3 | Watch the fallback video once with sound and rehearse the talk track | Product manager | Timed at or under the pitch slot. Pace and voice judged by a person | 28 Nov 09:15 |
| 4 | Confirm the pitch length and deadline with the organizers, add team names to slide 7 if wanted | Product manager | Answer written into `HACKATHON.md` | 28 Nov 09:30 |
| 5 | Re-read README claims and disclosure, then submit | Whole team | Submission confirmed by the organizers | 28 Nov 10:45 |

### Three-minute demo script

1. **Attack at the door (45 s).** Open the hack demo. The hacker forges and replays orders. The gate blocks them and the nurse's own order still moves a robot. State the measured 10/10 and 10/10.
2. **Right robot, right floor (40 s).** Control room, round *Verified floor mapping*. The fleet says "Upper", the lift says "01", the hospital says L2. Press **To decision**. Allow, one call, one cabin entry, one ward receipt.
3. **Same robot, changed map (30 s).** Round *Unverified map revision*. Hold, zero calls. Facilities verifies the mapping and the trip continues.
4. **Authenticated but wrong (20 s).** Round *Wrong-floor request*. Deny, zero calls. A valid identity alone is too little.
5. **Patients first (30 s).** Round *Patient transfer priority*. Hold. Offer and accept the porter handoff. The ward scans once and custody is visible throughout.
6. **Evidence (15 s).** Trust study. 10,000 simulated missions, 90/100 equipment holds caught where a fixed threshold caught none, and the heatmap separates "never observed" from "rarely used".

## Open decisions

| Decision | Who decides | Default if nobody answers |
| --- | --- | --- |
| Deadline is 11:00 or noon | Product manager with organizers | Plan to 11:00 |
| Publish the planning notebook (research, device policies, evaluation design) in this public repository | Team | Keep it private. It names an advisor and links the organizer's brief image |
| Which round leads the pitch | Product manager, after advisor feedback | Floor mapping, as scripted above |
| Acceptance bars: 10/10 blocked and at least 80% retained service | Team | Keep as proposed in `HACKATHON.md` |

## After the hackathon

The full nine-phase plan (contracts, simulated movement, fleet-wide availability, supplier bench, supervised pilot, handover) stays in the team's planning notebook. The next three steps need a partner.

1. **Supplier bench.** Replace the mock lift with a vendor-supported interface or simulator. Confirm what the installed lift can report and who approves a landing-map change.
2. **Independent evaluation.** Have someone outside the team write attack rows and benign look-alikes, then re-measure the gate and the advisory detector.
3. **Supervised pilot.** One route, one lift, a named custody owner at each step, a false-alert budget agreed with the duty operator, and a privacy review of every exported field.

## Commands

```sh
node --test clinic3d/fleet.test.cjs ward-safety/*.test.cjs gate/*.test.cjs
python3 output/simulation/replay.py --case A01
node ward-safety/build.cjs
node site/build-site.cjs && node gate/build-page.cjs && node gate/build-hacker.cjs
```
