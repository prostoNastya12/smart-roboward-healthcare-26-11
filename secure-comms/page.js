// Page logic for site/security-pipelines.html. Shows the saved measurement and re-runs any case with the same code in the browser.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const saved = JSON.parse($("saved").textContent);
  const ids = Object.keys(saved.pipelines);
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
  const cases = [...SecureAttacks.ATTACKS.map(a => ({...a, kind: "attack"})), ...SecureAttacks.LEGIT.map(l => ({...l, kind: "legit"}))];
  const positions = {OUT: "outside the network", PATH: "on the network path", DEV: "a compromised robot", FLEET: "the compromised fleet manager",
    LEAK: "keys stolen later", LOG: "write access to the log", NONE: "a careless sender", DISPATCHER: "the compromised dispatcher"};
  let results = saved.results, chosen = saved.decision.winner, selected = null;
  const outcome = (id, c) => c.kind === "attack" ? results[id].attacks[c.id] : results[id].legit[c.id];
  const good = (c, r) => c.kind === "attack" ? r.blocked : r.pass;

  function renderDecision() {
    const s = results[chosen].summary, runner = saved.decision.eligible[1], out = ids.filter(id => !saved.decision.eligible.includes(id) && !saved.pipelines[id].extension);
    const extension = ids.find(id => saved.pipelines[id].extension);
    $("n-chosen").textContent = chosen; $("n-pipes").textContent = ids.length;
    $("decision").replaceChildren(el("div", chosen, "big"),
      el("h2", "Chosen: " + saved.pipelines[chosen].name + ". It blocked " + s.blocked + " of " + s.of + " attacks and passed " + s.legitPassed + " of " + s.legitOf + " legitimate cases."),
      el("p", "The rule was fixed before the first run. A pipeline that fails a legitimate case is out" + (out.length ? " (" + out.join(" and ") + ")" : "") +
        ". Among the rest, the most attacks blocked wins. Next best: " + runner + " with " + results[runner].summary.blocked + " of " + results[runner].summary.of +
        ". The price of " + chosen + " is " + SecureInfo[chosen].needs.length + " things to obtain from suppliers and " + results[chosen].cost.bytesPerCall + " bytes per lift call." +
        (extension ? " Pipeline " + extension + " is " + chosen + " plus a second signature from the clinical order system. We added it after the first results to close one known limit. It is reported, not a candidate." : "")));
  }
  function renderMatrix() {
    const head = $("matrix").tHead, body = $("matrix").tBodies[0], foot = $("matrix").tFoot;
    const hr = el("tr"); hr.append(el("th", "Attack"));
    ids.forEach(id => { const th = el("th", id + " · " + saved.pipelines[id].short, id === chosen ? "chosen" : ""); th.scope = "col"; hr.append(th); });
    head.replaceChildren(hr);
    const rows = [];
    const group = title => { const tr = el("tr", null, "group"); const th = el("th", title); th.colSpan = ids.length + 1; tr.append(th); return tr; };
    const row = c => {
      const tr = el("tr", null, c.limit ? "limit" : ""), th = el("th"); th.scope = "row";
      th.append(el("b", c.id), document.createTextNode(c.name));
      if (c.position) th.append(el("small", "Attacker: " + positions[c.position]));
      tr.append(th);
      ids.forEach(id => {
        const r = outcome(id, c), ok = good(c, r), td = el("td"), b = el("button", ok ? "✓" : "✗", "cell " + (ok ? "ok" : "bad"));
        b.type = "button"; b.title = r.detail;
        b.setAttribute("aria-label", c.id + " on " + id + ": " + (c.kind === "attack" ? (ok ? "blocked" : "got through") : (ok ? "passed" : "failed")) + ". " + r.detail);
        b.setAttribute("aria-pressed", String(selected === id + c.id));
        b.addEventListener("click", () => pick(id, c.id, true));
        td.append(b); tr.append(td);
      });
      return tr;
    };
    rows.push(group("Attacks"), ...cases.filter(c => c.kind === "attack" && !c.limit).map(row));
    rows.push(group("Known limits, expected to get through"), ...cases.filter(c => c.limit).map(row));
    rows.push(group("Legitimate work that must still succeed"), ...cases.filter(c => c.kind === "legit").map(row));
    body.replaceChildren(...rows);
    const total = (label, value, cls) => { const tr = el("tr", null, cls); const th = el("th", label); th.scope = "row"; tr.append(th);
      ids.forEach(id => tr.append(el("td", value(id), id === chosen ? "chosen" : ""))); return tr; };
    foot.replaceChildren(
      total("Attacks blocked", id => results[id].summary.blocked + " / " + results[id].summary.of),
      total("Legitimate cases passed", id => results[id].summary.legitPassed + " / " + results[id].summary.legitOf),
      total("Bytes per lift call, both hops", id => saved.results[id].cost.bytesPerCall.toLocaleString("en"), "plain"),
      total("Extra bytes to open a connection", id => saved.results[id].cost.setupBytes.toLocaleString("en"), "plain"),
      total("Processing per call, saved run", id => saved.results[id].cost.msPerCall + " ms", "plain"),
      total("Things to obtain from suppliers", id => String(SecureInfo[id].needs.length), "plain"));
  }
  function renderPipes() {
    $("pipes").replaceChildren(...ids.map(id => {
      const info = SecureInfo[id], s = results[id].summary, card = el("section", null, "ops-card pipe" + (id === chosen ? " chosen" : ""));
      const h = el("h3"); h.append(el("b", id), document.createTextNode(saved.pipelines[id].name));
      const dl = el("dl");
      [["Attacks blocked", s.blocked + " / " + s.of], ["Legitimate", s.legitPassed + " / " + s.legitOf], ["Keys", info.keys]].forEach(([k, v]) => dl.append(el("dt", k), el("dd", v)));
      const needs = el("ul"); (info.needs.length ? info.needs : ["Nothing new"]).forEach(n => needs.append(el("li", n)));
      card.append(h, el("span", info.source, "src"), el("p", info.idea), dl, el("p", "Needs:"), needs, el("p", "Weakest point: " + info.weakest, "weak"));
      return card;
    }));
  }
  function renderLimits() {
    const items = cases.filter(c => c.limit).map(c => {
      const stops = ids.filter(id => outcome(id, c).blocked);
      return c.id + " · " + c.name + ". In " + chosen + ": " + outcome(chosen, c).detail + ". " + (stops.length ? "Stopped only by " + stops.join(", ") + "." : "No pipeline here stops it.");
    });
    items.push("A compromised lift adapter or hospital certificate authority. Both are trusted by every design above.",
      "Radio jamming and physical tampering with a robot. These need physical and operational measures.",
      "The network admission step in B and the adapter's capacity in the flood are models. Everything else executes.",
      "Timing was measured once on one laptop. Treat it as an order of magnitude.");
    $("limits").replaceChildren(...items.map(t => el("li", t)));
  }

  // ---- live wire ----
  const short = text => text.length > 300 ? text.slice(0, 300) + " … (" + text.length + " characters)" : text;
  async function run(id, caseId) {
    const c = cases.find(x => x.id === caseId), worlds = [];
    SecureAttacks.observe(w => worlds.push(w));
    let r;
    try { r = await c.run(id); } finally { SecureAttacks.observe(null); }
    return {c, r, worlds};
  }
  async function pick(id, caseId, andRun) {
    selected = id + caseId;
    $("wire-pipe").value = id; $("wire-case").value = caseId;
    document.querySelectorAll(".matrix button.cell").forEach(b => b.setAttribute("aria-pressed", String(b.getAttribute("aria-label").startsWith(caseId + " on " + id + ":"))));
    const c = cases.find(x => x.id === caseId);
    $("wire-ref").textContent = caseId + " · pipeline " + id;
    $("wire-what").textContent = c.kind === "attack" ? "Attacker: " + positions[c.position] + ". The attacker wins if: " + c.wins.charAt(0).toLowerCase() + c.wins.slice(1) + "." : "Legitimate case. It must succeed.";
    if (!andRun) return;
    $("wire-run").disabled = true;
    $("wire-verdict").className = "wire-verdict"; $("wire-verdict").textContent = "Running…";
    try {
      const {r, worlds} = await run(id, caseId), ok = good(c, r), w = worlds.at(-1);
      $("wire-verdict").className = "wire-verdict " + (ok ? "ok" : "bad");
      $("wire-verdict").textContent = (c.kind === "attack" ? (ok ? "Blocked. " : "Got through. ") : (ok ? "Passed. " : "Failed. ")) + r.detail + ".";
      const frames = w ? w.net.captured.slice(0, 14) : [];
      $("wire-frames").replaceChildren(...(frames.length ? frames.map(f => {
        const sealed = /"t":"rec"/.test(f.frame), li = el("li", null, sealed ? "sealed" : /rawFloor|decision/.test(f.frame) ? "clear" : "");
        li.append(el("span", f.hop + " · " + f.origin + " → " + f.to), el("span", short(f.frame)));
        return li;
      }) : [el("li", "No frame was accepted onto the network.", "none")]));
      $("wire-lift").textContent = w && w.lift.calls.length ? w.lift.calls.slice(0, 6).map(k => k.robot + " · " + k.trip + " · floor " + k.floor).join("  |  ") +
        (w.lift.calls.length > 6 ? "  | … " + w.lift.calls.length + " calls" : "") : "No call reached the lift.";
    } catch (error) {
      $("wire-verdict").className = "wire-verdict bad";
      $("wire-verdict").textContent = "Could not run here: " + error.message + ". This browser may lack Ed25519 or X25519 in Web Crypto. The saved results above still apply.";
    }
    $("wire-run").disabled = false;
  }
  ids.forEach(id => { const o = el("option", id + " · " + saved.pipelines[id].name); o.value = id; $("wire-pipe").append(o); });
  cases.forEach(c => { const o = el("option", c.id + " · " + c.name); o.value = c.id; $("wire-case").append(o); });
  $("wire-run").addEventListener("click", () => pick($("wire-pipe").value, $("wire-case").value, true));
  ["wire-pipe", "wire-case"].forEach(id => $(id).addEventListener("change", () => pick($("wire-pipe").value, $("wire-case").value, false)));

  $("rerun").addEventListener("click", async () => {
    $("rerun").disabled = true;
    const fresh = {}, differences = [];
    try {
      for (const id of ids) {
        $("rerun-status").textContent = "Running pipeline " + id + "…";
        fresh[id] = await SecureAttacks.runPipeline(id, {skipCost: true});
        for (const c of cases) {
          const before = good(c, outcome(id, c)), after = good(c, c.kind === "attack" ? fresh[id].attacks[c.id] : fresh[id].legit[c.id]);
          if (before !== after) differences.push(c.id + " on " + id);
        }
      }
      results = fresh;
      $("matrix-source").textContent = "run in this browser just now";
      renderMatrix(); renderPipes();
      $("rerun-status").textContent = differences.length ? "Finished. Different from the saved run: " + differences.join(", ") + "."
        : "Finished. All " + (cases.length * ids.length) + " outcomes match the saved run.";
    } catch (error) { $("rerun-status").textContent = "Could not run here: " + error.message; }
    $("rerun").disabled = false;
  });

  $("n-attacks").textContent = SecureAttacks.ATTACKS.length;
  renderDecision(); renderMatrix(); renderPipes(); renderLimits();
  pick(chosen, "T07", false);
})();
