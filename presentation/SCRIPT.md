# Smart RoboWard talk track

About four and a half minutes at a calm pace. Keys: arrows or space to move, `f` fullscreen, `p` play or pause the video, `m` sound on or off, `t` elapsed time.

The numbers on the slides are written into the deck from `secure-comms/results.json` by `node presentation/build-deck.cjs`. Say once that the devices are simulated and that we wrote the attacks ourselves.

| # | Slide | Seconds | What to say |
| --- | --- | --- | --- |
| 1 | Smart RoboWard | 20 | Hospitals are starting to use delivery robots. If one robot system is hacked today, the safe reaction is to switch everything off. We want a hacked robot system to be a small problem. |
| 2 | Three open questions | 25 | Picture a pharmacy robot at a shared lift, asking for floor two. Who really sent that request? Is floor two part of this delivery? And if we stop the robot, who has the medication now? |
| 3 | We attacked every design | 30 | We did not want to guess which protection is best. So we built seven ways for a robot to talk to a lift, from an open network up to our own layered design, including our teammate's ticket system. We attacked all of them with the same 29 attacks. The rule for choosing was written down before the first run. Then we built two stronger designs on the winner. |
| 4 | Trust nothing in the middle | 40 | Network access control alone stops 3 of 23. Signing every message stops 13: it proves who is asking, not whether they may. Encryption alone stops 12: the supplier's server in the middle is still trusted. Layering everything stops 22. The last step was to stop trusting the fleet manager at all. That design stops all 23. |
| 5 | Demo | 75 | Show the comparison page live if the laptop is ready: select a cell, press Run now, point at the frames on the wire. Then run `node secure-comms/network-demo.cjs` in a terminal. Otherwise play the video. |
| 6 | The fleet manager carries it and cannot read it | 30 | The hospital signs the mission, and the robot checks it before it moves. So a hacked fleet server cannot send the robot to the basement. The robot and the lift talk in a sealed session that the fleet server only carries. So it cannot read where deliveries go, and it cannot call the lift. Every lift call needs a grant for this robot, this lift, this floor, ten minutes, countersigned by the clinical order system. |
| 7 | What the tests show | 30 | All 23 attacks blocked, where the best single defence blocked 15. During a flood from a hacked robot, every other robot's call was served. Normal work still works. Three attacks still get through, and we show them: someone watching message timing, a fleet server that simply stops relaying, and a flood from inside the wired network. And a second reviewer attacked our own code twice. Every break it found is now a test. |
| 8 | What comes next | 20 | Next we need a real lift interface, attacks written by someone else, and one supervised route with a hospital partner. The code, tests and results are public. Thank you. |

Total: 270 seconds, about 4 minutes 30 seconds.

## If asked

- **Did you write the attacks yourselves?** Yes. That is the main weakness of the result. A second reviewer attacked the code twice and we fixed what it found, the page lets anyone re-run each attack, and the next step is attacks written by outsiders.
- **Is the cryptography real?** Yes: Ed25519, X25519, HKDF and AES-256-GCM from the standard library. The devices are simulated. `network-demo.cjs` runs it over real sockets with a separate attacker process.
- **Why not just use TLS?** Pipeline E is that idea. It stopped 12 of 23. It protects each hop, so a compromised fleet manager can still invent lift calls and reroute robots.
- **What does the adopted design cost?** About 19 kilobytes per lift call, a few milliseconds, and the longest list of supplier requirements: keys on robots, a lift adapter that verifies grants, an order system that signs. A hospital can start lower in the table and sees what it gives up.
- **What still gets through?** Traffic timing, a fleet manager that stops relaying (robots pause, the lift stays free for people, porters take over), and a flood from the wired network. A compromised lift adapter or certificate authority is outside what we tested.
- **How do the pitch scenarios map?** Lift held hostage is attack T26. Robot rerouted is attack T25. Both are blocked in the adopted design and get through an encrypted channel alone.
- **What did AI write?** The 3D simulator was generated before the hackathon and imported. The pipelines, attacks, gates, study and pages were written on site with Claude. The README lists both.
