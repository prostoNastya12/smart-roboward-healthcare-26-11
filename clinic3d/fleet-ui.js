// The console sends commands to a local worker. All feedback comes from its replies.
(() => {
  "use strict";
  const el = id => document.getElementById(id);
  const network = JSON.parse(el("fleet-network").textContent);
  const stationName = id => network.stations[id]?.name || id;
  const examples = {
    spin: "The robot turns in place without a turn command. The monitor flags 60°/s or faster for two simulated seconds.",
    silence: "One heartbeat is expected each second. Four simulated seconds of silence triggers a safety hold.",
    lift: "The robot requests a floor outside its assignment. The lift gate checks the request against the dispatch."
  };
  const rows = new Map(), pending = new Map(), feedback = new Map();
  const destinations = new Map(), choices = new Map();
  const eventRows = [];
  let worker, workerUrl, sequence = 0, snapshot = null, selected = "RX-01", evidenceKey = null;

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function setText(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }
  function clock(seconds) {
    const whole = Math.floor(seconds);
    return String(Math.floor(whole / 60)).padStart(2, "0") + ":" + String(whole % 60).padStart(2, "0");
  }
  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent("clinicfleet:" + name, {detail}));
  }
  function current() {
    return snapshot?.robots.find(r => r.id === selected);
  }

  function addUnit(robot) {
    const button = node("button", "unit-row");
    button.type = "button";
    button.dataset.robot = robot.id;
    button.style.setProperty("--unit", robot.color);
    const thumb = node("span", "unit-thumb", robot.id.split("-")[0]);
    thumb.setAttribute("aria-hidden", "true");
    const label = node("span", "unit-text");
    label.append(node("b", "", robot.id), node("small", "", robot.name));
    const location = node("span", "unit-state"), state = node("span", "state"), floor = node("span");
    location.append(state, floor);
    button.append(thumb, label, location);
    button.addEventListener("click", () => select(robot.id));
    el("fleet-roster").append(button);
    const row = {button, thumb, state, floor};
    rows.set(robot.id, row);
    return row;
  }
  function renderRoster() {
    for (const robot of snapshot.robots) {
      const row = rows.get(robot.id) || addUnit(robot);
      row.button.setAttribute("aria-pressed", String(robot.id === selected));
      setText(row.state, robot.state);
      setText(row.floor, "Floor " + robot.pose.floor.slice(1));
      row.state.classList.toggle("flag", Boolean(robot.alert || robot.isolated));
      row.state.classList.toggle("moving", ["In transit", "In lift"].includes(robot.state));
    }
  }
  window.addEventListener("clinicfleet:thumbnails", ({detail}) => {
    for (const [id, url] of Object.entries(detail)) {
      if (!url || !rows.has(id)) continue;
      const img = node("img");
      img.alt = "";
      img.src = url;
      rows.get(id).thumb.replaceChildren(img);
    }
  });

  const destination = el("mission-destination");
  for (const [id, station] of Object.entries(network.stations)) {
    const floor = network.nodes[station.node].floor;
    const option = new Option(station.name + " · " + floor, id);
    option.dataset.label = option.text;
    destination.add(option);
  }
  function renderMission(robot, busy) {
    const mission = robot.mission, arrived = mission?.stage === "arrived";
    const held = Boolean(robot.alert || robot.isolated);
    const station = stationName(robot.station);
    let description;
    if (!mission) {
      description = (station ? "At " + station : "Between stations") + (robot.completed ? " · " + robot.completed + " received" : "");
    } else {
      const place = stationName(mission.dest);
      if (arrived) description = "At " + place + " · awaiting receipt";
      else if (robot.state === "Waiting") description = "To " + place + " · waiting for traffic clearance";
      else description = "To " + place + " · " + robot.state.toLowerCase();
    }
    setText(el("command-unit"), robot.id);
    setText(el("mission-code"), mission?.id || "");
    setText(el("mission-description"), description);
    setText(el("travel-speed"), robot.measuredSpeed.toFixed(1) + " m/s");
    setText(el("travel-distance"), mission ? mission.traveled.toFixed(1) + " m" : "—");
    for (const option of destination.options) {
      const id = option.value;
      const other = snapshot.robots.find(r => r.id !== robot.id && (r.mission?.dest === id || (!r.mission && r.station === id)));
      const reason = other ? " · " + other.id : robot.station === id ? " · here" : "";
      option.disabled = Boolean(reason) && mission?.dest !== id;
      setText(option, option.dataset.label + reason);
    }
    const preferred = mission?.dest || destinations.get(robot.id) || robot.preferred;
    const options = Array.from(destination.options);
    const next = options.find(o => o.value === preferred && !o.disabled) || options.find(o => !o.disabled);
    if (destination.value !== (next?.value || "")) destination.value = next?.value || "";
    destination.disabled = busy || held || Boolean(mission);
    el("fleet-dispatch").disabled = destination.disabled || !next;
    const pause = el("fleet-pause"), receipt = el("fleet-receipt"), isolate = el("fleet-isolate");
    pause.hidden = arrived;
    setText(pause, robot.paused ? "Resume mission" : "Pause mission");
    pause.disabled = busy || held || !mission || arrived;
    receipt.hidden = !arrived;
    receipt.disabled = busy || !arrived;
    setText(isolate, robot.isolated ? "Restore access" : "Isolate robot");
    isolate.disabled = busy || (robot.isolated && !robot.canRelease);
    isolate.classList.toggle("recover", robot.isolated);
    const note = feedback.get(robot.id);
    const field = el("command-feedback");
    setText(field, note?.text || "");
    field.classList.toggle("error", note?.ok === false);
  }

  function renderSecurity(robot, busy) {
    const choice = robot.example || choices.get(robot.id) || "spin";
    setText(el("security-unit"), robot.id);
    for (const tab of document.querySelectorAll("[data-example]")) {
      tab.setAttribute("aria-pressed", String(tab.dataset.example === choice));
      tab.disabled = busy || Boolean(robot.example);
    }
    setText(el("example-description"), examples[choice]);
    const run = el("fleet-example");
    setText(run, robot.example ? "End example" : "Run example");
    run.disabled = busy || (!robot.example && Boolean(robot.isolated || robot.alert));
    const evidence = el("evidence");
    const mapAlert = el("map-alert");
    mapAlert.hidden = !robot.alert;
    if (robot.alert) setText(mapAlert, robot.id + " · " + robot.alert.title + " · View alert");
    const key = [robot.id, robot.alert?.time, robot.isolated, robot.example, robot.canRelease].join("|");
    if (key !== evidenceKey) {
      evidenceKey = key;
      const parts = [];
      if (robot.alert) {
        parts.push(node("b", "", robot.alert.title + " · " + clock(robot.alert.time)));
        parts.push(node("p", "", "Expected: " + robot.alert.expected));
        parts.push(node("p", "", "Observed: " + robot.alert.observed));
      }
      if (robot.isolated) {
        parts.push(node("p", "", robot.example ? "Dispatch and lift access revoked. End the example before restoring access."
          : robot.canRelease ? "Fresh heartbeat and stable motion. You can restore access."
          : "Access revoked. Waiting for a fresh heartbeat and stable motion."));
      } else if (robot.alert) {
        parts.push(node("p", "", "Safety hold applied. A fault can cause this signal too. Isolate the robot for review."));
      } else if (robot.example) {
        parts.push(node("p", "", "Observing simulated input. Monitoring this robot against its dispatch."));
      }
      evidence.replaceChildren(...parts);
    }
    setText(el("sensor-beat"), Math.max(0, snapshot.time - robot.heartbeat).toFixed(1) + " s ago");
    setText(el("sensor-turn"), Math.round(robot.rate) + "°/s");
  }

  function appendEvent(entry) {
    const row = node("div", "log-row");
    row.classList.toggle("warn", ["ALERT", "DENY", "HOLD", "NACK"].includes(entry.kind));
    row.dataset.robot = entry.robot;
    row.dataset.kind = entry.kind;
    const note = node("div");
    if (entry.observed) {
      const details = node("details");
      details.append(node("summary", "", entry.text), node("p", "", "Expected: " + entry.expected),
        node("p", "", "Observed: " + entry.observed));
      note.append(details);
    } else {
      note.append(node("strong", "", entry.text));
    }
    const route = entry.from + " → " + entry.to;
    const prefix = entry.robot && ![entry.from, entry.to].includes(entry.robot) ? entry.robot + " · " : "";
    note.append(node("span", "log-route", prefix + route + (entry.ref ? " · " + entry.ref : "")));
    row.append(node("span", "log-time", clock(entry.time)), node("span", "log-tag", entry.kind), note);
    row.hidden = el("journal-filter").value === "selected" && entry.robot !== selected;
    el("fleet-journal").prepend(row);
    eventRows.push(row);
    if (eventRows.length > 250) eventRows.shift().remove();
  }
  function filterEvents() {
    const filter = el("journal-filter").value;
    for (const row of eventRows) row.hidden = filter === "selected" && row.dataset.robot !== selected;
  }
  function render() {
    const robot = current();
    if (!robot) return;
    renderRoster();
    setText(el("fleet-clock"), clock(snapshot.time));
    setText(el("count-fleet"), String(snapshot.robots.length));
    setText(el("count-missions"), String(snapshot.robots.filter(r => r.mission).length));
    const alerts = snapshot.robots.filter(r => r.alert).length;
    setText(el("count-alerts"), String(alerts));
    el("count-alerts").classList.toggle("attention", alerts > 0);
    setText(el("fleet-lift"), snapshot.lift ? "Reserved · " + snapshot.lift : "Available");
    const speedPending = [...pending.values()].some(p => p.action === "speed");
    el("fleet-speed").disabled = speedPending;
    if (!speedPending) el("fleet-speed").value = String(snapshot.speed);
    const busy = [...pending.values()].some(p => p.robot === selected);
    renderMission(robot, busy);
    renderSecurity(robot, busy);
  }
  function select(id) {
    if (!snapshot?.robots.some(r => r.id === id)) return;
    selected = id;
    render();
    filterEvents();
    emit("selection", id);
  }
  function send(action, extra = {}) {
    if (!worker || !snapshot) return;
    const id = "C" + String(++sequence).padStart(4, "0");
    const command = {id, robot:action === "speed" ? "" : selected, action, ...extra};
    pending.set(id, command);
    if (command.robot) feedback.set(command.robot, {text:"Awaiting acknowledgement · " + id});
    worker.postMessage({type:"command", command});
    render();
  }
  function receive({data}) {
    snapshot = data;
    for (const ack of data.acks) {
      const cmd = pending.get(ack.id);
      if (!cmd) continue;
      pending.delete(ack.id);
      if (cmd.robot) {
        const message = ack.ok ? "Acknowledged · " + ack.id : "Declined · " + ack.reason;
        feedback.set(cmd.robot, {ok:ack.ok, text:message});
      }
    }
    for (const e of data.events) appendEvent(e);
    render();
    emit("state", data);
  }
  function unavailable() {
    for (const control of document.querySelectorAll(".command-panel button,.command-panel select,.security-card button,#fleet-speed")) control.disabled = true;
    setText(el("command-feedback"), "The local simulator could not start. Reopen this file in a browser with Web Worker support.");
    el("command-feedback").classList.add("error");
    if (worker) worker.terminate();
    worker = null;
  }
  function visibility() {
    const active = !el("model-panel").hidden;
    document.querySelector(".sim-bar").hidden = !active;
    if (active && !worker && !workerUrl) {
      try {
        workerUrl = URL.createObjectURL(new Blob([el("fleet-worker-source").textContent], {type:"text/javascript"}));
        worker = new Worker(workerUrl);
        worker.onmessage = receive;
        worker.onerror = unavailable;
        worker.postMessage({type:"init", network});
      } catch { unavailable(); }
    }
    worker?.postMessage({type:"visibility", visible:active && !document.hidden});
  }
  window.fleetConsole = {get snapshot() { return snapshot; }, get selected() { return selected; }};
  window.addEventListener("clinicfleet:pick", e => select(e.detail));
  window.addEventListener("clinic3d:visibility", visibility);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pageshow", visibility);
  window.addEventListener("pagehide", e => {
    if (!e.persisted && workerUrl) {
      worker?.terminate();
      URL.revokeObjectURL(workerUrl);
    }
  });
  destination.addEventListener("change", () => destinations.set(selected, destination.value));
  el("fleet-dispatch").addEventListener("click", () => send("dispatch", {destination:destination.value}));
  el("fleet-pause").addEventListener("click", () => send(current().paused ? "resume" : "pause"));
  el("fleet-receipt").addEventListener("click", () => send("receipt"));
  el("fleet-isolate").addEventListener("click", () => send(current().isolated ? "release" : "isolate"));
  el("fleet-speed").addEventListener("change", e => send("speed", {value:Number(e.target.value)}));
  for (const tab of document.querySelectorAll("[data-example]")) {
    tab.addEventListener("click", () => { choices.set(selected, tab.dataset.example); render(); });
  }
  el("fleet-example").addEventListener("click", () => {
    if (current().example) { send("end"); return; }
    const example = choices.get(selected) || "spin";
    if (example === "spin" && !el("fleet-follow").disabled) {
      emit("focus");
      const rect = el("model-frame").getBoundingClientRect();
      const visible = Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top);
      if (visible < .7 * rect.height) {
        el("clinic-view").scrollIntoView({block:"start"});
        el("model-canvas").focus({preventScroll:true});
      }
    }
    send("example", {example});
  });
  el("journal-filter").addEventListener("change", filterEvents);
  el("map-alert").addEventListener("click", async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    if (el("clinic-view").classList.contains("expanded")) el("model-full").click();
    el("evidence").scrollIntoView({block:"center"});
    el("evidence").focus({preventScroll:true});
  });
})();
