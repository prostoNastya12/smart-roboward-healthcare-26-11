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
