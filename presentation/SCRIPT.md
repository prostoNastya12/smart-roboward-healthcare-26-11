# Smart RoboWard talk track

About five and a half minutes at a calm pace. Keys: arrows or space to move, `f` fullscreen, `p` play or pause the video, `m` sound on or off, `t` elapsed time.

The numbers on the slides are written into the deck from `secure-comms/results.json` by `node presentation/build-deck.cjs`. Say once that the devices are simulated and that we wrote the attacks ourselves.

| # | Slide | Seconds | What to say |
| --- | --- | --- | --- |
| 1 | Smart RoboWard | 20 | Hospitals are starting to use delivery robots. If one robot system is hacked today, the safe reaction is to switch everything off. We want a hacked robot system to be a small problem. |
| 2 | Three open questions | 25 | Picture a pharmacy robot at a shared lift, asking for floor two. Who really sent that request? Is floor two part of this delivery? And if we stop the robot, who has the medication now? |
| 3 | We attacked every design | 20 | We did not want to guess which protection is best. So we built every approach we could find, nine in all, and attacked each one in exactly the same way. The rule for choosing was written down before the first run. |
| 4 | Where hospitals start | 25 | An open network is an unlocked door. A guest list at the entrance keeps strangers out, but one hacked device inside can do anything. Our teammate's single-use tickets are like cinema tickets: valid once, for one floor, but whoever copies one gets in. |
| 5 | One defence at a time | 30 | A badge on every message proves who is asking, not whether they may. An armoured van between stops hides everything from outsiders, but the fleet server in the middle opens every parcel. Our own idea is a boarding pass: this robot, this lift, this floor, ten minutes. |
| 6 | Combine them: number one | 30 | No single idea was enough, so we combined them. Van, boarding pass and a guard at the lift stops almost everything. Two signatures stop a hacked dispatcher. And number one puts all of it in a sealed envelope that the courier in the middle cannot open. |
| 7 | The ranking | 20 | Here is the full ranking, weakest to strongest. Number one stops every attack in our main list. The best single defence stops about two thirds. |
| 8 | Demo | 75 | Show the comparison page live if the laptop is ready: scroll through "Nine approaches, ranked", select a cell in the matrix, press Run now. Then run `node secure-comms/network-demo.cjs` in a terminal. Otherwise play the video. |
| 9 | The fleet manager carries it and cannot read it | 25 | The hospital signs the mission and the robot checks it before it moves, so a hacked fleet server cannot send it to the basement. Robot and lift talk in a sealed session the fleet server only carries. Every lift call needs a grant, countersigned by the clinical order system. |
| 10 | What the tests show | 25 | Every attack blocked, every other robot served during a flood, and normal work still works. Three attacks still get through, and we show them. A second reviewer attacked our own code twice, and every break it found is now a test. |
| 11 | What comes next | 15 | Next we need a real lift interface, attacks written by someone else, and one supervised route with a hospital partner. Thank you. |

Total: 330 seconds, about 5 minutes 30 seconds. For a shorter slot, drop slides 4 and 5 and let slide 7 carry the comparison: 4 minutes 30 seconds.

## If asked

- **Did you write the attacks yourselves?** Yes. That is the main weakness of the result. A second reviewer attacked the code twice and we fixed what it found, the page lets anyone re-run each attack, and the next step is attacks written by outsiders.
- **Is the cryptography real?** Yes: Ed25519, X25519, HKDF and AES-256-GCM from the standard library. The devices are simulated. `network-demo.cjs` runs it over real sockets with a separate attacker process.
- **Why not just use TLS?** Pipeline E is that idea. It stopped 12 of 23. It protects each hop, so a compromised fleet manager can still invent lift calls and reroute robots.
- **What does the adopted design cost?** About 19 kilobytes per lift call, a few milliseconds, and the longest list of supplier requirements: keys on robots, a lift adapter that verifies grants, an order system that signs. A hospital can start lower in the table and sees what it gives up.
- **What still gets through?** Traffic timing, a fleet manager that stops relaying (robots pause, the lift stays free for people, porters take over), and a flood from the wired network. A compromised lift adapter or certificate authority is outside what we tested.
- **How do the pitch scenarios map?** Lift held hostage is attack T26. Robot rerouted is attack T25. Both are blocked in the adopted design and get through an encrypted channel alone.
- **What did AI write?** The 3D simulator was generated before the hackathon and imported. The pipelines, attacks, gates, study and pages were written on site with Claude. The README lists both.
