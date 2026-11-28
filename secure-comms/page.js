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
  // `chosen` is the design the platform uses: the strongest overall. `ruleWinner` is the winner among the seven original candidates.
  let results = saved.results, chosen = saved.decision.adopted, selected = null;
  const ruleWinner = saved.decision.winner;
  const outcome = (id, c) => c.kind === "attack" ? results[id].attacks[c.id] : results[id].legit[c.id];
  const good = (c, r) => c.kind === "attack" ? r.blocked : r.pass;

  function renderDecision() {
    const s = results[chosen].summary, w = results[ruleWinner].summary, runner = saved.decision.eligible[1];
    $("n-chosen").textContent = chosen; $("n-pipes").textContent = ids.length;
    $("decision").replaceChildren(el("div", chosen, "big"),
      el("h2", "Adopted: " + saved.pipelines[chosen].name + ". It blocked " + s.blocked + " of " + s.of + " attacks, " + s.limitsBlocked + " of " + s.limits + " known limits, and passed " + s.legitPassed + " of " + s.legitOf + " legitimate cases."),
      el("p", "A to G are the seven candidates we compared under a rule fixed before the first run: fail a legitimate case and you are out, then most attacks blocked wins. " +
        ruleWinner + " won with " + w.blocked + " of " + w.of + ". Next best: " + runner + " with " + results[runner].summary.blocked + ". " +
        "We then built H and " + chosen + " on top of " + ruleWinner + " to close what it left open, and adopted the strongest. " + chosen + " treats the fleet manager as a relay that is trusted with nothing. " +
        "Its price is " + saved.results[chosen].cost.bytesPerCall.toLocaleString("en") + " bytes per lift call and the longest list of supplier requirements."));
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
      if (c.scenario) th.append(el("i", "Pitch scenario: " + c.scenario));
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
    rows.push(group("Known limits of the seven candidates"), ...cases.filter(c => c.limit).map(row));
    rows.push(group("Legitimate work that must still succeed"), ...cases.filter(c => c.kind === "legit").map(row));
    body.replaceChildren(...rows);
    const total = (label, value, cls) => { const tr = el("tr", null, cls); const th = el("th", label); th.scope = "row"; tr.append(th);
      ids.forEach(id => tr.append(el("td", value(id), id === chosen ? "chosen" : ""))); return tr; };
    foot.replaceChildren(
      total("Attacks blocked", id => results[id].summary.blocked + " / " + results[id].summary.of),
      total("Known limits closed", id => results[id].summary.limitsBlocked + " / " + results[id].summary.limits),
      total("Legitimate cases passed", id => results[id].summary.legitPassed + " / " + results[id].summary.legitOf),
      total("Bytes per lift call, both hops", id => saved.results[id].cost.bytesPerCall.toLocaleString("en"), "plain"),
      total("Extra bytes to open a connection", id => saved.results[id].cost.setupBytes.toLocaleString("en"), "plain"),
      total("Processing per call, saved run", id => saved.results[id].cost.msPerCall + " ms", "plain"),
      total("Supplier requirements, counted", id => String(SecureInfo[id].vendorNeeds), "plain"));
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
    const open = cases.filter(c => c.kind === "attack" && !outcome(chosen, c).blocked);
    const closed = cases.filter(c => c.limit && outcome(chosen, c).blocked);
    const items = open.map(c => "Still gets through " + chosen + ": " + c.id + " · " + c.name + ". " + outcome(chosen, c).detail + ".");
    if (closed.length) items.push("Limits of the seven candidates that " + chosen + " closes: " + closed.map(c => c.id + " " + c.name.charAt(0).toLowerCase() + c.name.slice(1)).join("; ") + ".");
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
      renderMatrix(); renderPipes(); renderLadder();
      $("rerun-status").textContent = differences.length ? "Finished. Different from the saved run: " + differences.join(", ") + "."
        : "Finished. All " + (cases.length * ids.length) + " outcomes match the saved run.";
    } catch (error) { $("rerun-status").textContent = "Could not run here: " + error.message; }
    $("rerun").disabled = false;
  });

  // ---- the nine approaches in plain words, best first ----
  function renderLadder() {
    const score = id => results[id].summary.blocked * 100 + results[id].summary.limitsBlocked;
    const ranked = [...ids].sort((a, b) => score(b) - score(a)), of = results[chosen].summary.of;
    $("ladder-of").textContent = of;
    $("ladder").replaceChildren(...ranked.map((id, i) => {
      const p = SecureInfo[id].plain, s = results[id].summary, li = el("li", null, "rung" + (i === 0 ? " first" : i < 3 ? " podium" : ""));
      const rank = el("div", null, "rank"); rank.append(el("b", String(i + 1)), el("span", i === 0 ? "Number one" : i < 3 ? "Runner-up" : ""));
      const body = el("div", null, "rung-body"), head = el("h3");
      head.append(el("span", id, "letter"), document.createTextNode(p.name));
      const tag = el("span", id === "C" ? "Teammate's idea" : id === "F" ? "Our idea" : "GHI".includes(id) ? "Combination" : id === "A" ? "Starting point" : "Standard practice", "origin");
      head.append(tag);
      const facts = el("dl");
      facts.append(el("dt", "Stops"), el("dd", p.good), el("dt", "Still open"), el("dd", p.gap));
      body.append(head, el("p", p.like, "like"), facts);
      const meter = el("div", null, "meter"), bar = el("div", null, "bar"), fill = el("i");
      fill.style.width = Math.max(2, 100 * s.blocked / of) + "%";
      bar.append(fill);
      meter.append(el("strong", s.blocked + " of " + of), el("span", "attacks stopped"), bar);
      meter.setAttribute("aria-label", s.blocked + " of " + of + " attacks stopped");
      li.append(rank, body, meter);
      return li;
    }));
    $("recipe").replaceChildren(...SecureInfo.recipe.map(r => {
      const li = el("li");
      li.append(el("b", r.piece), el("span", r.why), el("i", "from " + r.from));
      return li;
    }));
  }

  // ---- who sees what ----
  function renderExposure() {
    const id = $("see-pipe").value, view = saved.results[id].exposure, table = $("see");
    const head = el("tr"); head.append(el("th", "Who"));
    saved.fields.forEach(f => { const th = el("th", f.label); th.scope = "col"; head.append(th); });
    table.tHead.replaceChildren(head);
    table.tBodies[0].replaceChildren(...Object.entries(view).map(([who, sees]) => {
      const tr = el("tr"), th = el("th", who); th.scope = "row"; tr.append(th);
      saved.fields.forEach(f => tr.append(el("td", sees[f.key] ? "sees it" : "–", sees[f.key] ? "sees" : "blind")));
      return tr;
    }));
  }
  ids.forEach(id => { const o = el("option", id + " · " + saved.pipelines[id].name); o.value = id; $("see-pipe").append(o); });
  $("see-pipe").value = chosen;
  $("see-pipe").addEventListener("change", renderExposure);

  $("n-attacks").textContent = SecureAttacks.ATTACKS.length;
  renderDecision(); renderLadder(); renderMatrix(); renderPipes(); renderLimits(); renderExposure();
  pick(chosen, "T25", false);
})();
