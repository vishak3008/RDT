/* Small, dependency-free comparison chart. */
(function () {
  const metricSpecs = [
    { key: "delivery_ratio_percent", label: "Delivery ratio", unit: "%", higher: true },
    { key: "average_latency_ms", label: "Average latency", unit: " ms", higher: false },
    { key: "throughput_bps", label: "Throughput", unit: " bps", higher: true },
    { key: "retransmissions", label: "Retransmissions", unit: "", higher: false },
    { key: "recovery_time_ms", label: "Recovery time", unit: " ms", higher: false },
  ];

  function format(value, unit) {
    return value == null ? "—" : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit}`;
  }

  function renderComparison(container, single, multipath) {
    container.replaceChildren();
    const key = document.createElement("div");
    key.className = "chart-key";
    key.innerHTML = '<span><i class="key-swatch single-swatch"></i>Single path</span><span><i class="key-swatch multi-swatch"></i>Multipath</span>';
    container.appendChild(key);

    metricSpecs.forEach((spec) => {
      const a = single[spec.key];
      const b = multipath[spec.key];
      const numeric = [a, b].filter((value) => value != null).map(Number);
      const max = Math.max(...numeric, 1);
      const row = document.createElement("div");
      row.className = "compare-row";
      const label = document.createElement("div");
      label.className = "compare-label";
      const favorable = a != null && b != null && (spec.higher ? b >= a : b <= a);
      label.innerHTML = `<span>${spec.label}</span><span class="compare-values">${format(a, spec.unit)} <b>·</b> ${format(b, spec.unit)}</span>`;
      if (a != null && b != null && a !== b) label.classList.add(favorable ? "multi-favorable" : "multi-unfavorable");
      row.appendChild(label);
      [
        [a, "single-bar"], [b, "multi-bar"],
      ].forEach(([value, className]) => {
        const track = document.createElement("div");
        track.className = "bar-track";
        const bar = document.createElement("span");
        bar.className = `compare-bar ${className}`;
        bar.style.width = value == null ? "0%" : `${Math.max(2, Number(value) / max * 100)}%`;
        track.appendChild(bar);
        row.appendChild(track);
      });
      container.appendChild(row);
    });
  }

  function renderMetrics(container, metrics) {
    container.replaceChildren();
    const grid = document.createElement("div");
    grid.className = "single-metrics-grid";
    metricSpecs.forEach((spec) => {
      const card = document.createElement("div");
      card.className = "single-metric";
      card.innerHTML = `<span>${spec.label}</span><strong>${format(metrics[spec.key], spec.unit)}</strong>`;
      grid.appendChild(card);
    });
    container.appendChild(grid);
  }

  window.SimulatorCharts = { renderComparison, renderMetrics };
})();
