# Third-party notices and reuse disclosure

This repository reuses the following third-party material. Licence texts are kept next to the files.

| Material | Where | Licence | Notes |
| --- | --- | --- | --- |
| Three.js r160 (`three.min.js`) | `clinic3d/vendor/three.min.js`, bundled into `output/visualizations/Clinic-World.html` and `site/hacker-demo.html` | MIT, see `clinic3d/vendor/THREE-LICENSE.txt` (Copyright 2010-2023 three.js authors) | Used as supplied. |
| OrbitControls (`OrbitControls.js`) | `clinic3d/vendor/OrbitControls.js`, bundled into `Clinic-World.html` | MIT. This is part of the three.js examples and falls under the same three.js licence, `clinic3d/vendor/THREE-LICENSE.txt`. | The file itself carries no licence header. We have not changed it. |
| Open-RMF clinic map (`clinic.building.yaml`) and floor drawing (`clinic.png`) | `output/simulation/open-rmf/` | Apache-2.0, see `output/simulation/open-rmf/LICENSE` | Taken from Open-RMF `rmf_demos` (https://github.com/open-rmf/rmf_demos#clinic-world). The README describes them as the original map; we have not verified whether they were modified. The 3D model (`Clinic-World.glb`) and the console are derived from this map. |
| Open-RMF wall defaults | referenced by `clinic3d/build_model.py` | Apache-2.0 | Referenced from `rmf_traffic_editor`; no code copied that we know of. |

## AI-generated content

The console, fleet controller, scenario fixtures, replay runner and replay pages (`clinic3d/`, `output/`) were generated with an AI coding assistant before this repository was created. The git history shows the author "Codex". The team has not independently verified the results this code produces. See the "Provenance and disclosure" section of `README.md`.

## Not redistributed

The organizer's brief image is not part of this repository. It contains third-party logos and has no redistribution licence. The rules are on the event page: https://www.bayern-innovativ.de/events-termine/detail/events-termine/healthcare-hackathon-bayern-hacken-bis-der-arzt-kommt-november2026
