(() => {
  "use strict";
  const byId = id => document.getElementById(id);
  const dataset = id => JSON.parse(byId(id).textContent);
  const network = dataset("network-data");
  const study = dataset("study-data");
  const preview = dataset("preview-data");
  const architecture = dataset("floor-data");
  const formatter = new Intl.NumberFormat("en", {maximumFractionDigits:2});
  const format = value => value == null ? "—" : formatter.format(value);
  const pct = value => value == null ? "—" : format(100 * value) + "%";
  const text = (id, value) => { byId(id).textContent = value; };
  const ns = "http://www.w3.org/2000/svg";
  function svg(tag, attrs) {
    const node = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }
  function html(tag, value, cls) {
    const node = document.createElement(tag);
    if (value != null) node.textContent = value;
    if (cls) node.className = cls;
    return node;
  }
  function clock(seconds) {
    const whole = Math.floor(seconds + 0.000001);
    return String(Math.floor(whole / 60)).padStart(2, "0") + ":" + String(whole % 60).padStart(2,"0");
  }
  function table(container, titles, rows) {
    const wrapper = html("div", null, "table-scroll");
    const t = html("table");
    const head = t.createTHead().insertRow();
    titles.forEach(title => { const th = html("th", title); th.scope = "col"; head.append(th); });
    const body = t.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      row.forEach((val, i) => {
        const cell = html(i === 0 ? "th" : "td", val);
        if (i === 0) cell.scope = "row";
        tr.append(cell);
      });
    }
    wrapper.append(t);
    container.replaceChildren(wrapper);
  }

  function drawArchitecture(target, floor) {
    const plan = architecture[floor];
    const xy = pair => pair.join(",");
    const outline = plan.polygons.map(points => "M" + points.map(xy).join("L") + "Z").join("");
    const walls = plan.walls.map(([start, end]) => "M" + xy(start) + "L" + xy(end)).join("");
    target.replaceChildren(svg("path", {d:outline, fill:"#f8f9ee", stroke:"#99ad9b", "stroke-width":0.18}),
      svg("path", {d:walls, fill:"none", stroke:"#9aac98", "stroke-width":0.15, "stroke-linecap":"square"}));
  }
  function segment(from, to) {
    const a = network.nodes[from], b = network.nodes[to];
    return "M" + a.x + "," + a.z + "L" + b.x + "," + b.z;
  }
  const planner = new FleetController(network);
  const origin = network.stations.PHARMACY.node;
  const destination = network.stations["WARD-B"].node;
  const unavailable = new Set(planner.robots.filter(robot => robot.id !== "RX-01").map(robot => robot.at));
  const path = [origin, ...planner.pathTo(origin, destination, unavailable)];
  const plannedEdges = path.slice(1).map((id, i) => [path[i], id]);
  const robotColors = {"RX-01":"#08654c", "LAB-02":"#775487", "SUP-03":"#86582f"};
  const phaseNames = {approach:"Approaching lift", waiting:"Waiting at approach", denied:"Stopped at approach",
    boarding:"Boarding lift", riding:"In cabin", landing:"Confirming landing", delivering:"Approaching ward",
    awaiting_receipt:"Awaiting ward scan", porter_offered:"Awaiting porter acceptance", porter_transit:"Porter in transit", received:"Received at Ward B"};
  const actionNames = {approveMapping:"Verify floor mapping", clearPriority:"Clear patient priority", restoreFeed:"Restore facilities feed",
    offerPorter:"Offer porter handoff", acceptPorter:"Accept porter handoff", wardScan:"Scan at Ward B"};
  const outcomeNames = {pending:"Pending", allow:"Allow", hold:"Hold", deny:"Deny"};
  let simulation, playing = false, frameId = 0, previousFrame = 0;
  let view = "control", lastFloor = "", lastActions = "", lastEvents = -1;

  function stationMark(id, name, dx, dz, anchor = "start", fill = "#39735b") {
    const p = network.nodes[id];
    const group = svg("g", {});
    group.append(svg("rect", {x:p.x-.35,y:p.z-.35,width:.7,height:.7,fill,stroke:"white","stroke-width":.15}));
    const label = svg("text", {x:p.x+dx,y:p.z+dz,"class":"station-label","text-anchor":anchor});
    label.textContent = name;
    group.append(label);
    return group;
  }
  function drawFloor(floor) {
    const matches = ([a,b]) => network.nodes[a].floor === floor && network.nodes[b].floor === floor;
    drawArchitecture(byId("architecture"), floor);
    const d = network.edges.filter(matches).map(edge => segment(...edge)).join("");
    byId("lanes").replaceChildren(svg("path",{d,fill:"none",stroke:"#b1c6b4","stroke-width":.28}));
    const route = plannedEdges.filter(matches).map(edge => segment(...edge)).join("");
    byId("route").replaceChildren(svg("path",{d:route,fill:"none",stroke:"#0c8562","stroke-width":.49,"stroke-dasharray":"1 .45","stroke-linecap":"round"}));
    const offsets = {PHARMACY:[-.7,-1.1,"end"], STORES:[-.5,2.55,"end"], COLLECTION:[-1.2,2.6,"middle"],
      LAB:[-.7,-1.2,"end"], "WARD-A":[-.5,2,"end"], "WARD-B":[.8,2]};
    const markers = Object.entries(network.stations).filter(([,station]) => network.nodes[station.node].floor === floor)
      .map(([name, station]) => stationMark(station.node, station.name, ...offsets[name]));
    const cabin = network.cabins.find(id => network.nodes[id].floor === floor);
    markers.push(stationMark(cabin,"Shared lift", 1.2, -.9, "start", "#835d29"));
    byId("stations").replaceChildren(...markers);
    text("map-level", floor);
    text("map-title", floor === "L1" ? "Ground floor" : "Upper floor");
  }
  function renderMap(state) {
    const focus = state.robots.find(robot => robot.id === "RX-01").pose.floor;
    const mode = byId("floor").value;
    const floor = mode === "auto" ? focus : mode;
    const key = mode + floor;
    if (key !== lastFloor) {
      byId("floor-map").setAttribute("viewBox", mode === "auto" ? "-31 -28 62 31" : "-31 -27 62 53");
      drawFloor(floor);
      lastFloor = key;
    }
    const markers = state.robots.filter(r => r.pose.floor === floor).map(r => {
      const group = svg("g", {transform:"translate(" + r.pose.x + "," + r.pose.z + ")"});
      const primary = r.id === "RX-01";
      const title = svg("title",{}); title.textContent = r.id + " · " + r.at;
      group.append(title);
      if (primary) group.append(svg("circle",{r:1.15,fill:"#11765a","fill-opacity":.18}));
      group.append(svg("rect",{x:-.56,y:-.46,width:1.12,height:.92,rx:.22,fill:robotColors[r.id],stroke:"white","stroke-width":.16,
        transform:"rotate(" + (r.pose.yaw * 180 / Math.PI) + ")"}));
      if (primary) {
        group.append(svg("rect",{x:.9,y:-.78,width:4.55,height:1.4,rx:.25,fill:robotColors[r.id]}));
        const label = svg("text",{x:1.18,y:.29,"class":"unit-label"}); label.textContent = r.id;
        group.append(label);
      }
      return group;
    });
    byId("units").replaceChildren(...markers);
  }

  // ---- Control room -------------------------------------------------------
  function age(state) {
    const f = state.facilities;
    if (!f.connected) return f.seenAt === null ? "No observation yet" : "Lost · last seen " + clock(f.seenAt);
    return "Fresh · " + format(Math.max(0, state.time - f.seenAt)) + " s old";
  }
  function button(label, handler, primary) {
    const node = html("button", label, primary ? "primary" : "");
    node.type = "button";
    node.addEventListener("click", handler);
    return node;
  }
  function act(name) {
    const done = simulation.act(name);
    text("action-status", done ? actionNames[name] + " recorded at " + clock(simulation.state().time) + "." : "That action is no longer available.");
    render();
  }
  function renderGate(state) {
    const j = state.journey;
    const outcome = byId("outcome");
    outcome.textContent = outcomeNames[j.outcome];
    outcome.dataset.type = j.outcome;
    text("gate-reason", j.reason + ".");
    text("raw-floor", "“" + j.rawFloor + "” from the fleet");
    text("map-rev", j.mapRevision + (j.mapRevision === j.approvedRevision ? " · approved" : " · unverified (approved: " + j.approvedRevision + ")"));
    text("priority", state.facilities.priority ? "Patient transfer active" : "None");
    text("feed", age(state));
    text("landing", state.facilities.landing);
    text("calls", j.forwardedCalls);
    text("entries", j.cabinEntries);
    const recovery = state.actions.filter(name => name !== "wardScan");
    const key = state.round + "|" + recovery.join(",") + "|" + j.phase;
    if (key !== lastActions) {
      lastActions = key;
      byId("actions").replaceChildren(...recovery.map(name => button(actionNames[name], () => act(name), name !== "offerPorter")));
      if (j.phase === "denied") text("action-status", "A denied request has no recovery action at the lift. Dispatch must issue a new trip. Restart the round to replay it.");
      byId("receipt-actions").replaceChildren(...(state.actions.includes("wardScan") ? [button(actionNames.wardScan, () => act("wardScan"), true)] : []));
    }
  }
  function renderTopology(state) {
    const j = state.journey, f = state.facilities;
    const gate = {pending:"idle", allow:"ok", hold:"wait", deny:"stop"}[j.outcome];
    const steps = [
      ["Dispatcher", "Trip " + j.trip + " granted for L2", "ok"],
      ["Fleet manager", j.holder === "Porter" ? "Mission paused · porter assigned" : "Mission sent to RX-01", j.holder === "Porter" ? "wait" : "ok"],
      ["RX-01", phaseNames[j.phase], j.phase === "denied" ? "stop" : j.phase === "waiting" || j.phase === "porter_offered" ? "wait" : "ok"],
      ["Facilities feed", f.connected ? "Lift status fresh" : "No fresh lift status", f.connected ? "ok" : "wait"],
      ["Lift adapter", outcomeNames[j.outcome] + (j.outcome === "pending" ? " · not yet asked" : ""), gate],
      ["Lift controller", j.forwardedCalls ? count(j.forwardedCalls, "call") + " received · car at " + f.landing : "No call received", j.forwardedCalls ? "ok" : "idle"],
      ["Ward scanner", j.receipts ? count(j.receipts, "receipt") + " recorded" : "Awaiting scan · " + j.holder + " holds parcel", j.receipts ? "ok" : "idle"]
    ];
    const key = JSON.stringify(steps);
    if (key === renderTopology.last) return;
    renderTopology.last = key;
    byId("topology").replaceChildren(...steps.map(([name, status, kind]) => {
      const li = html("li");
      li.dataset.state = kind;
      li.append(html("strong", name), html("span", status));
      return li;
    }));
  }
  function count(value, noun) { return value + " " + noun + (value === 1 ? "" : "s"); }
  function renderEvents(state) {
    text("phase", phaseNames[state.journey.phase]);
    text("holder", state.journey.holder);
    text("receipts", state.journey.receipts);
    if (state.events.length === lastEvents) return;
    lastEvents = state.events.length;
    text("event-count", count(lastEvents, "event"));
    byId("events").replaceChildren(...state.events.slice().reverse().map(event => {
      const li = html("li");
      const time = html("time", clock(event.time));
      const body = html("span", event.text, "event-text");
      body.append(html("small", event.kind));
      li.append(time, html("span", event.source, "event-kind"), body);
      return li;
    }));
  }
  function render() {
    const state = simulation.state();
    renderMap(state);
    renderGate(state);
    renderTopology(state);
    renderEvents(state);
    text("clock", clock(state.time));
    const finished = state.journey.phase === "received" || state.journey.phase === "denied";
    if (finished && playing) setPlaying(false);
    byId("play").disabled = byId("step").disabled = finished;
    byId("decision").disabled = state.journey.outcome !== "pending";
  }
  function setPlaying(value) {
    playing = value;
    byId("play").textContent = playing ? "Pause" : "Play";
    clearInterval(frameId);
    if (!playing) return;
    previousFrame = performance.now();
    frameId = setInterval(() => {
      const now = performance.now();
      const elapsed = Math.min(.25, (now - previousFrame) / 1000);
      previousFrame = now;
      simulation.advance(elapsed * Number(byId("speed").value));
      render();
    }, 50);
  }
  function reset() {
    setPlaying(false);
    simulation = new WardSafety.WardSimulation({network, round:byId("round").value});
    byId("floor").value = "auto";
    lastFloor = lastActions = ""; lastEvents = -1; renderTopology.last = "";
    text("action-status", "");
    render();
  }
  byId("play").addEventListener("click", () => setPlaying(!playing));
  byId("step").addEventListener("click", () => { setPlaying(false); simulation.advance(1); render(); });
  byId("decision").addEventListener("click", () => {
    setPlaying(false);
    for (let i = 0; i < 1200 && simulation.state().journey.outcome === "pending"; i++) simulation.advance(.1);
    render();
  });
  byId("reset").addEventListener("click", reset);
  byId("round").addEventListener("change", reset);
  byId("floor").addEventListener("change", render);

  // ---- Trust study --------------------------------------------------------
  const stationOf = Object.fromEntries(Object.values(network.stations).map(s => [s.node, s.name]));
  network.cabins.forEach(id => { stationOf[id] = "Shared lift " + network.nodes[id].floor; });
  const place = id => stationOf[id] || id;
  const modes = {missions:["Distinct missions", ""], seconds:["Exposure time", " s"], alerts:["Alerts", ""],
    alertsPerHour:["Alerts per observed hour", ""], missionsPer100:["Missions per 100", ""]};
  let selectedEdge = "";
  const edgeKey = edge => edge.from + ">" + edge.to;
  function heatColor(t) {
    const stops = [[44,107,176],[240,226,182],[200,56,43]];
    const scaled = Math.min(1, Math.max(0, t)) * 2, i = Math.min(1, Math.floor(scaled)), part = scaled - i;
    return "rgb(" + stops[i].map((c, k) => Math.round(c + (stops[i + 1][k] - c) * part)).join(",") + ")";
  }
  function heatEdges() {
    const floor = byId("heat-floor").value, coverage = byId("heat-coverage").value;
    return study.edges.filter(edge => {
      const a = network.nodes[edge.from].floor, b = network.nodes[edge.to].floor;
      const onFloor = floor === "cabin" ? edge.zone === "lift cabin" : edge.zone !== "lift cabin" && a === floor && b === floor;
      return onFloor && (coverage === "all" || (coverage === "observed") === (edge.missions > 0));
    });
  }
  function renderStudy() {
    const m = study.metrics, splits = study.splits;
    text("mission-count", format(study.missions) + " simulated missions · seed " + study.seed);
    text("study-description", format(splits.training.missions) + " training, " + format(splits.calibration.missions) + " calibration and " +
      format(splits.test.missions) + " held-out missions across " + study.uniqueStationPairs + " directed station pairs. Outcomes: " +
      Object.entries(study.outcomes).map(([name, n]) => format(n) + " " + name).join(", ") + ".");
    const found = part => part.detected + " / " + part.total;
    const latency = part => part.medianLatencySeconds == null ? "—" : format(part.medianLatencySeconds) + " s";
    const row = (label, pick) => [label, pick(m.baseline), pick(m.advisory)];
    table(byId("metrics"), ["Held-out result", "Fixed dwell threshold", "Mission-aware advisory"], [
      row("Equipment holds detected", r => found(r.fault)),
      row("Mismatched destinations detected", r => found(r.violation)),
      row("Median time to alert, equipment hold", r => latency(r.fault)),
      row("False alerts per 100 benign missions", r => format(r.falsePer100)),
      row("False alerts per benign robot-hour", r => format(r.falsePerBenignHour)),
      row("Alerts that were real incidents", r => pct(r.precision))
    ]);
    text("study-note", "Simulated on the shared fleet engine with fictional missions. The study does not measure the lift adapter or a hospital deployment.");
    renderHeat();
  }
  function renderHeat() {
    const floor = byId("heat-floor").value, mode = byId("heat-mode").value;
    const edges = heatEdges();
    const value = edge => edge.missions ? edge[mode] : null;
    const peak = Math.max(0, ...edges.map(edge => value(edge) || 0));
    const target = byId("heat");
    if (!edges.some(edge => edgeKey(edge) === selectedEdge)) {
      const top = edges.slice().sort((a, b) => (value(b) || 0) - (value(a) || 0))[0];
      selectedEdge = top ? edgeKey(top) : "";
    }
    if (floor === "cabin") {
      const label = svg("text", {x:0, y:0, "text-anchor":"middle", "class":"heat-empty"});
      label.textContent = "The cabin links L1 and L2. See the table.";
      target.replaceChildren(label);
    } else {
      const base = svg("g", {});
      drawArchitecture(base, floor);
      const lines = edges.map(edge => {
        const a = network.nodes[edge.from], b = network.nodes[edge.to];
        const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        // Each direction is drawn slightly to its own right so opposing lanes stay distinguishable.
        const ox = -(b.z - a.z) / length * .2, oz = (b.x - a.x) / length * .2;
        const v = value(edge), chosen = edgeKey(edge) === selectedEdge;
        const attrs = {x1:a.x + ox, y1:a.z + oz, x2:b.x + ox, y2:b.z + oz, "stroke-linecap":"round", "class":"heat-edge" + (chosen ? " chosen" : "")};
        if (v == null) Object.assign(attrs, {stroke:"#7c8a80", "stroke-width":.16, "stroke-dasharray":".5 .5"});
        else Object.assign(attrs, {stroke:heatColor(peak ? Math.sqrt(v / peak) : 0), "stroke-width":chosen ? .7 : .42});
        const line = svg("line", attrs);
        const title = svg("title", {});
        title.textContent = place(edge.from) + " → " + place(edge.to) + " · " + (edge.missions ? format(edge[mode]) + modes[mode][1] : "no coverage");
        line.append(title);
        line.addEventListener("click", () => { selectedEdge = edgeKey(edge); renderHeat(); });
        return line;
      });
      // Draw the selected transition last so it sits above its neighbours.
      lines.sort((a, b) => a.classList.contains("chosen") - b.classList.contains("chosen"));
      const marks = Object.values(network.stations).filter(s => network.nodes[s.node].floor === floor).map(s => {
        const p = network.nodes[s.node], label = svg("text", {x:p.x + .7, y:p.z - .7, "class":"station-label"});
        label.textContent = s.name;
        return label;
      });
      target.replaceChildren(base, ...lines, ...marks);
    }
    const select = byId("heat-edge");
    select.replaceChildren(...edges.map(edge => {
      const option = html("option", place(edge.from) + " → " + place(edge.to) + (edge.missions ? "" : " · no coverage"));
      option.value = edgeKey(edge);
      return option;
    }));
    select.value = selectedEdge;
    const edge = edges.find(e => edgeKey(e) === selectedEdge);
    const detail = html("dl", null, "facts");
    if (edge) {
      const facts = edge.missions ? [["Zone", edge.zone], ["Distinct missions", format(edge.missions)], ["Traversals", format(edge.traversals)],
        ["Exposure time", format(edge.seconds) + " s"], ["Alerts", format(edge.alerts)], ["Alerts per observed hour", format(edge.alertsPerHour)],
        ["Missions per 100", format(edge.missionsPer100)], ["Example mission", edge.example]]
        : [["Zone", edge.zone], ["Coverage", "No simulated mission used this transition"]];
      facts.forEach(([name, val]) => { const div = html("div"); div.append(html("dt", name), html("dd", val)); detail.append(div); });
    }
    byId("heat-detail").replaceChildren(detail);
    text("heat-heading", floor === "cabin" ? "Lift cabin transitions" : floor + " transition details");
    const ranked = edges.filter(e => e.missions).sort((a, b) => (b[mode] || 0) - (a[mode] || 0)).slice(0, 5);
    if (ranked.length) table(byId("heat-values"), ["Highest · " + modes[mode][0], "Value"],
      ranked.map(e => [place(e.from) + " → " + place(e.to), format(e[mode]) + modes[mode][1]]));
    else byId("heat-values").replaceChildren();
    const all = study.edges.filter(e => floor === "cabin" ? e.zone === "lift cabin" : e.zone !== "lift cabin" && network.nodes[e.from].floor === floor && network.nodes[e.to].floor === floor);
    const empty = all.filter(e => !e.missions).length;
    text("heat-note", empty + " of " + all.length + " directed transitions here had no simulated mission. A dashed grey lane means the study never observed it. A blue lane was observed rarely. Activity alone does not show intent.");
  }
  ["heat-coverage", "heat-floor", "heat-mode"].forEach(id => byId(id).addEventListener("change", renderHeat));
  byId("heat-edge").addEventListener("change", event => { selectedEdge = event.target.value; renderHeat(); });

  // ---- Workflow review ----------------------------------------------------
  const workflows = {
    policy:{title:"Policy preview", columns:["Replayed case", "Active policy", "Candidate that drops Ward B"],
      text:"The same saved trips are replayed under the active rule and a candidate that accidentally removes Ward B. The preview shows who would lose service before the change goes live.",
      rows:() => WardWorkflows.demoPreview(preview)},
    custody:{title:"Custody replay", columns:["Check", "First observation", "Result"],
      text:"A parcel is bound to its reusable tote for one trip. A tote seen at the door is evidence of location. Only the matching parcel scan at the right ward closes the delivery.",
      rows:() => WardWorkflows.demoCustody()},
    queue:{title:"Lift queue", columns:["Check", "First observation", "Result"],
      text:"Two vendor fleets share one lift with two routine slots. Retries merge, a patient transfer stops new robot boarding, and vendors take turns after facilities clears the lift.",
      rows:() => WardWorkflows.demoQueue()}
  };
  function renderReview() {
    const flow = workflows[byId("workflow").value];
    text("review-heading", flow.title);
    text("review-description", flow.text);
    table(byId("review-results"), flow.columns, flow.rows().map(r => [r.label, r.active, r.candidate]));
  }
  byId("workflow").addEventListener("change", renderReview);

  // ---- Navigation ---------------------------------------------------------
  document.querySelectorAll("nav button[data-view]").forEach(tab => tab.addEventListener("click", () => {
    view = tab.dataset.view;
    if (view !== "control") setPlaying(false);
    document.querySelectorAll("nav button[data-view]").forEach(other => other.setAttribute("aria-pressed", String(other === tab)));
    ["control", "study", "review"].forEach(name => { byId("view-" + name).hidden = name !== view; });
  }));
  reset();
  renderStudy();
  renderReview();
})();
