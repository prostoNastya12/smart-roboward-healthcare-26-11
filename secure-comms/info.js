// What each pipeline is, where it comes from and what it costs to run in a hospital. Written by the team, not measured.
// `vendorNeeds` counts the separate capabilities a hospital must obtain from suppliers. It is the tie-break in the selection rule.
(function (root, create) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = create();
  else root.SecureInfo = create();
})(globalThis, function () {
  "use strict";
  return {
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
      keys: "As G, plus one signed order per trip", weakest: "Both the dispatcher and the order system would have to be compromised. Message timing remains visible.", vendorNeeds: 8}
  };
});
