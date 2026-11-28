<!-- summary:start -->
# Smart RoboWard · Challenge 9: Secure integration of robotics in clinical environments

**Challenge owner:** IFOHRA and OTH Amberg-Weiden · **Event:** Healthcare Hackathon Bayern München, 26 to 28 November 2026

## Project summary

Hospital delivery robots call lifts over the network, often through fleet software in the cloud. That link is a new door into the hospital. Smart RoboWard secures it.

We did not pick one defence and argue for it. We built seven ways for a robot to ask a lift for a floor, attacked each with the same 29 attacks, and let the result choose. Then we built two stronger designs on the winner. The one we adopted is a **zero-trust relay**: nothing in the middle is trusted, and nothing moves without a signed order.

- The robot only accepts a mission signed by the hospital.
- Every lift call needs a grant for this robot, this lift, this floor and ten minutes, countersigned by the clinical order system.
- Robot and lift adapter talk in a sealed session that the fleet manager carries and cannot read.
- The lift adapter also checks patient priority, fresh lift status and a sensor at the lift, and writes every decision to a signed log.
- A flooding or compromised robot is isolated alone. The rest of the hospital keeps working.

| | Pipeline | Where it comes from | Attacks blocked | Known limits closed |
| --- | --- | --- | --- | --- |
| A | Open network | Baseline | 1 of 23 | 0 of 6 |
| B | Network admission only | Common hospital practice, admission step modelled | 3 of 23 | 0 of 6 |
| C | Signed single-use tickets | Teammate's gate, method M1, real code | 8 of 23 | 0 of 6 |
| D | Per-device signed messages | Standard practice | 13 of 23 | 0 of 6 |
| E | Encrypted channel, mutual authentication | Standard practice, the idea behind mutual TLS | 12 of 23 | 0 of 6 |
| F | Trip capability with proof of possession | Our proposal | 15 of 23 | 0 of 6 |
| G | Layered pipeline | Combination of the above, the teammate's M3 and M4, and our lift admission | 22 of 23 | 0 of 6 |
| H | Layered pipeline with dual control | G plus a second signature from the clinical order system | 22 of 23 | 1 of 6 |
| I | Zero-trust relay | H plus a sealed robot-to-lift session through the fleet manager, signed missions and an adapter-side breaker | 23 of 23 | 3 of 6 |

All nine pass the 9 normal-operation cases. Under the rule fixed before the first run, **G** won among the seven candidates A to G. **I** is built on it and is what the platform uses. What still gets through I: traffic analysis; compromised fleet manager stops relaying; flood the lift adapter from the wired path, posing as the relay.

The cryptography is real (Ed25519, X25519, HKDF, AES-256-GCM, HMAC-SHA-256 from the standard library). The devices, trips and keys are fictional. We wrote the attacks ourselves, and a second reviewer who did not write the code attacked it twice. This is our own measurement, not an independent audit. More: [how this answers the challenge](CHALLENGE-FIT.md) · [measured results](secure-comms/RESULTS.md) · [plan and decisions](IMPLEMENTATION-PLAN.md).

### If a hack still gets through: keep the hospital working

The request gate in `gate/` is the second half of the story. It answers what happens when an attack is not stopped by a design alone. Five methods (M0 allowlist baseline, M1 signed tokens, M2 role and ward policy, M3 data minimization, M4 containment) were run on the same 20 fictional requests and a 40 requests per second flood against a gate that handles 20 (measured, synthetic, rows written by us; `experiments/runs/latest/results.json`). The full stack blocked 10 of 10 unauthorized requests and completed 10 of 10 legitimate ones. Under the flood, M0 to M3 kept 50.7% of legitimate tasks, M4 and the full stack kept 100%, but 149 of 150 of those went through the manual fallback, not by robot. The 3D **Live simulation** shows it: a hacker attacks, the breaker trips, an alert goes to the Security duty lead, the robots stay isolated, and only a supervisor click restores them. A vendor account that asks for the lift with no delivery is denied and logged. These two scenarios are tested (`gate/incident.test.cjs`, `gate/vendor-lift.test.cjs`) but are not part of the measured benchmark.

## How to run

Needs Node.js 20 or newer and Python 3.9 or newer. No packages are installed. Everything runs offline.

```sh
node secure-comms/run.cjs            # attack every pipeline, writes secure-comms/results.json
node secure-comms/network-demo.cjs   # the adopted pipeline over real sockets, with a separate attacker process
node --test clinic3d/fleet.test.cjs ward-safety/*.test.cjs gate/*.test.cjs secure-comms/*.test.cjs
```

Then open these files in a current browser:

| Open | To see |
| --- | --- |
| [site/security-pipelines.html](site/security-pipelines.html) | The attack matrix. Select any cell to run that attack again in the browser and see the frames on the wire |
| [site/ward-safety.html](site/ward-safety.html) | One delivery at the shared lift: allow, hold or deny, with recovery and porter handoff |
| [site/live-simulation.html](site/live-simulation.html) | The 3D clinic with a simulated hacker, the request gate, a 3 to 10 robot slider and a supervisor restore |
| [site/gate-results.html](site/gate-results.html) | The request gate benchmark |
| [site/incident-review.html](site/incident-review.html) | What each defence decided for the same request |
| [site/index.html](site/index.html) | The overview, with links to every page |

## Demo

- Video: [presentation/media/smart-roboward-demo-v2.mp4](presentation/media/smart-roboward-demo-v2.mp4)
- Slides: [presentation/Smart-RoboWard-security-pipelines.pdf](presentation/Smart-RoboWard-security-pipelines.pdf), and the same deck as one offline file, [presentation/demo.html](presentation/demo.html)
- Talk track: [presentation/SCRIPT.md](presentation/SCRIPT.md) · German summary: [docs/Zusammenfassung-DE.md](docs/Zusammenfassung-DE.md)

---

# Details
<!-- summary:end -->

**Start here.** Open the [website](https://prostonastya12.github.io/smart-roboward-healthcare-26-11/) (Overview, Live simulation, Secure pipelines, Ward safety, Lift replay, Incident review, Gate results), or open `site/live-simulation.html` in Edge, Chrome or Firefox. A laptop with WebGL can run the simulation offline. The prototype uses fictional ward deliveries, a local robot controller and a shared lift.

## Provenance and disclosure

- **AI-assisted code and content.** The 3D console, fleet controller, scenario fixtures, replay runner and replay pages in `clinic3d/` and `output/` were generated with an AI coding assistant (ChatGPT / Codex) before this repository was created. The git history shows the author "Codex". `docs/C09-design-cards.md` and the incident-response PDF came from the same AI-assisted workspace, and the team has **not** verified their sources.
- **Third-party code and data.** Three.js r160 and OrbitControls (MIT) and the Open-RMF clinic map files (Apache-2.0). Details and license locations: [NOTICE.md](NOTICE.md).
- **Written by the team.** `HACKATHON.md`, `experiments/`, `gate/` (request gate, benchmark, tests, and the live simulation, written with Claude), `site/` (including the shared page theme `site/theme.css`, copied from the 3D console's design), `.github/workflows/pages.yml` and this section. `output/visualizations/Smart-RoboWard-replay.html` is now rebuilt by the team from `site/replay-template.html`, with the same A01/U02 timelines as the AI-generated fragment `shared-lift-replay.html`. Reproduce the benchmark with `node gate/run.cjs`, run the tests with `node --test gate/`, and rebuild the pages with `node site/build-site.cjs`, `node gate/build-page.cjs` and `node gate/build-hacker.cjs`.
- **Not included.** The organizer's brief image (it carries third-party logos and has no redistribution licence). Read the brief and rules on the [event page](https://www.bayern-innovativ.de/events-termine/detail/events-termine/healthcare-hackathon-bayern-hacken-bis-der-arzt-kommt-november2026).

## Secure communication pipelines

The comparison lives in `secure-comms/`. `comms.js` holds the protocol code for all nine pipelines, `attacks.js` the 29 attacks and 9 legitimate cases, `run.cjs` the measurement, `report.cjs` the generated report, and `network-demo.cjs` the demo over real sockets. Pipeline C runs the teammate's `gate/gate.cjs` unchanged. Pipelines G, H and I run the ward safety controller's admission check unchanged.

Two reviews by a second reviewer, who did not write the code, are summarised in [secure-comms/RESULTS.md](secure-comms/RESULTS.md) with what each finding changed. Findings that could not be fixed are in the matrix as known limits.

```sh
node secure-comms/run.cjs          # measure, writes secure-comms/results.json
node secure-comms/report.cjs       # writes secure-comms/RESULTS.md
node secure-comms/build-page.cjs   # writes site/security-pipelines.html
node presentation/build-deck.cjs   # writes presentation/demo.html with the measured numbers
```

## Ward safety control room

Open [ward-safety/index.html](ward-safety/index.html) in any modern browser. It runs offline from that one file and asks one question: may this robot use the lift?

1. **Pick a situation.** Five buttons: a normal delivery, a changed map, a wrong floor, a patient who needs the lift, a dropped connection.
2. **Read the decision.** One word (Allowed, Wait or Refused), one sentence why, and what staff can do next. **Play** shows the rest of the trip.
3. **See why.** Six checks with a tick or a cross.

| Situation | Decision | Lift calls | What staff can do |
| --- | --- | --- | --- |
| Normal delivery | Allowed | 1 | Play to the ward, then the ward scans the parcel |
| The map changed | Wait | 0 | Confirm the floor names, or give the parcel to a porter |
| Wrong floor | Refused | 0 | Nothing at the lift. Dispatch issues a new order |
| A patient needs the lift | Wait | 0 | Wait for the transfer, or give the parcel to a porter |
| Connection drops | Wait | 0 | Wait for the connection, or give the parcel to a porter |

Everything else is behind three expanders at the bottom: all the detail (every device on the path, the event log, message security, playback controls), the evidence from 10,000 simulated deliveries with a route heatmap, and three other checks (previewing a rule change, tracking the parcel, sharing the lift between suppliers).

The control room was written by the team with Claude. It reuses the imported fleet engine and clinic map. Every number comes from local simulation with fictional data. Rebuild with `node ward-safety/build.cjs` (needs Python 3 for the map and policy replay). The nurse's order passes the request gate from `gate/` before the robot is dispatched, and **Send a forged order** shows a refusal. Under **All the detail**, each situation's lift call is also sent for real through the chosen pipeline, and the page shows whether the answer over the wire agrees with the simulation. The plan and current status are in [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md).

## Pitch materials

| File | Use |
| --- | --- |
| [presentation/demo.html](presentation/demo.html) | Eleven slides in one offline file, built from the measured results by `node presentation/build-deck.cjs`. Arrows to move, `f` fullscreen, `p` play or pause, `m` sound, `t` timer |
| [presentation/SCRIPT.md](presentation/SCRIPT.md) | Talk track, about four minutes |
| [presentation/media/smart-roboward-demo-v1.mp4](presentation/media/smart-roboward-demo-v1.mp4) | 76-second narrated fallback video, recorded from the real pages with a locally generated voice |
| [docs/Zusammenfassung-DE.md](docs/Zusammenfassung-DE.md) | One-page German summary for the jury |

## Try a delivery and a security alert

1. Select **RX-01**, choose **Ward B**, and click **Dispatch**. Select **Follow robot** for a close-up. Drag to rotate, right-drag to pan, and scroll or pinch to zoom. Use the floor selector or **Full screen** for a different view. With the canvas focused, the arrow keys rotate, +/− zoom and Home resets the view.
2. Watch the other units. **LAB-02** starts a specimen delivery. **SUP-03** carries supplies. Robots share directed lanes and reserve Lift 1. A paused robot occupies its current space. On arrival, **Confirm ward receipt** closes that delivery.
3. In **Security monitor**, choose **Unexpected spin** and **Run example**. **View alert** shows the measured rotation and the expected command. Try **Heartbeat loss** or **Wrong lift floor** to see how the evidence changes. A device fault can produce these signals too.
4. Select **Isolate robot**, then **End example**. After a fresh heartbeat and stable motion, select **Restore access**. Select **Resume mission** if a trip was interrupted. The communication log retains the alert evidence after recovery.

## Project files

| What you need | Where to find it |
| --- | --- |
| Original challenge and design work | [IFOHRA Challenge 9 rules (event page)](https://www.bayern-innovativ.de/events-termine/detail/events-termine/healthcare-hackathon-bayern-hacken-bis-der-arzt-kommt-november2026) · [121 design cards](docs/C09-design-cards.md) (sources unverified) |
| Hospital incident and response research | [Hospital AGV incident response](output/pdf/hospital-agv-incident-response.pdf) |
| Shared-lift and parcel-custody walkthrough | [Open the replay](output/visualizations/Smart-RoboWard-replay.html) · [Editable replay fragment](output/visualizations/shared-lift-replay.html) |
| Model for another 3D tool and preview for a presentation | [Clinic World GLB](output/visualizations/Clinic-World.glb) · [Fleet screenshot](output/visualizations/Clinic-World-3D.png) |
| Fictional test inputs and saved results | [20 scenarios](output/simulation/smart-roboward-scenarios.json) · [Results](output/simulation/simulation-results.json) · [Python replay runner](output/simulation/replay.py) |
| Robot control and monitoring rules | [Fleet controller](clinic3d/fleet.js) · [Fleet tests](clinic3d/fleet.test.cjs) · [Metric lane graph](clinic3d/network.json) |
| Editable 3D console | [Page template](clinic3d/clinic-template.html) · [Control panel](clinic3d/fleet-panel.html) · [Styles](clinic3d/fleet.css) · [Controls](clinic3d/fleet-ui.js) · [Robot models](clinic3d/fleet-scene.js) · [Renderer](clinic3d/viewer.js) |
| Map sources and third-party licenses | [Clinic map](output/simulation/open-rmf/clinic.building.yaml) · [Floor drawing](output/simulation/open-rmf/clinic.png) · [Open-RMF license](output/simulation/open-rmf/LICENSE) · [Three.js license](clinic3d/vendor/THREE-LICENSE.txt) |

The **Case replay** tab in the 3D console draws two routes on the floor plans. A01 follows the pharmacy parcel to Ward B. In U02 an urgent transfer gets lift priority and a porter takes custody until the ward scan. The standalone shared-lift replay lets you inspect each handover as a timeline. Only the **Open-RMF demo** tab uses the internet to load the upstream recordings.

## Team context and measures

The four team roles are product manager, robot developer, data scientist and a manager experienced with Claude. The project budget is €0. Robot speeds, devices, scanner events and deliveries are simulated. The scenarios use fictional ward data. [Event rules and schedule](https://www.bayern-innovativ.de/events-termine/detail/events-termine/healthcare-hackathon-bayern-hacken-bis-der-arzt-kommt-november2026)

The primary metric is **unauthorized requests stopped (%)**. Count each test case once.

> **Status of these numbers: imported fixture replay, unverified.** The saved Python run reports **10 of 10** unauthorized cases stopped and **10 of 10** legitimate deliveries completed. Those counts come from replaying 20 scripted fixture cases and comparing them with expected outcomes that were written together with the fixtures. They show that the fixtures and the replay logic agree. They are **not** an independent security measurement, and the replay's checks are not a real authentication gate. The team has since measured its own five-method request gate with its own script on rows it wrote itself: [results](experiments/runs/latest/results.json), summarised in [HACKATHON.md](HACKATHON.md). That is a separate measurement from this fixture replay. The three interactive sensor examples in the 3D console demonstrate how the operator sees and responds to an anomaly. All data is fictional and simulated.

## Rebuild and run the tests

Run these commands from the repository root. Python 3.9+ builds the 3D console and runs the replay. Node.js 20+ runs the fleet tests. Both use their standard libraries.

```sh
python clinic3d/build_model.py
node --test clinic3d/fleet.test.cjs ward-safety/*.test.cjs gate/*.test.cjs secure-comms/*.test.cjs
python output/simulation/replay.py --case A01
python output/simulation/replay.py --case U02
```

The [builder](clinic3d/build_model.py) reads the supplied clinic map, floor drawing, scenario fixture and source template. It regenerates the self-contained viewer, the GLB and `clinic3d/network.json`. The GLB uses meters, mapped floor elevations of 0 m and 10 m, Open-RMF wall defaults and simplified furnishings at mapped positions. The viewer adds the three robot models and exchanges commands, acknowledgements and observations with a local Web Worker. Three.js r160 and OrbitControls are bundled in `clinic3d/vendor/`. [Open-RMF wall generator](https://github.com/open-rmf/rmf_traffic_editor/blob/main/rmf_building_map_tools/building_map/wall.py)

Each replay command runs all 20 cases and displays one timeline. Use `python output/simulation/replay.py --results my-run.json` to write a fresh report. It records the input hash, observed decisions, custody changes, outgoing messages and differences from the expected outcomes.

## How the data drives the replay

- Each case in `smart-roboward-scenarios.json` resets the controller to `initial_state`. It processes `events` in the order listed at their times in seconds. The software checks the device, dispatch, mock permit, ward, payload and lift state before deciding whether to allow, hold or deny a trip.
- Inputs for scanners, sensors, arrivals and physical priority buttons are fictional. The mock lift acknowledges a priority call immediately. Its added response time compares that acknowledgement to a second run with robot lift requests suppressed. Physical door and patient travel times require a separate movement model.
- Expected answers stay in the fixture. The runner computes observed outputs first and checks `expected` afterward. To try your own run, copy the fixture, change an input or remove a ward scan, then use `python output/simulation/replay.py --data my-scenarios.json --case A01`. A discrepancy will be reported if you retain the original expected result.
- Count each case once. An unauthorized case passes the protection metric when all its robot requests are denied, the lift grants none, and the fictional private marker reaches none of the monitored outputs. A legitimate delivery completes when the robot receives one grant and the ward confirms one distinct receipt. The porter's delivery in U02 is recorded separately.

## Run the native Open-RMF demo

The [Open-RMF data folder](output/simulation/open-rmf/) contains the original two-floor clinic map, floor drawing and Apache-2.0 license. The JSON maps the fictional pharmacy and wards to real demo waypoints connected to `lift_1` on navigation graph 0. [Open-RMF Clinic World](https://github.com/open-rmf/rmf_demos#clinic-world)

1. In a sourced ROS 2 environment with the Open-RMF demos installed, run `ros2 launch rmf_demos_gz clinic.launch.xml`. In a second sourced terminal, try `ros2 run rmf_demos_tasks dispatch_patrol -p L1_left_treatment_1 L2_right_nurse_center -n 1 --use_sim_time`. This starts a native patrol. The planner chooses its lift.
2. For the C09 scenario, route the robot through the designated shared lift, connect its access request to the hospital controller, and feed back the simulated lift state, parcel arrival and ward scan. Keep the patient-priority input under facilities control. Re-run A01 and U02 using the movement simulator's events and capture its timing.
3. Use `published_reference` for the R0033-A1's dimensions, mass and payload and for routine delivery-time and workload comparisons. The published pharmacy-to-ward mean is 21 minutes (SD 4.2). The six monthly trip totals cover a fleet of ten robots. Set travel speed and lift-door timing from observations or document your demo assumptions. The current replay uses the fixture's timestamps. [Li et al., Scientific Reports, Tables 2–3](https://doi.org/10.1038/s41598-026-49800-9)

SAITE separately documents the live fleet twin at Qilu Hospital in Qingdao. The open clinic map and fictional events in this pack were sourced independently of that hospital. [SAITE deployment report](https://www.saiterobot.com/dongtai/382.html)
