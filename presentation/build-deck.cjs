"use strict";
// Builds presentation/demo.html from deck-template.html with the numbers from secure-comms/results.json.
// Usage: node presentation/build-deck.cjs
const fs = require("node:fs");
const path = require("node:path");

function buildDeck() {
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, "../secure-comms/results.json"), "utf8"));
  const ids = Object.keys(doc.pipelines), r = doc.results, win = doc.decision.adopted, of = r[win].summary.of;
  const next = doc.decision.eligible.find(id => !doc.pipelines[id].extension && doc.results[id].summary.blocked < doc.results[doc.decision.winner].summary.blocked);
  const floodOthers = [...new Set(ids.map(id => r[id].attacks.T14.retainedPct).filter(pct => pct < 90))];
  // Horizontal bars, value written on each bar, the chosen pipeline highlighted.
  const rowH = 62, left = 620, width = 1680, scale = (width - left - 130) / of;
  const bars = '<svg class="bars" viewBox="0 0 ' + width + " " + (ids.length * rowH + 10) + '" role="img" aria-label="Attacks blocked by each pipeline">' + ids.map((id, i) => {
    const n = r[id].summary.blocked, y = i * rowH + 8, hot = id === win;
    return '<g class="' + (hot ? "hot" : "") + '"><text x="0" y="' + (y + 34) + '">' + id + " · " + doc.pipelines[id].name.replace(", mutual authentication", "").replace("Layered pipeline with dual control", "Layered + dual control") + "</text>" +
      '<rect x="' + left + '" y="' + y + '" width="' + Math.max(6, n * scale) + '" height="46" rx="10" fill="' + (hot ? "#c1de94" : "#4d6b60") + '"/>' +
      '<text class="val" x="' + (left + Math.max(6, n * scale) + 18) + '" y="' + (y + 36) + '">' + n + "</text></g>";
  }).join("") + "</svg>";
  const steps = [["Robot", "checks mission, signs call"], ["Sealed tunnel", "robot to lift"], ["Fleet manager", "relays, reads nothing"], ["Sealed tunnel", "robot to lift"], ["Lift adapter", "grant · order · status"]];
  const w = 300, gap = 45;
  const flow = '<svg class="flow" viewBox="0 0 1680 420" role="img" aria-label="A lift call travels in a sealed tunnel from robot to lift adapter through the fleet manager">' + steps.map(([title, sub], i) => {
    const x = i * (w + gap), hot = title !== "Sealed tunnel";
    return '<g class="' + (hot ? "hot" : "") + '"><rect x="' + x + '" y="120" width="' + w + '" height="180" rx="20" fill="' + (hot ? "#c1de94" : "#153a32") + '" stroke="' +
      (hot ? "#c1de94" : "#2c5247") + '" stroke-width="2"/><text x="' + (x + w / 2) + '" y="200" text-anchor="middle">' + title + '</text><text class="sub" x="' + (x + w / 2) +
      '" y="244" text-anchor="middle">' + sub + "</text></g>" + (i < steps.length - 1 ? '<path d="M' + (x + w + 6) + " 210 H" + (x + w + gap - 10) + '" stroke="#b4c8ba" stroke-width="3"/>' : "");
  }).join("") + '<text class="sub" x="840" y="60" text-anchor="middle">Dispatch signs one mission and one grant per trip. The clinical order system countersigns.</text>' +
    '<text class="sub" x="840" y="370" text-anchor="middle">Every decision goes into a signed log. Only the fields a lift needs leave the robot.</text></svg>';
  const values = {PIPELINES: ids.length, ATTACKS: doc.attacks.length, OF: of, BARS: bars, FLOW: flow, WIN_BLOCKED: r[win].summary.blocked, NEXT_BLOCKED: r[next].summary.blocked,
    FLOOD: r[win].attacks.T14.retainedPct, FLOOD_OTHERS: floodOthers.join(" to "), LEGIT: r[win].summary.legitPassed, LEGIT_OF: r[win].summary.legitOf,
    LIMITS: doc.attacks.filter(a => a.limit && !r[win].attacks[a.id].blocked).length + (of - r[win].summary.blocked), CANDIDATES: ids.filter(id => !doc.pipelines[id].extension).length};
  return fs.readFileSync(path.join(__dirname, "deck-template.html"), "utf8").replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    if (!(key in values)) throw Error("Unknown deck value " + key);
    return String(values[key]);
  });
}
if (require.main === module) { fs.writeFileSync(path.join(__dirname, "demo.html"), buildDeck()); console.log("wrote presentation/demo.html"); }
module.exports = {buildDeck};
