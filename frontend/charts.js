/* Performance views: a divided strip for one run, a side-by-side table for a mode comparison. */
(function () {
  const metricSpecs = [
    { key: "delivery_ratio_percent", label: "Delivery ratio", unit: "%", digits: 1, higher: true },
    { key: "average_latency_ms", label: "Average latency", unit: " ms", digits: 1, higher: false },
    { key: "throughput_bps", label: "Throughput", unit: " bps", digits: 0, higher: true },
    { key: "retransmissions", label: "Retransmissions", unit: "", digits: 0, higher: false },
    { key: "recovery_time_ms", label: "Recovery time", unit: " ms", digits: 1, higher: false },
  ];

  function format(value, spec) {
    if (value == null) return "—";
    return `${Number(value).toLocaleString("en-US", { minimumFractionDigits: spec.digits, maximumFractionDigits: spec.digits })}${spec.unit}`;
  }

  function cell(tag, text, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  }

  function renderComparison(container, single, multipath) {
    container.replaceChildren();
    const table = document.createElement("table");
    table.className = "metric-table arrive";
    const head = document.createElement("tr");
    head.append(cell("th", "Metric"), cell("th", "Single path", "num"), cell("th", "Multipath", "num"), cell("th", "Change with multipath", "num"), cell("th", "", "bar-cell"));
    const thead = document.createElement("thead"); thead.appendChild(head);
    const tbody = document.createElement("tbody");

    metricSpecs.forEach((spec) => {
      const a = single[spec.key];
      const b = multipath[spec.key];
      const row = document.createElement("tr");
      row.appendChild(cell("td", spec.label));
      row.appendChild(cell("td", format(a, spec), "num dim"));
      row.appendChild(cell("td", format(b, spec), "num"));

      let deltaText = "—";
      let deltaClass = "num delta";
      if (a != null && b != null) {
        const diff = Number(b) - Number(a);
        const rounded = Number(diff.toFixed(spec.digits));
        if (rounded === 0) {
          deltaText = "No change";
        } else {
          const sign = rounded > 0 ? "+" : "−";
          deltaText = `${sign}${format(Math.abs(rounded), spec)}`;
          const better = spec.higher ? rounded > 0 : rounded < 0;
          deltaText += better ? " better" : " worse";
          deltaClass += better ? " better" : " worse";
        }
      }
      row.appendChild(cell("td", deltaText, deltaClass));

      const barCell = document.createElement("td");
      barCell.className = "bar-cell";
      const values = [a, b].filter((v) => v != null).map(Number);
      const max = Math.max(...values, 0);
      if (max > 0) {
        const bars = document.createElement("div");
        bars.className = "mini-bars";
        [[a, ""], [b, "multi"]].forEach(([value, className]) => {
          const bar = document.createElement("i");
          if (className) bar.className = className;
          bar.style.width = value == null ? "0" : `${(Number(value) / max) * 100}%`;
          bars.appendChild(bar);
        });
        barCell.appendChild(bars);
      }
      row.appendChild(barCell);
      tbody.appendChild(row);
    });
    table.append(thead, tbody);
    container.appendChild(table);

    const key = document.createElement("div");
    key.className = "table-key";
    key.innerHTML = '<span><i></i>Single path</span><span><i class="multi"></i>Multipath</span><span>Same message, same loss pattern, same seed.</span>';
    container.appendChild(key);
  }

  function renderMetrics(container, metrics) {
    container.replaceChildren();
    const grid = document.createElement("div");
    grid.className = "single-metrics-grid arrive";
    metricSpecs.forEach((spec) => {
      const item = document.createElement("div");
      item.className = "single-metric";
      item.append(cell("span", spec.label), cell("strong", format(metrics[spec.key], spec)));
      grid.appendChild(item);
    });
    container.appendChild(grid);
  }

  window.SimulatorCharts = { renderComparison, renderMetrics, format, metricSpecs };
})();
