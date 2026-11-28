"use strict";
// Traffic check for the live hack demo's fleet.
// The fleet controller reserves lanes first-come first-served and cannot cancel a mission that is stuck waiting. Two robots that
// need each other's lane block each other for good. So the demo never sends a robot unless a complete route is free right now.
// This mirrors the controller's own rules (clinic3d/fleet.js: claims, pathTo, lift zone) and also counts routes the demo has just
// ordered but the controller has not reserved yet. The same file is used by the page and by the tests.
const FleetTraffic = (function () {
  function make(network) {
    const nodes = network.nodes, adjacent = new Map(Object.keys(nodes).map(k => [k, []]));
    for (const [a, b] of network.edges) adjacent.get(a).push(b);
    const liftZone = new Set(network.cabins);
    for (const cabin of network.cabins) for (const neighbour of adjacent.get(cabin)) liftZone.add(neighbour);
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

    // Same cheapest-route search as the controller (pathTo).
    function pathTo(start, goal, blocked) {
      if (start === goal) return [];
      const costs = new Map([[start, 0]]), previous = new Map(), open = new Set([start]);
      while (open.size) {
        let current = null;
        for (const n of open) if (current === null || costs.get(n) < costs.get(current)) current = n;
        if (current === goal) { const path = []; while (current !== start) { path.push(current); current = previous.get(current); } return path.reverse(); }
        open.delete(current);
        for (const next of adjacent.get(current)) {
          if (blocked.has(next)) continue;
          const cost = costs.get(current) + distance(nodes[current], nodes[next]);
          if (cost >= (costs.get(next) ?? Infinity)) continue;
          costs.set(next, cost); previous.set(next, current); open.add(next);
        }
      }
      return null;
    }
    // Nodes a robot holds: where it stands, its reserved route, and the whole lift zone when it is in or at the lift.
    function claims(robot, planned) {
      const set = new Set([robot.at]);
      for (const n of robot.path || []) set.add(n);
      if (planned) for (const n of planned) set.add(n);
      if ([...set].some(n => liftZone.has(n))) for (const n of liftZone) set.add(n);
      return set;
    }
    // robots: snapshot robots. planned: Map(robot id -> nodes the demo ordered but the controller has not reserved yet).
    // Returns the route (list of nodes) if a complete route to the station is free right now, otherwise null.
    function routeFree(robots, robotId, station, planned) {
      const me = robots.find(r => r.id === robotId), goal = network.stations[station] && network.stations[station].node;
      if (!me || !goal || me.at === goal) return null;
      const blocked = new Set();
      for (const o of robots) if (o.id !== robotId) for (const n of claims(o, planned && planned.get(o.id))) blocked.add(n);
      if (blocked.has(goal) || blocked.has(me.at)) return null;
      return pathTo(me.at, goal, blocked);
    }
    return {routeFree, claims, pathTo, liftZone};
  }
  return {make};
})();
if (typeof module !== "undefined" && module.exports) module.exports = FleetTraffic;
