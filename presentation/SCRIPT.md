# Smart RoboWard talk track

About four and a half minutes at a calm pace. Keys: arrows or space to move, `f` fullscreen, `p` play or pause the video, `m` sound on or off, `t` elapsed time.

The numbers on slides 3, 4 and 7 are written into the deck from `secure-comms/results.json` by `node presentation/build-deck.cjs`. Say once that the devices are simulated and that we wrote the attacks ourselves.

| # | Slide | Seconds | What to say |
| --- | --- | --- | --- |
| 1 | Smart RoboWard | 20 | Hospitals are starting to use delivery robots. If one robot system is hacked today, the safe reaction is to switch everything off. Then nurses carry everything by hand. We want a hacked robot to be a small problem. |
| 2 | Three open questions | 25 | Picture a pharmacy robot at a shared lift, asking for floor two. Who really sent that request? Is floor two part of this delivery? And if we stop the robot, who has the medication now? |
| 3 | We attacked seven designs | 30 | We did not want to guess which protection is best. So we built seven ways for a robot to talk to a lift, from an open network up to our own layered design, including our teammate's ticket system. Then we attacked all seven with the same attacks. The rule for choosing a winner was written down before the first run. |
| 4 | Layering beats every single defence | 35 | This is the result. Network access control alone stops two. Signing every message stops ten, because it proves who is asking but not whether they may. Encryption alone also stops ten, because a hacked supplier server is still trusted. Our trip grant stops twelve. Only the combination stops all nineteen. |
| 5 | Demo | 75 | Show the comparison page live if the laptop is ready: select a cell, press Run now, and point at the frames on the wire. Otherwise play the video. |
| 6 | The chosen pipeline | 30 | The dispatcher signs one grant per trip: this robot, this lift, this floor, ten minutes. The robot signs every call with its own key. Both network hops are encrypted with fresh keys. The fleet manager cuts off a robot that floods. And the lift adapter checks the grant, the lift's current status and a sensor at the lift before anything moves. |
| 7 | What the tests show | 30 | All nineteen attacks blocked, where the next best design blocked twelve. During a flood from a hacked robot, every other robot's call was still served. And normal work still works: retries, Wi-Fi handover, changing a key. Two attacks get through every design, including ours, and we show them: a hacked dispatcher, and someone watching message timing. |
| 8 | What comes next | 20 | Next we need a real lift interface, attacks written by someone else, and one supervised route with a hospital partner. The code, tests and results are public. Thank you. |

Total: 265 seconds, about 4 minutes 25 seconds.

## If asked

- **Did you write the attacks yourselves?** Yes. That is the main weakness of the result. The page lets anyone re-run each attack, and the next step is attacks written by outsiders.
- **Is the cryptography real?** Yes: Ed25519, X25519, HKDF and AES-256-GCM from the standard library. The devices and the network are simulated.
- **Why not just use TLS?** Pipeline E is that idea. It stopped ten of nineteen. It protects each hop, so a compromised fleet manager can still invent lift calls, and it says nothing about which floor a robot may ask for.
- **What does the chosen design cost?** Seven things to obtain from suppliers, about four kilobytes per lift call and about a millisecond of processing on a laptop. The supplier requirements are the real cost.
- **What still gets through?** A compromised dispatcher can issue a wrong grant, and an observer can see when a robot talks. A compromised lift adapter or certificate authority is outside what we tested.
- **What did AI write?** The 3D simulator was generated before the hackathon and imported. The pipelines, attacks, gates, study and pages were written on site with Claude. The README lists both.
