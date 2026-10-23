/* Dashboard state and API integration. */
(function () {
  const $ = (id) => document.getElementById(id);
  const state = { topology: null, routes: [], lastResult: null, lastEvents: null, finalTopology: null };
  const modeNames = { congestion_aware: "Congestion-aware", multipath: "Multipath", single: "Single path" };
  const modeHints = {
    multipath: "Packets are spread over the alternative routes.",
    single: "Every packet takes the lowest-cost route.",
    congestion_aware: "Each packet re-scores the routes by link delay and the load of earlier packets, adjusted by capacity.",
  };

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  function setConnection(connected, message) {
    $("connection-state").textContent = message;
    $("connection-state").classList.toggle("connection-error", !connected);
    document.querySelector(".live-dot").classList.toggle("offline", !connected);
  }

  function fillSelect(select, options, selected) {
    select.replaceChildren(...options.map((option) => {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      if (option.value === selected) element.selected = true;
      return element;
    }));
  }

  function populateNodes() {
    const options = state.topology.nodes.map((node) => ({ value: node.id, label: `${node.id} · ${node.label}` }));
    const ids = new Set(options.map((option) => option.value));
    const previousSource = ids.has($("source-select").value) ? $("source-select").value : null;
    const previousDestination = ids.has($("destination-select").value) ? $("destination-select").value : null;
    const source = previousSource || (ids.has("S") ? "S" : options[0]?.value);
    const destination = previousDestination && previousDestination !== source
      ? previousDestination
      : (ids.has("D") && source !== "D" ? "D" : options.slice().reverse().find((option) => option.value !== source)?.value || source);
    fillSelect($("source-select"), options, source);
    fillSelect($("destination-select"), options, destination);
  }

  function populateLinks() {
    const options = state.topology.links.map((link) => ({
      value: `${link.source}|${link.target}`,
      label: `${link.source}–${link.target} · cost ${link.cost}${link.available ? "" : " · down"}`,
    }));
    const previousFailure = $("failure-link").value;
    const previousManual = $("manual-link").value;
    fillSelect($("failure-link"), options, options.some((option) => option.value === previousFailure) ? previousFailure : options[0]?.value);
    fillSelect($("manual-link"), options, options.some((option) => option.value === previousManual) ? previousManual : options[0]?.value);
    const link = selectedLink();
    $("toggle-link").disabled = !link;
    $("toggle-link").textContent = link ? (link.available ? "Break link" : "Restore link") : "No links";
  }

  function selectedLink() {
    const value = $("manual-link").value;
    const [source, target] = value.split("|");
    return state.topology?.links.find((link) => link.source === source && link.target === target || link.source === target && link.target === source);
  }

  function networkLine() {
    if (!state.topology) return "";
    const live = state.topology.links.filter((link) => link.available).length;
    return `${state.topology.nodes.length} nodes · ${live} of ${state.topology.links.length} links up`;
  }

  function renderTopology() {
    if (!state.topology) return;
    TopologyView.render($("topology-wrap"), state.topology, state.routes);
    const liveLinks = state.topology.links.filter((link) => link.available).length;
    $("topology-count").textContent = `${state.topology.nodes.length} nodes · ${liveLinks} of ${state.topology.links.length} links up`;
    populateLinks();
  }

  function setFinding(html) { $("finding-line").innerHTML = html; }
  function idleFinding() {
    setFinding(`Demo network, ${networkLine()}. Choose a routing mode and send a message.`);
  }

  function updateSummary(metrics, routes, mode, activeRouteCount = routes.length, single = null) {
    $("delivered-value").textContent = `${metrics.delivered_packets}/${metrics.total_packets}`;
    $("delivery-value").textContent = `${metrics.delivery_ratio_percent}%`;
    $("routes-value").textContent = String(activeRouteCount);
    $("retry-value").textContent = String(metrics.retransmissions);
    if (single) {
      const diff = Number((metrics.delivery_ratio_percent - single.delivery_ratio_percent).toFixed(1));
      const tone = diff > 0 ? "better" : diff < 0 ? "worse" : "";
      const words = diff === 0 ? "Same as single path" : `${diff > 0 ? "+" : "−"}${Math.abs(diff)} pts vs single`;
      $("sent-note").textContent = `Single path ${single.delivered_packets}/${single.total_packets}`;
      document.querySelector(".kpi-lead .kpi-note").innerHTML = `<span class="${tone}">${words}</span>`;
    } else {
      $("sent-note").textContent = `${metrics.total_packets} packets created`;
      document.querySelector(".kpi-lead .kpi-note").textContent = "Unique packets received";
    }
    $("result-mode").textContent = mode === "compare" ? "Mode comparison" : `${modeNames[mode] || mode} routing`;
  }

  function findingFor(result, label) {
    const m = result.metrics;
    const routes = result.paths.length;
    const verdict = result.integrity.ok ? "message verified" : "message incomplete";
    const failure = result.events.find((event) => event.type === "link_failure");
    const recovery = result.events.find((event) => event.type === "recovery");
    let extra = "";
    if (failure) extra = recovery ? `, link ${failure.source}–${failure.target} failed and traffic recovered in ${recovery.recovery_time_ms} ms` : `, link ${failure.source}–${failure.target} failed`;
    return `${label}: <strong>${m.delivered_packets} of ${m.total_packets} packets delivered</strong> over ${routes} route${routes === 1 ? "" : "s"}, ${verdict}${extra}.`;
  }

  function renderRoutes(routes) {
    state.routes = routes || [];
    const summary = $("route-summary");
    if (!state.routes.length) {
      summary.innerHTML = '<span class="muted">Run an experiment to highlight the routes it used.</span>';
    } else {
      summary.replaceChildren(...state.routes.map((route, index) => {
        const item = document.createElement("span");
        item.className = "route-chip arrive";
        item.style.setProperty("--route-color", TopologyView.routeColor(index));
        const score = route.base_cost === undefined
          ? `cost ${route.cost}`
          : `score ${Number(route.cost).toFixed(2)} · base ${route.base_cost} · ${route.estimated_delay_ms} ms`;
        const name = document.createElement("span"); name.textContent = `Route ${index + 1}  ${route.nodes.join(" → ")}`;
        const meta = document.createElement("span"); meta.className = "chip-meta"; meta.textContent = score;
        item.append(name, meta);
        return item;
      }));
    }
    renderTopology();
  }

  function routeIndexFor(nodes) {
    if (!nodes) return -1;
    const key = nodes.join(">");
    return state.routes.findIndex((route) => (route.nodes || route).join(">") === key);
  }

  function renderSegments(packets) {
    const box = $("packet-segments");
    if (!packets.length) { box.replaceChildren(); return; }
    const caption = document.createElement("p");
    caption.className = "segments-caption";
    const lost = packets.filter((packet) => packet.status !== "delivered").length;
    caption.textContent = `Rebuilt from ${packets.length} packet${packets.length === 1 ? "" : "s"}${lost ? `, ${lost} lost` : ""}, in sequence order`;
    const row = document.createElement("div");
    row.className = "segment-row";
    packets.forEach((packet) => {
      const piece = document.createElement("span");
      piece.className = `segment${packet.status === "delivered" ? "" : " lost"}`;
      const index = routeIndexFor(packet.route);
      if (index >= 0) piece.style.setProperty("--route-color", TopologyView.routeColor(index));
      const seq = document.createElement("b"); seq.textContent = String(packet.sequence + 1);
      const text = document.createElement("span"); text.textContent = (packet.payload || "").replace(/ /g, "\u00a0") || "(empty)";
      piece.title = `Packet ${packet.sequence + 1}${packet.route ? `, ${packet.route.join(" → ")}` : ""}, ${packet.status}`;
      piece.append(seq, text);
      row.appendChild(piece);
    });
    box.replaceChildren(caption, row);
  }

  function renderPackets(packets) {
    renderSegments(packets);
    $("packet-count").textContent = `${packets.length} packet${packets.length === 1 ? "" : "s"}`;
    const body = $("packet-rows");
    if (!packets.length) {
      body.innerHTML = '<tr><td colspan="5" class="table-empty">No packets were created.</td></tr>';
      return;
    }
    body.replaceChildren(...packets.map((packet) => {
      const row = document.createElement("tr");
      const sequence = document.createElement("td"); sequence.className = "num"; sequence.textContent = String(packet.sequence + 1);
      const payload = document.createElement("td"); payload.className = "payload-cell"; payload.textContent = packet.payload || "(empty)";
      const status = document.createElement("td");
      const pill = document.createElement("span"); pill.className = `packet-status ${packet.status}`;
      pill.textContent = packet.status === "delivered" ? "Delivered" : packet.status === "lost" ? "Lost" : packet.status;
      status.appendChild(pill);
      const route = document.createElement("td");
      if (packet.route) {
        const tag = document.createElement("span"); tag.className = "route-cell";
        const index = routeIndexFor(packet.route);
        if (index >= 0) tag.style.setProperty("--route-color", TopologyView.routeColor(index));
        tag.textContent = packet.route.join(" → ");
        route.appendChild(tag);
      } else { route.textContent = "—"; }
      const delay = document.createElement("td"); delay.className = "num"; delay.textContent = `${packet.delay_ms} ms`;
      [sequence, payload, status, route, delay].forEach((cell) => row.appendChild(cell));
      return row;
    }));
  }

  const eventText = {
    transmission: (event) => `Packet ${event.sequence + 1} sent, try ${event.attempt}, ${event.route.join(" → ")}`,
    packet_dropped: (event) => `Packet ${event.sequence + 1} dropped on try ${event.attempt}`,
    retransmission: (event) => `Retrying packet ${event.sequence + 1}, try ${event.next_attempt}`,
    acknowledgement: (event) => `Packet ${event.sequence + 1} acknowledged`,
    congestion_route_selected: (event) => `Congestion-aware choice for packet ${event.sequence + 1}, score ${event.objective_cost}, ${event.route.join(" → ")}`,
    link_failure: (event) => `Link ${event.source}–${event.target} failed`,
    routes_recalculated: (event) => `${event.paths.length} route${event.paths.length === 1 ? "" : "s"} available after recalculation`,
    recovery: (event) => `Traffic recovered in ${event.recovery_time_ms} ms`,
    unreachable: (event) => `Packet ${event.sequence + 1} could not reach the destination`,
  };

  function renderEvents(events) {
    $("event-count").textContent = `${events.length} event${events.length === 1 ? "" : "s"}`;
    const list = $("event-list");
    if (!events.length) {
      list.innerHTML = '<li class="event-empty">No transmission events were recorded.</li>';
      return;
    }
    list.replaceChildren(...events.map((event) => {
      const item = document.createElement("li");
      item.className = `event-item event-${event.type}`;
      const time = document.createElement("time"); time.textContent = `${event.time_ms} ms`;
      const marker = document.createElement("span"); marker.className = "event-marker";
      const description = document.createElement("span"); description.textContent = (eventText[event.type] || (() => event.type))(event);
      item.append(time, marker, description);
      return item;
    }));
  }

  function renderIntegrity(result) {
    const okay = result.integrity.ok;
    $("integrity-pill").textContent = okay ? "Verified" : "Incomplete";
    $("integrity-pill").className = `status-pill ${okay ? "status-good" : "status-bad"}`;
    const message = $("received-message");
    message.textContent = result.reconstructed_message ?? "Message incomplete: one or more packets were not recovered.";
    message.classList.toggle("empty-message", !result.reconstructed_message);
    const line = $("checksum-line");
    if (result.integrity.received_sha256) {
      line.replaceChildren(document.createTextNode("SHA-256 "), Object.assign(document.createElement("code"), { textContent: result.integrity.received_sha256 }));
    } else {
      line.textContent = "No complete-message checksum available.";
    }
  }

  /* Draw the routes on the network as it was before the run, replay the run's events on it,
     then show the network as the run left it (a scheduled failure goes down during the replay). */
  async function showRun(result) {
    state.lastEvents = result.events;
    state.finalTopology = result.final_topology;
    renderRoutes(result.paths);
    $("replay-button").hidden = false;
    await TopologyView.play($("topology-wrap"), result.events);
    applyFinalTopology();
  }

  function applyFinalTopology() {
    if (!state.finalTopology) return;
    state.topology = { ...state.topology, ...state.finalTopology };
    renderTopology();
  }

  async function replay() {
    if (!state.lastEvents || !state.preRunTopology) return;
    state.topology = state.preRunTopology;
    renderTopology();
    await TopologyView.play($("topology-wrap"), state.lastEvents);
    applyFinalTopology();
  }

  function renderSingle(result) {
    state.routes = result.paths || [];
    updateSummary(result.metrics, result.paths, result.mode, result.final_routes.length);
    SimulatorCharts.renderMetrics($("comparison-view"), result.metrics);
    renderPackets(result.packets);
    renderEvents(result.events);
    renderIntegrity(result);
    setFinding(findingFor(result, `${modeNames[result.mode] || result.mode}`));
    showRun(result);
  }

  function renderComparison(result) {
    const selected = result.multipath;
    state.routes = selected.paths || [];
    updateSummary(selected.metrics, selected.paths, "compare", selected.final_routes.length, result.single.metrics);
    SimulatorCharts.renderComparison($("comparison-view"), result.single.metrics, selected.metrics);
    renderPackets(selected.packets);
    renderEvents(selected.events);
    renderIntegrity(selected);
    const s = result.single.metrics;
    setFinding(`${findingFor(selected, "Multipath")} Single path delivered ${s.delivered_packets} of ${s.total_packets}.`);
    showRun(selected);
  }

  function requestBody() {
    const body = {
      source: $("source-select").value,
      destination: $("destination-select").value,
      message: $("message-input").value,
      packet_size: Number($("packet-size").value),
      k: Number($("route-count").value),
      loss_probability: Number($("loss-range").value) / 100,
      seed: 7,
      max_retries: 3,
    };
    if ($("scheduled-failure").checked) {
      const [source, target] = $("failure-link").value.split("|");
      body.failure = { source, target, after_transmissions: Number($("failure-after").value) };
    }
    return body;
  }

  async function runExperiment(event) {
    event?.preventDefault();
    if ($("source-select").value === $("destination-select").value) {
      showError("Choose different source and destination nodes.");
      return;
    }
    const button = $("experiment-form").querySelector('[type="submit"]');
    button.disabled = true;
    button.innerHTML = '<span class="button-spinner"></span> Simulating…';
    clearError();
    try {
      state.preRunTopology = state.topology;
      const data = await api("/api/simulate", { method: "POST", body: JSON.stringify({ ...requestBody(), mode: $("mode-select").value }) });
      state.lastResult = data;
      renderSingle(data);
    } catch (error) { showError(error.message); }
    finally { button.disabled = false; button.textContent = "Run experiment"; }
  }

  async function compareModes() {
    if ($("source-select").value === $("destination-select").value) {
      showError("Choose different source and destination nodes.");
      return;
    }
    const button = $("compare-button");
    button.disabled = true; button.textContent = "Comparing…"; clearError();
    try {
      state.preRunTopology = state.topology;
      const data = await api("/api/compare", { method: "POST", body: JSON.stringify(requestBody()) });
      state.lastResult = data;
      renderComparison(data);
    } catch (error) { showError(error.message); }
    finally { button.disabled = false; button.textContent = "Compare modes"; }
  }

  function showError(message) {
    clearError();
    const notice = document.createElement("div");
    notice.className = "error-notice"; notice.setAttribute("role", "alert"); notice.textContent = message;
    $("experiment-form").prepend(notice);
  }
  function clearError() { document.querySelector(".error-notice")?.remove(); }

  async function toggleLink() {
    const link = selectedLink();
    if (!link) return;
    try {
      const data = await api("/api/failure", { method: "POST", body: JSON.stringify({ source: link.source, target: link.target, available: !link.available }) });
      state.topology = data.topology;
      state.finalTopology = null;
      renderTopology();
      if (!state.lastResult) idleFinding();
      clearError();
    } catch (error) { showError(error.message); }
  }

  async function resetNetwork() {
    try {
      TopologyView.stop();
      const data = await api("/api/reset", { method: "POST" });
      state.topology = data; state.routes = []; state.lastResult = null; state.lastEvents = null; state.finalTopology = null;
      populateNodes();
      renderTopology(); renderRoutes([]);
      $("topology-json").value = JSON.stringify(data, null, 2);
      ["delivered-value", "delivery-value", "routes-value", "retry-value"].forEach((id) => $(id).textContent = "—");
      $("sent-note").textContent = "Run an experiment to begin";
      document.querySelector(".kpi-lead .kpi-note").textContent = "Unique packets received";
      $("result-mode").textContent = "No run yet";
      $("replay-button").hidden = true;
      $("comparison-view").innerHTML = '<p class="empty-state">Run a simulation to see delivery, latency, throughput and recovery.</p>';
      $("received-message").textContent = "The reconstructed message appears here after delivery.";
      $("received-message").classList.add("empty-message");
      $("integrity-pill").textContent = "Waiting"; $("integrity-pill").className = "status-pill status-idle";
      $("checksum-line").textContent = ""; $("packet-count").textContent = "0 packets";
      $("event-count").textContent = "0 events";
      $("packet-rows").innerHTML = '<tr><td colspan="5" class="table-empty">Packet outcomes appear after a simulation.</td></tr>';
      $("packet-segments").replaceChildren();
      $("event-list").innerHTML = '<li class="event-empty">Transmission and recovery events appear here.</li>';
      idleFinding();
      clearError();
    } catch (error) { showError(error.message); }
  }

  async function applyTopology() {
    try {
      const parsed = JSON.parse($("topology-json").value);
      const data = await api("/api/topology", { method: "POST", body: JSON.stringify(parsed) });
      state.topology = data;
      state.routes = []; state.finalTopology = null;
      populateNodes();
      renderRoutes([]);
      $("topology-json").value = JSON.stringify(data, null, 2);
      idleFinding();
      clearError();
    } catch (error) {
      showError(error instanceof SyntaxError ? `Topology JSON is invalid: ${error.message}` : error.message);
    }
  }

  function setMode(mode) {
    $("mode-select").value = mode;
    document.querySelectorAll(".mode-tab").forEach((tab) => tab.setAttribute("aria-checked", String(tab.dataset.mode === mode)));
    $("mode-hint").textContent = modeHints[mode] || "";
  }

  function setLossFill() {
    const range = $("loss-range");
    range.style.setProperty("--fill", `${(range.value / range.max) * 100}%`);
  }

  async function initialize() {
    try {
      state.topology = await api("/api/topology");
      populateNodes(); renderTopology();
      $("topology-json").value = JSON.stringify(state.topology, null, 2);
      setConnection(true, "Simulator connected");
      idleFinding();
    } catch (error) {
      setConnection(false, "Simulator unavailable");
      $("topology-wrap").innerHTML = '<div class="loading-state">Start the Python backend to load the network.</div>';
      setFinding("The simulator backend is not running. Start it with <code>python -m backend.app</code> and reload.");
      showError(error.message);
    }
  }

  $("experiment-form").addEventListener("submit", runExperiment);
  $("compare-button").addEventListener("click", compareModes);
  $("toggle-link").addEventListener("click", toggleLink);
  $("reset-button").addEventListener("click", resetNetwork);
  $("load-topology").addEventListener("click", applyTopology);
  $("replay-button").addEventListener("click", replay);
  $("scheduled-failure").addEventListener("change", (event) => { $("scheduled-fields").hidden = !event.target.checked; });
  $("loss-range").addEventListener("input", (event) => { $("loss-output").value = `${event.target.value}%`; setLossFill(); });
  $("manual-link").addEventListener("change", () => { $("toggle-link").textContent = selectedLink()?.available ? "Break link" : "Restore link"; });
  document.querySelectorAll(".mode-tab").forEach((tab) => {
    tab.addEventListener("click", () => setMode(tab.dataset.mode));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      const tabs = [...document.querySelectorAll(".mode-tab")];
      const next = tabs[(tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      setMode(next.dataset.mode); next.focus();
    });
  });
  setMode($("mode-select").value);
  setLossFill();
  initialize();
})();
