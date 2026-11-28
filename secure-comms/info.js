// What each pipeline is, where it comes from and what it costs to run in a hospital. Written by the team, not measured.
// `vendorNeeds` counts the separate capabilities a hospital must obtain from suppliers. It is the tie-break in the selection rule.
(function (root, create) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = create();
  else root.SecureInfo = create();
})(globalThis, function () {
  "use strict";
  const info = {
    A: {source: "Baseline", idea: "Plain messages on the robotics network. The lift adapter accepts any call that names a known trip.",
      needs: [], keys: "None", weakest: "Anyone who can reach the adapter can move the lift.", vendorNeeds: 0},
    B: {source: "Common hospital practice", idea: "Enterprise Wi-Fi admits only enrolled devices. Inside the network, messages are plain. The admission step is modelled.",
      needs: ["Wi-Fi with per-device certificates"], keys: "One Wi-Fi certificate per device",
      weakest: "One compromised device or switch inside the network defeats it.", vendorNeeds: 1},
    C: {source: "Teammate's gate, method M1, real code", idea: "The dispatcher issues a ticket signed with a server secret, bound to robot, trip and floor, valid once.",
      needs: ["Ticket service at the dispatcher", "Lift adapter that checks tickets"], keys: "One server secret",
      weakest: "The ticket is a bearer token sent in clear. Whoever copies it first can use it, and the fleet manager sees every ticket.", vendorNeeds: 2},
    D: {source: "Standard practice", idea: "Every device has its own key and a certificate from the hospital. Each message is signed, numbered and time-stamped.",
      needs: ["Hospital certificate authority", "Robots that hold a key and sign", "Lift adapter that verifies and signs replies"], keys: "One key pair per device",
      weakest: "It proves who is asking, not whether they may. A genuine robot can call the lift for any floor.", vendorNeeds: 3},
    E: {source: "Standard practice, the idea behind mutual TLS", idea: "Both ends prove their certificate, agree fresh keys and encrypt everything on each hop.",
      needs: ["Hospital certificate authority", "Robots, fleet manager and adapter that support mutually authenticated channels", "Revocation list delivered to every endpoint"],
      keys: "One key pair per device, fresh session keys", weakest: "Protection ends at each hop. A compromised fleet manager can invent calls, and a held message is still accepted later.", vendorNeeds: 3},
    F: {source: "Our proposal", idea: "The dispatcher signs a grant for one robot key, lift, floor and time window. The robot signs each call with that key. The adapter checks both.",
      needs: ["Hospital certificate authority", "Signing service at the dispatcher", "Robots that hold a key and sign", "Lift adapter that verifies grants and signs replies"],
      keys: "One key pair per device, one grant per trip", weakest: "Everything travels in clear, and nothing limits a flooding device or checks the lift's current state.", vendorNeeds: 4},
    G: {source: "Combination of E, F, the teammate's M3 and M4, and our lift admission", idea: "Encrypted, mutually authenticated hops. A trip grant checked end to end. Only the fields a lift needs. A breaker per device. Fresh lift status and a sensor reading before the lift moves. A signed log.",
      needs: ["Hospital certificate authority", "Signing service at the dispatcher", "Robots that hold a key, sign, and support authenticated channels", "Fleet manager with a per-robot breaker",
        "Lift adapter that verifies grants, checks lift status and signs its log", "Status feed from facilities", "Presence sensor at the lift lobby"],
      keys: "One key pair per device, one grant per trip, fresh session keys", weakest: "It trusts the dispatcher. A compromised dispatcher can still issue a wrong grant. Message timing remains visible.", vendorNeeds: 7},
    H: {source: "Extension of G, added after the first results", idea: "Everything in G. In addition the lift adapter requires a second signature from the clinical order system, independent of the dispatcher, naming the same robot and floor.",
      needs: ["Everything G needs", "Clinical order system that signs each delivery order"],
      keys: "As G, plus one signed order per trip", weakest: "Both the dispatcher and the order system would have to be compromised. Message timing remains visible.", vendorNeeds: 8},
    I: {source: "Built after the review and the challenge material, on top of H", idea: "Everything in H. The fleet manager becomes a relay that is trusted with nothing: robot and lift adapter share their own encrypted session through it, the robot only accepts missions signed by the hospital, and the adapter keeps its own breaker.",
      needs: ["Everything H needs", "Robots that check a signed mission before moving", "Lift adapter that ends the robot's encrypted session itself", "Firewall rule: only the relay's address reaches the lift adapter"],
      keys: "As H, plus a second set of fresh session keys per robot", weakest: "A compromised fleet manager can still stop relaying, which pauses robot deliveries, and message timing remains visible. The firewall rule is modelled.", vendorNeeds: 11}
  };
  // The same nine approaches in everyday words, for the ranked overview on the page and in the slides.
  // `like` is a picture from daily life, `good` what it stops, `gap` what it leaves open, `short` one line for a slide.
  const plain = {
    A: {name: "Open network", group: "Where hospitals start", like: "An unlocked door.", short: "Anyone who reaches the lift can call it.",
      good: "Nothing. It is the starting point we measure against.", gap: "Anyone who can reach the lift's interface can move the lift."},
    B: {name: "Guest list at the entrance", group: "Where hospitals start", like: "A guest list at the building entrance. Once you are inside, nobody checks again.", short: "Keeps outsiders out. Inside, anything goes.",
      good: "Keeps strangers off the robot network.", gap: "One hacked device inside the network can do everything."},
    C: {name: "Single-use tickets", group: "Where hospitals start", like: "A cinema ticket. Valid once, for one seat. But whoever holds it gets in.", short: "Valid once, for one floor. A copied ticket still works.",
      good: "Stops replayed calls and calls for the wrong floor.", gap: "A copied ticket works for the thief, and the fleet manager sees every ticket."},
    D: {name: "A badge on every message", group: "One defence at a time", like: "A staff badge on every message. It proves who you are, not where you may go.", short: "Proves who is asking. Not whether they may.",
      good: "Nobody can pretend to be another robot or change a message.", gap: "A genuine robot can still ask for any floor, and everything is readable."},
    E: {name: "Armoured van between stops", group: "One defence at a time", like: "An armoured van between each pair of stops. But the depot in the middle opens every parcel.", short: "Nobody outside can read it. The server in the middle can.",
      good: "Nobody on the network can read or change anything.", gap: "A hacked fleet server in the middle can invent lift calls and send robots elsewhere."},
    F: {name: "Boarding pass for one trip", group: "One defence at a time", like: "A boarding pass in your name, for one flight, checked against your ID at the gate.", short: "This robot, this lift, this floor, ten minutes.",
      good: "Only the right robot gets the right floor, and only for this delivery.", gap: "It travels in the open, and nothing stops a flood."},
    G: {name: "Van, boarding pass and a guard", group: "Combine them", like: "The armoured van, the boarding pass, and a guard who checks the lift is really free.", short: "Encryption, trip grant and a check of the lift itself.",
      good: "Almost everything, including floods and acting on old information.", gap: "It still trusts the fleet server to read calls and to hand robots their missions."},
    H: {name: "Two signatures", group: "Combine them", like: "Everything in G, and two signatures on the cheque.", short: "G, and no single system can order a trip alone.",
      good: "A hacked dispatcher alone can no longer send a robot anywhere.", gap: "The fleet server in the middle is still trusted."},
    I: {name: "Sealed envelope, courier cannot open it", group: "Combine them", like: "Everything in H, sent in a sealed envelope. The courier in the middle carries it and cannot open it.", short: "Everything above. Nothing in the middle is trusted.",
      good: "Every attack in our main list. The fleet server cannot read, reroute or call the lift.", gap: "Message timing is visible, the courier can refuse to deliver, and a flood from the wired network still hurts."}
  };
  // What number one is made of, piece by piece, and where each piece comes from.
  const recipe = [
    {piece: "Encrypted, proven connections", from: "E", why: "Nobody on the network can read or change a message"},
    {piece: "A grant for one robot, one floor, ten minutes", from: "F", why: "A genuine robot cannot ask for the wrong floor"},
    {piece: "Only the fields a lift needs", from: "Teammate's gate", why: "Patient data never reaches the lift side"},
    {piece: "A breaker for each robot", from: "Teammate's gate", why: "One flooding robot cannot starve the others"},
    {piece: "A check of the lift itself", from: "Ward safety", why: "Patient transfers first, no decisions on old information"},
    {piece: "A second signature on every order", from: "H", why: "A hacked dispatcher cannot act alone"},
    {piece: "A sealed session past the fleet server", from: "I", why: "The server in the middle cannot read or invent calls"},
    {piece: "Missions the robot checks before it moves", from: "I", why: "A hacked server cannot send the robot to the basement"}
  ];
  for (const id of Object.keys(info)) info[id].plain = plain[id];
  Object.defineProperty(info, "recipe", {value: recipe, enumerable: false});
  return info;
});
