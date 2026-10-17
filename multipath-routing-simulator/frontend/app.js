/* Dashboard state and API integration. */
(function () {
  const $ = (id) => document.getElementById(id);
  const state = { topology: null, routes: [], lastResult: null };

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
    const options = state.topology.nodes.map((node) => ({ value: node.id, label: `${node.label} (${node.id})` }));
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
      label: `${link.source} — ${link.target} · cost ${link.cost}${link.available ? "" : " · DOWN"}`,
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

  function renderTopology() {
    if (!state.topology) return;
    TopologyView.render($("topology-wrap"), state.topology, state.routes);
    const liveLinks = state.topology.links.filter((link) => link.available).length;
    $("topology-count").textContent = `${state.topology.nodes.length} nodes · ${liveLinks}/${state.topology.links.length} links active`;
    populateLinks();
  }

  function updateSummary(metrics, routes, mode, activeRouteCount = routes.length) {
    $("delivered-value").textContent = `${metrics.delivered_packets}/${metrics.total_packets}`;
    $("sent-note").textContent = `${metrics.total_packets} unique packets created`;
    $("delivery-value").textContent = `${metrics.delivery_ratio_percent}%`;
    $("routes-value").textContent = String(activeRouteCount);
    $("retry-value").textContent = String(metrics.retransmissions);
    const modeLabel = { congestion_aware: "CONGESTION-AWARE", multipath: "MULTIPATH", single: "SINGLE" }[mode] || mode.toUpperCase();
    $("result-mode").textContent = mode === "compare" ? "MODE COMPARISON" : `${modeLabel} ROUTING`;
  }

  function renderRoutes(routes) {
    state.routes = routes || [];
    const summary = $("route-summary");
    if (!state.routes.length) {
      summary.innerHTML = '<span class="muted">Run an experiment to highlight selected routes.</span>';
    } else {
      summary.replaceChildren(...state.routes.map((route, index) => {
        const item = document.createElement("span");
        item.className = "route-chip";
        item.style.setProperty("--route-color", ["#30c5a1", "#5596ff", "#f0b44d"][index % 3]);
        const score = route.base_cost === undefined
          ? `cost ${route.cost}`
          : `score ${Number(route.cost).toFixed(2)} · base ${route.base_cost} · ${route.estimated_delay_ms} ms`;
        item.textContent = `Route ${index + 1} · ${route.nodes.join(" → ")} · ${score}`;
        return item;
      }));
    }
    renderTopology();
  }

  function renderPackets(packets) {
    $("packet-count").textContent = `${packets.length} packet${packets.length === 1 ? "" : "s"}`;
    const body = $("packet-rows");
    if (!packets.length) {
      body.innerHTML = '<tr><td colspan="5" class="table-empty">No packets were created.</td></tr>';
      return;
    }
    body.replaceChildren(...packets.map((packet) => {
      const row = document.createElement("tr");
      const sequence = document.createElement("td"); sequence.textContent = String(packet.sequence + 1);
      const payload = document.createElement("td"); payload.className = "payload-cell"; payload.textContent = packet.payload || "(empty)";
      const status = document.createElement("td");
      const pill = document.createElement("span"); pill.className = `packet-status ${packet.status}`; pill.textContent = packet.status;
      status.appendChild(pill);
      const route = document.createElement("td"); route.textContent = packet.route ? packet.route.join(" → ") : "—";
      const delay = document.createElement("td"); delay.textContent = `${packet.delay_ms} ms`;
      [sequence, payload, status, route, delay].forEach((cell) => row.appendChild(cell));
      return row;
    }));
  }

  const eventText = {
    transmission: (event) => `Packet ${event.sequence + 1} sent · try ${event.attempt} · ${event.route.join(" → ")}`,
    packet_dropped: (event) => `Packet ${event.sequence + 1} dropped on try ${event.attempt}`,
    retransmission: (event) => `Retrying packet ${event.sequence + 1} · try ${event.next_attempt}`,
    acknowledgement: (event) => `Packet ${event.sequence + 1} acknowledged`,
    congestion_route_selected: (event) => `Congestion-aware choice · packet ${event.sequence + 1} · score ${event.objective_cost} · ${event.route.join(" → ")}`,
    link_failure: (event) => `Link ${event.source} — ${event.target} failed`,
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
    $("integrity-pill").textContent = okay ? "VERIFIED" : "INCOMPLETE";
    $("integrity-pill").className = `status-pill ${okay ? "status-good" : "status-bad"}`;
    const message = $("received-message");
    message.textContent = result.reconstructed_message ?? "Message incomplete: one or more packets were not recovered.";
    message.classList.toggle("empty-message", !result.reconstructed_message);
    $("checksum-line").textContent = result.integrity.received_sha256 ? `SHA-256 · ${result.integrity.received_sha256}` : "No complete-message checksum available.";
  }

  function renderSingle(result) {
    updateSummary(result.metrics, result.paths, result.mode, result.final_routes.length);
    SimulatorCharts.renderMetrics($("comparison-view"), result.metrics);
    renderRoutes(result.paths);
    renderPackets(result.packets);
    renderEvents(result.events);
    renderIntegrity(result);
    state.topology = { ...state.topology, ...result.final_topology };
    renderTopology();
  }

  function renderComparison(result) {
    const selected = result.multipath;
    updateSummary(selected.metrics, selected.paths, "compare", selected.final_routes.length);
    SimulatorCharts.renderComparison($("comparison-view"), result.single.metrics, selected.metrics);
    renderRoutes(selected.paths);
    renderPackets(selected.packets);
    renderEvents(selected.events);
    renderIntegrity(selected);
    state.topology = { ...state.topology, ...selected.final_topology };
    renderTopology();
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
      const data = await api("/api/simulate", { method: "POST", body: JSON.stringify({ ...requestBody(), mode: $("mode-select").value }) });
      state.lastResult = data;
      renderSingle(data);
    } catch (error) { showError(error.message); }
    finally { button.disabled = false; button.innerHTML = '<span aria-hidden="true">▶</span> Run experiment'; }
  }

  async function compareModes() {
    if ($("source-select").value === $("destination-select").value) {
      showError("Choose different source and destination nodes.");
      return;
    }
    const button = $("compare-button");
    button.disabled = true; button.textContent = "Comparing…"; clearError();
    try {
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
      renderTopology();
      clearError();
    } catch (error) { showError(error.message); }
  }

  async function resetNetwork() {
    try {
      const data = await api("/api/reset", { method: "POST" });
      state.topology = data; state.routes = []; state.lastResult = null;
      populateNodes();
      renderTopology(); renderRoutes([]);
      $("topology-json").value = JSON.stringify(data, null, 2);
      ["delivered-value", "delivery-value", "routes-value", "retry-value"].forEach((id) => $(id).textContent = "—");
      $("sent-note").textContent = "Run an experiment to begin";
      $("result-mode").textContent = "NO RUN YET";
      $("comparison-view").innerHTML = '<p class="empty-state">Run a simulation to see delivery, latency, throughput, and recovery measurements.</p>';
      $("received-message").textContent = "The reconstructed message will appear here after delivery.";
      $("received-message").classList.add("empty-message");
      $("integrity-pill").textContent = "WAITING"; $("integrity-pill").className = "status-pill status-idle";
      $("checksum-line").textContent = ""; $("packet-count").textContent = "0 packets";
      $("event-count").textContent = "0 events";
      $("packet-rows").innerHTML = '<tr><td colspan="5" class="table-empty">Packet outcomes appear after a simulation.</td></tr>';
      $("event-list").innerHTML = '<li class="event-empty">Transmission and recovery events appear here.</li>';
      clearError();
    } catch (error) { showError(error.message); }
  }

  async function applyTopology() {
    try {
      const parsed = JSON.parse($("topology-json").value);
      const data = await api("/api/topology", { method: "POST", body: JSON.stringify(parsed) });
      state.topology = data;
      state.routes = [];
      populateNodes();
      renderRoutes([]);
      $("topology-json").value = JSON.stringify(data, null, 2);
      clearError();
    } catch (error) {
      showError(error instanceof SyntaxError ? `Topology JSON is invalid: ${error.message}` : error.message);
    }
  }

  async function initialize() {
    try {
      state.topology = await api("/api/topology");
      populateNodes(); renderTopology();
      $("topology-json").value = JSON.stringify(state.topology, null, 2);
      setConnection(true, "Simulator connected");
    } catch (error) {
      setConnection(false, "Simulator unavailable");
      $("topology-wrap").innerHTML = '<div class="loading-state">Start the Python backend to load the network.</div>';
      showError(error.message);
    }
  }

  $("experiment-form").addEventListener("submit", runExperiment);
  $("compare-button").addEventListener("click", compareModes);
  $("toggle-link").addEventListener("click", toggleLink);
  $("reset-button").addEventListener("click", resetNetwork);
  $("load-topology").addEventListener("click", applyTopology);
  $("scheduled-failure").addEventListener("change", (event) => { $("scheduled-fields").hidden = !event.target.checked; });
  $("loss-range").addEventListener("input", (event) => { $("loss-output").value = `${event.target.value}%`; });
  $("manual-link").addEventListener("change", () => { $("toggle-link").textContent = selectedLink()?.available ? "Break link" : "Restore link"; });
  initialize();
})();
