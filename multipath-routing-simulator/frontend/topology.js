/* SVG topology drawing helpers. */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const positions = {
    S: [65, 180], R1: [230, 70], R2: [230, 290],
    R3: [515, 70], R4: [515, 290], D: [710, 180],
  };
  const palette = ["#30c5a1", "#5596ff", "#f0b44d"];
  const edgeKey = (a, b) => [a, b].sort().join("|");

  function layoutFor(nodes) {
    const layout = { ...positions };
    const customNodes = nodes.filter((node) => !layout[node.id]);
    customNodes.forEach((node, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / customNodes.length;
      layout[node.id] = [390 + 285 * Math.cos(angle), 180 + 115 * Math.sin(angle)];
    });
    return layout;
  }

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS(NS, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  }

  function render(container, topology, routes = []) {
    const nodePositions = layoutFor(topology.nodes);
    const svg = svgElement("svg", { viewBox: "0 0 780 360", role: "img", "aria-label": "Network topology with computers, routers, and communication links" });
    const highlighted = new Map();
    routes.forEach((route, routeIndex) => {
      const nodes = route.nodes || route;
      nodes.slice(1).forEach((node, index) => {
        const key = edgeKey(nodes[index], node);
        if (!highlighted.has(key)) highlighted.set(key, palette[routeIndex % palette.length]);
      });
    });

    topology.links.forEach((link) => {
      const start = nodePositions[link.source] || [120, 180];
      const end = nodePositions[link.target] || [650, 180];
      const group = svgElement("g", { class: `link-group${link.available ? "" : " is-down"}` });
      const line = svgElement("line", {
        x1: start[0], y1: start[1], x2: end[0], y2: end[1],
        class: "network-link",
      });
      const key = edgeKey(link.source, link.target);
      if (highlighted.has(key) && link.available) {
        line.classList.add("is-route");
        line.style.setProperty("--route-color", highlighted.get(key));
      }
      group.appendChild(line);
      const middleX = (start[0] + end[0]) / 2;
      const middleY = (start[1] + end[1]) / 2;
      const label = svgElement("text", { x: middleX, y: middleY - 8, class: "link-label" });
      label.textContent = link.available ? String(link.cost) : "DOWN";
      group.appendChild(label);
      const title = svgElement("title");
      title.textContent = `${link.source} to ${link.target}, cost ${link.cost}, ${link.available ? "available" : "down"}`;
      group.appendChild(title);
      svg.appendChild(group);
    });

    topology.nodes.forEach((node) => {
      const [x, y] = nodePositions[node.id] || [380, 180];
      const isEndpoint = node.type === "computer";
      const group = svgElement("g", { class: `network-node${isEndpoint ? " endpoint" : ""}` });
      group.appendChild(svgElement("circle", { cx: x, cy: y, r: isEndpoint ? 25 : 22 }));
      const symbol = svgElement("text", { x, y: y + 4, class: "node-symbol" });
      symbol.textContent = node.id;
      group.appendChild(symbol);
      const caption = svgElement("text", { x, y: y + 43, class: "node-caption" });
      caption.textContent = node.label;
      group.appendChild(caption);
      svg.appendChild(group);
    });

    container.replaceChildren(svg);
  }

  window.TopologyView = { render, edgeKey };
})();
