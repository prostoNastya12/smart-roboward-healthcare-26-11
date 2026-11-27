# Smart RoboWard · IFOHRA Challenge 9

**Start here.** Open the [3D fleet console](output/visualizations/Clinic-World.html) in Edge, Chrome or Firefox. A laptop with WebGL can run the console offline. The prototype uses fictional ward deliveries, a local robot controller and a shared lift.

## Try a delivery and a security alert

1. Select **RX-01**, choose **Ward B**, and click **Dispatch**. Select **Follow robot** for a close-up. Drag to rotate, right-drag to pan, and scroll or pinch to zoom. Use the floor selector or **Full screen** for a different view. With the canvas focused, the arrow keys rotate, +/− zoom and Home resets the view.
2. Watch the other units. **LAB-02** starts a specimen delivery. **SUP-03** carries supplies. Robots share directed lanes and reserve Lift 1. A paused robot occupies its current space. On arrival, **Confirm ward receipt** closes that delivery.
3. In **Security monitor**, choose **Unexpected spin** and **Run example**. **View alert** shows the measured rotation and the expected command. Try **Heartbeat loss** or **Wrong lift floor** to see how the evidence changes. A device fault can produce these signals too.
4. Select **Isolate robot**, then **End example**. After a fresh heartbeat and stable motion, select **Restore access**. Select **Resume mission** if a trip was interrupted. The communication log retains the alert evidence after recovery.

## Project files

| What you need | Where to find it |
| --- | --- |
| Original challenge and design work | [IFOHRA Challenge 9 brief](docs/IFOHRA-Challenge-9.png) · [121 design cards](docs/C09-design-cards.md) |
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

The primary metric is **unauthorized requests stopped (%)**. Count each test case once. The saved Python run stopped **10 of 10** unauthorized cases and completed **10 of 10** legitimate deliveries. These counts apply to the fictional access-control cases. The three interactive sensor examples in the 3D console demonstrate how the operator sees and responds to an anomaly.

## Rebuild and run the tests

Run these commands from the repository root. Python 3.9+ builds the 3D console and runs the replay. Node.js 20+ runs the fleet tests. Both use their standard libraries.

```sh
python clinic3d/build_model.py
node --test clinic3d/fleet.test.cjs
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
