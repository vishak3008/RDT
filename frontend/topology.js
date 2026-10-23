/* SVG topology drawing and packet playback. */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const W = 780, H = 470;
  const positions = {
    S: [70, 235], R1: [255, 82], R2: [255, 388],
    R3: [525, 82], R4: [525, 388], D: [710, 235],
  };
  const routeVars = ["--route-1", "--route-2", "--route-3"];
  const edgeKey = (a, b) => [a, b].sort().join("|");
  let playback = null;

  function routeColor(index) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(routeVars[index % routeVars.length]).trim();
    return value || "#4a8ad6";
  }

  function layoutFor(nodes) {
    const layout = {};
    const custom = [];
    nodes.forEach((node) => (positions[node.id] ? (layout[node.id] = positions[node.id]) : custom.push(node)));
    custom.forEach((node, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / custom.length;
      layout[node.id] = [390 + 290 * Math.cos(angle), 235 + 160 * Math.sin(angle)];
    });
    return layout;
  }

  function el(name, attributes = {}) {
    const element = document.createElementNS(NS, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  }

  function render(container, topology, routes = []) {
    stop();
    const layout = layoutFor(topology.nodes);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Network topology with computers, routers and links" });
    const highlighted = new Map();
    routes.forEach((route, routeIndex) => {
      const nodes = route.nodes || route;
      nodes.slice(1).forEach((node, index) => {
        const key = edgeKey(nodes[index], node);
        if (!highlighted.has(key)) highlighted.set(key, routeColor(routeIndex));
      });
    });

    const linkLayer = el("g");
    topology.links.forEach((link) => {
      const start = layout[link.source] || [120, 235];
      const end = layout[link.target] || [660, 235];
      const key = edgeKey(link.source, link.target);
      const group = el("g", { class: `link-group${link.available ? "" : " is-down"}`, "data-edge": key });
      const line = el("line", { x1: start[0], y1: start[1], x2: end[0], y2: end[1], class: "network-link" });
      if (highlighted.has(key) && link.available) {
        line.classList.add("is-route");
        line.style.setProperty("--route-color", highlighted.get(key));
      }
      group.appendChild(line);
      const label = el("text", { x: (start[0] + end[0]) / 2, y: (start[1] + end[1]) / 2 - 9, class: "link-label" });
      label.textContent = link.available ? String(link.cost) : "down";
      group.appendChild(label);
      const title = el("title");
      title.textContent = `${link.source} to ${link.target}, cost ${link.cost}, ${link.delay_ms ?? 1} ms, ${link.available ? "available" : "down"}`;
      group.appendChild(title);
      linkLayer.appendChild(group);
    });
    svg.appendChild(linkLayer);

    svg.appendChild(el("g", { class: "packet-layer" }));

    topology.nodes.forEach((node) => {
      const [x, y] = layout[node.id] || [390, 235];
      const isEndpoint = node.type === "computer";
      const group = el("g", { class: `network-node${isEndpoint ? " endpoint" : ""}`, "data-node": node.id });
      group.appendChild(isEndpoint
        ? el("rect", { x: x - 25, y: y - 25, width: 50, height: 50, rx: 6, class: "node-shape" })
        : el("circle", { cx: x, cy: y, r: 23, class: "node-shape" }));
      const symbol = el("text", { x, y, class: "node-symbol" });
      symbol.textContent = node.id;
      group.appendChild(symbol);
      const below = y > H / 2;
      const caption = el("text", { x, y: y + (below ? 46 : -36), class: `node-caption${below ? " below" : " above"}` });
      caption.textContent = node.label;
      group.appendChild(caption);
      const title = el("title");
      title.textContent = `${node.label} (${node.id}), ${node.type || "router"}`;
      group.appendChild(title);
      svg.appendChild(group);
    });

    svg.__layout = layout;
    svg.__topology = topology;
    container.replaceChildren(svg);
  }

  function stop() {
    if (playback) { playback.cancelled = true; playback = null; }
  }

  const wait = (ms, run) => new Promise((resolve) => setTimeout(() => resolve(!run.cancelled), ms));

  function animateAlong(dot, points, duration, stopAt = 1) {
    const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
    const total = lengths.reduce((a, b) => a + b, 0);
    const keyframes = [];
    let travelled = 0;
    keyframes.push({ transform: `translate(${points[0][0]}px, ${points[0][1]}px)`, offset: 0 });
    for (let i = 1; i < points.length; i += 1) {
      travelled += lengths[i - 1];
      const offset = Math.min(travelled / total, 1);
      keyframes.push({ transform: `translate(${points[i][0]}px, ${points[i][1]}px)`, offset });
    }
    const animation = dot.animate(keyframes, { duration: duration / stopAt, easing: "linear", fill: "forwards" });
    if (stopAt < 1) setTimeout(() => animation.pause(), duration);
    return animation;
  }

  /* Replays a simulation's own event log on the map: each transmission travels its route,
     a drop turns the packet red and fades it mid-route, an acknowledgement pulses the destination,
     a link failure flashes the link before it goes down. */
  async function play(container, events, finalTopology) {
    stop();
    const svg = container.querySelector("svg");
    if (!svg || !events?.length) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const run = { cancelled: false };
    playback = run;
    const layer = svg.querySelector(".packet-layer");
    const layout = svg.__layout;
    const routeKeys = [...svg.querySelectorAll(".network-link.is-route")].map((line) => line.parentNode.dataset.edge);
    const colourFor = (route) => {
      const first = edgeKey(route[0], route[1]);
      const line = svg.querySelector(`[data-edge="${first}"] .network-link.is-route`);
      return line ? line.style.getPropertyValue("--route-color") : getComputedStyle(document.documentElement).getPropertyValue("--text");
    };
    const step = reduce ? 0 : 620;

    for (let i = 0; i < events.length; i += 1) {
      const event = events[i];
      if (run.cancelled) return;
      if (event.type === "transmission") {
        const points = event.route.map((id) => layout[id]).filter(Boolean);
        if (points.length < 2) continue;
        const next = events[i + 1];
        const dropped = next && next.type === "packet_dropped" && next.sequence === event.sequence;
        const dot = el("circle", { r: 8, cx: 0, cy: 0, class: "packet-dot" });
        dot.style.fill = colourFor(event.route);
        layer.appendChild(dot);
        if (reduce) { dot.remove(); continue; }
        animateAlong(dot, points, dropped ? step * 0.55 : step, dropped ? 0.55 : 1);
        if (!(await wait(dropped ? step * 0.55 : step, run))) return;
        if (dropped) {
          dot.classList.add("lost");
          dot.style.fill = "";
          dot.animate([{ opacity: 1, r: 8 }, { opacity: 0, r: 14 }], { duration: 420, fill: "forwards" });
          setTimeout(() => dot.remove(), 440);
        } else {
          dot.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: "forwards" });
          setTimeout(() => dot.remove(), 240);
        }
      } else if (event.type === "acknowledgement") {
        const destination = event.route?.[event.route.length - 1];
        const node = svg.querySelector(`[data-node="${destination}"]`);
        if (node && !reduce) { node.classList.remove("receive"); void node.getBBox(); node.classList.add("receive"); }
      } else if (event.type === "link_failure") {
        const group = svg.querySelector(`[data-edge="${edgeKey(event.source, event.target)}"]`);
        if (group) {
          group.classList.add("flash");
          if (!(await wait(reduce ? 0 : 900, run))) return;
          group.classList.remove("flash");
          group.classList.add("is-down");
          group.querySelector(".network-link").classList.remove("is-route");
          const label = group.querySelector(".link-label");
          if (label) label.textContent = "down";
        }
      }
    }
    if (playback === run) playback = null;
    return routeKeys;
  }

  window.TopologyView = { render, play, stop, edgeKey, routeColor };
})();
