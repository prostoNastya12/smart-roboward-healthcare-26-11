# Smart RoboWard talk track

About four minutes at a calm pace. Keys: arrows or space to move, `f` fullscreen, `p` play or pause the video, `m` sound on or off, `t` elapsed time.

Every number is from local simulation with fictional data. Say so once on the results slide.

| # | Slide | Seconds | What to say |
| --- | --- | --- | --- |
| 1 | Smart RoboWard | 20 | Hospitals are starting to use delivery robots. If one robot system is hacked today, the safe reaction is to switch everything off. Then nurses carry everything by hand. We want a hacked robot to be a small problem. |
| 2 | Three open questions | 30 | Picture a pharmacy robot at a shared lift, asking for floor two. Who really sent that request? Is floor two part of this delivery? And if we stop the robot, who has the medication now? |
| 3 | Two gates and a fallback | 30 | We built two gates. The first checks every order before it reaches a robot. The second decides every lift call for the current trip. And when automation stops, a porter takes over and the ward still scans exactly once. |
| 4 | Demo | 90 | Play the video with sound, or mute it with `m` and narrate. A simulated hacker floods the clinic and every attack is stopped. Then the same robot is allowed, held, and denied at the lift, and a porter takes over when a patient needs it. Prefer the live pages when the laptop is ready: `hacker-demo.html`, then `ward-safety.html`. |
| 5 | Checked twice | 25 | An order passes the request gate, goes to the fleet with only a task and a destination, and is checked again at the lift. Every decision lands in a log that shows tampering. |
| 6 | What the tests show | 30 | All of this is simulated, with test cases we wrote ourselves. The full gate blocked ten of ten forged requests. Under a flood, the ward kept all of its tasks, almost all by manual fallback, where the unprotected system kept half. And across ten thousand simulated missions, our advisory caught ninety of one hundred stuck robots. A fixed threshold caught none. |
| 7 | What comes next | 20 | Next we need a real lift interface, attacks written by someone else, and one supervised route with a hospital partner. The code, tests and results are public. Thank you. |

Total: 245 seconds, about 4 minutes 5 seconds.

## If asked

- **Is 100% realistic?** It is retained service, counted as robot or manual delivery. 149 of 150 tasks were manual during the flood. The robots were isolated on purpose.
- **Why did the baseline catch no stuck robots?** It uses one dwell limit for every place. Lift queues are slow by nature, so the limit has to be loose.
- **What did AI write?** The 3D simulator was generated before the hackathon and imported. The gates, the study and the pages were written on site with Claude. The README lists both.
- **What was left out of the slides?** The policy preview, the reusable-tote custody checks and the two-vendor lift queue. They are in the control room under Workflow review.
