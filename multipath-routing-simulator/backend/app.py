"""Small REST API for topology and route queries."""

from flask import Flask, jsonify, request, send_from_directory

from .routing import k_shortest_paths
from .simulation import simulate
from .topology import Topology

app = Flask(__name__, static_folder="../frontend", static_url_path="/assets")
topology = Topology.demo()
latest_result: dict[str, object] | None = None


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/topology")
def get_topology():
    return jsonify(topology.to_dict())


@app.get("/api/results")
def get_results():
    return jsonify({"result": latest_result})


@app.post("/api/topology")
def load_topology():
    global topology, latest_result
    payload = request.get_json(silent=True)
    try:
        replacement = Topology.from_dict(payload)
    except (ValueError, TypeError) as error:
        return jsonify({"error": str(error)}), 400
    topology = replacement
    latest_result = None
    return jsonify(topology.to_dict())


@app.post("/api/routes")
def get_routes():
    payload = request.get_json(silent=True) or {}
    try:
        paths = k_shortest_paths(
            topology,
            str(payload.get("source", "S")),
            str(payload.get("destination", "D")),
            int(payload.get("k", 2)),
            strategy=str(payload.get("strategy", "cost")),
        )
    except (ValueError, TypeError) as error:
        return jsonify({"error": str(error)}), 400
    return jsonify({"paths": paths})


@app.post("/api/failure")
def set_failure():
    payload = request.get_json(silent=True) or {}
    source, target = payload.get("source"), payload.get("target")
    if not isinstance(source, str) or not isinstance(target, str):
        return jsonify({"error": "source and target are required"}), 400
    available = bool(payload.get("available", False))
    if not topology.set_link_state(source, target, available):
        return jsonify({"error": "link not found"}), 404
    return jsonify({"topology": topology.to_dict()})


@app.post("/api/simulate")
def run_simulation():
    global latest_result
    payload = request.get_json(silent=True) or {}
    try:
        result = simulate(
            topology,
            source=str(payload.get("source", "S")),
            destination=str(payload.get("destination", "D")),
            message=payload.get("message", "Reliable data transmission"),
            mode=str(payload.get("mode", "multipath")),
            k=int(payload.get("k", 2)),
            packet_size=int(payload.get("packet_size", 8)),
            loss_probability=float(payload.get("loss_probability", 0.0)),
            max_retries=int(payload.get("max_retries", 3)),
            seed=int(payload.get("seed", 1)),
            failure=payload.get("failure"),
        )
    except (ValueError, TypeError) as error:
        return jsonify({"error": str(error)}), 400
    latest_result = result
    return jsonify(result)


@app.post("/api/compare")
def compare_modes():
    """Run both routing modes with identical inputs and loss conditions."""
    global latest_result
    payload = request.get_json(silent=True) or {}
    try:
        common = {
            "source": str(payload.get("source", "S")),
            "destination": str(payload.get("destination", "D")),
            "message": payload.get("message", "Reliable data transmission"),
            "k": int(payload.get("k", 2)),
            "packet_size": int(payload.get("packet_size", 8)),
            "loss_probability": float(payload.get("loss_probability", 0.0)),
            "max_retries": int(payload.get("max_retries", 3)),
            "seed": int(payload.get("seed", 1)),
            "failure": payload.get("failure"),
        }
        single = simulate(topology, mode="single", **common)
        multipath = simulate(topology, mode="multipath", **common)
    except (ValueError, TypeError) as error:
        return jsonify({"error": str(error)}), 400
    latest_result = {
        "single": single,
        "multipath": multipath,
        "comparison": {
            "delivery_ratio_difference_percent": round(
                multipath["metrics"]["delivery_ratio_percent"] - single["metrics"]["delivery_ratio_percent"], 2
            ),
            "packet_loss_ratio_difference_percent": round(
                multipath["metrics"]["packet_loss_ratio_percent"] - single["metrics"]["packet_loss_ratio_percent"], 2
            ),
            "retransmission_difference": multipath["metrics"]["retransmissions"] - single["metrics"]["retransmissions"],
            "average_latency_difference_ms": (
                round(multipath["metrics"]["average_latency_ms"] - single["metrics"]["average_latency_ms"], 2)
                if multipath["metrics"]["average_latency_ms"] is not None
                and single["metrics"]["average_latency_ms"] is not None else None
            ),
            "throughput_difference_bps": round(
                multipath["metrics"]["throughput_bps"] - single["metrics"]["throughput_bps"], 2
            ),
            "recovery_time_difference_ms": (
                round(multipath["metrics"]["recovery_time_ms"] - single["metrics"]["recovery_time_ms"], 2)
                if multipath["metrics"]["recovery_time_ms"] is not None
                and single["metrics"]["recovery_time_ms"] is not None else None
            ),
        },
    }
    return jsonify(latest_result)


@app.post("/api/reset")
def reset():
    global topology, latest_result
    topology = Topology.demo()
    latest_result = None
    return jsonify(topology.to_dict())


if __name__ == "__main__":
    app.run(debug=False)
