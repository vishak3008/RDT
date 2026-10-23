from backend.app import app
from backend.simulation import simulate
from backend.topology import Link, Topology


def run(message="reliable message", **overrides):
    options = {
        "source": "S",
        "destination": "D",
        "message": message,
        "mode": "multipath",
        "packet_size": 4,
        "seed": 19,
    }
    options.update(overrides)
    return simulate(Topology.demo(), **options)


def test_normal_transmission_reassembles_message_and_verifies_integrity():
    result = run()

    assert result["reconstructed_message"] == "reliable message"
    assert result["integrity"]["ok"] is True
    assert result["metrics"]["delivery_ratio_percent"] == 100
    assert result["metrics"]["retransmissions"] == 0


def test_dropped_packets_are_retried_and_delivery_counts_unique_packets():
    result = run("abcdefgh", loss_probability=1.0, max_retries=2)

    assert result["reconstructed_message"] is None
    assert result["metrics"]["delivered_packets"] == 0
    assert result["metrics"]["retransmissions"] == 4
    assert result["metrics"]["delivery_ratio_percent"] == 0


def test_link_failure_recalculates_and_recovers_over_an_alternative():
    result = run(
        "this message spans several packets",
        failure={"source": "S", "target": "R1", "after_transmissions": 2},
    )

    event_types = [event["type"] for event in result["events"]]
    assert "link_failure" in event_types
    assert "routes_recalculated" in event_types
    assert "recovery" in event_types
    assert result["metrics"]["recovery_time_ms"] is not None
    assert result["metrics"]["delivery_ratio_percent"] == 100
    assert result["integrity"]["ok"] is True
    failed_link = next(link for link in result["final_topology"]["links"] if {link["source"], link["target"]} == {"S", "R1"})
    assert failed_link["available"] is False


def test_total_outage_is_reported_without_claiming_delivery():
    topology = Topology(
        [{"id": "S", "label": "Source", "type": "computer"}, {"id": "D", "label": "Destination", "type": "computer"}],
        [Link("S", "D", 1)],
    )

    result = simulate(
        topology,
        source="S",
        destination="D",
        message="outage",
        packet_size=10,
        failure={"source": "S", "target": "D", "after_transmissions": 0},
    )

    assert result["metrics"]["delivery_ratio_percent"] == 0
    assert result["packets"][0]["status"] == "lost"
    assert any(event["type"] == "unreachable" for event in result["events"])
    assert result["integrity"]["ok"] is False


def test_simulation_does_not_mutate_the_shared_topology():
    topology = Topology.demo()

    simulate(
        topology,
        source="S",
        destination="D",
        message="hello",
        failure={"source": "S", "target": "R1", "after_transmissions": 0},
    )

    assert next(link for link in topology.links if {link.source, link.target} == {"S", "R1"}).available is True


def test_congestion_aware_mode_rechecks_load_and_uses_multiple_routes():
    result = run("x" * 240, mode="congestion_aware", packet_size=1, k=3)

    used_routes = {tuple(packet["route"]) for packet in result["packets"] if packet["route"]}
    congestion_events = [event for event in result["events"] if event["type"] == "congestion_route_selected"]

    assert result["mode"] == "congestion_aware"
    assert len(used_routes) > 1
    assert len(congestion_events) == len(result["packets"])
    assert result["integrity"]["ok"] is True


def test_api_accepts_congestion_aware_routing_mode():
    client = app.test_client()
    client.post("/api/reset")

    response = client.post(
        "/api/simulate",
        json={"source": "S", "destination": "D", "message": "route by load", "mode": "congestion_aware", "packet_size": 4},
    )

    assert response.status_code == 200
    assert response.get_json()["mode"] == "congestion_aware"
    assert any(event["type"] == "congestion_route_selected" for event in response.get_json()["events"])
    client.post("/api/reset")


def test_compare_endpoint_uses_same_input_and_seed_for_both_modes():
    client = app.test_client()
    client.post("/api/reset")

    response = client.post(
        "/api/compare",
        json={"source": "S", "destination": "D", "message": "same conditions", "packet_size": 4, "loss_probability": 0.4, "seed": 11},
    )

    assert response.status_code == 200
    data = response.get_json()
    assert data["single"]["mode"] == "single"
    assert data["multipath"]["mode"] == "multipath"
    assert [packet["status"] for packet in data["single"]["packets"]] == [packet["status"] for packet in data["multipath"]["packets"]]
    assert data["single"]["metrics"]["delivery_ratio_percent"] == data["multipath"]["metrics"]["delivery_ratio_percent"]


def test_dashboard_and_topology_endpoints_are_served():
    client = app.test_client()

    page = client.get("/")
    topology = client.get("/api/topology")

    assert page.status_code == 200
    assert b"Network Reliability Simulator" in page.data
    assert topology.status_code == 200
    assert len(topology.get_json()["nodes"]) == 6


def test_custom_topology_can_be_loaded_and_used_for_route_queries():
    client = app.test_client()
    client.post("/api/reset")
    custom = {
        "nodes": [
            {"id": "A", "label": "Computer A", "type": "computer"},
            {"id": "B", "label": "Router B", "type": "router"},
            {"id": "Z", "label": "Computer Z", "type": "computer"},
        ],
        "links": [
            {"source": "A", "target": "B", "cost": 2, "delay_ms": 3},
            {"source": "B", "target": "Z", "cost": 4, "delay_ms": 5},
        ],
    }

    loaded = client.post("/api/topology", json=custom)
    routes = client.post("/api/routes", json={"source": "A", "destination": "Z", "k": 2})

    assert loaded.status_code == 200
    assert [node["id"] for node in loaded.get_json()["nodes"]] == ["A", "B", "Z"]
    assert routes.get_json()["paths"] == [{"nodes": ["A", "B", "Z"], "cost": 6.0}]
    client.post("/api/reset")


def test_invalid_custom_topology_is_rejected_without_replacing_current_network():
    client = app.test_client()
    client.post("/api/reset")
    invalid = {
        "nodes": [{"id": "A", "label": "A", "type": "computer"}],
        "links": [{"source": "A", "target": "missing", "cost": 1}],
    }

    response = client.post("/api/topology", json=invalid)
    current = client.get("/api/topology").get_json()

    assert response.status_code == 400
    assert "unknown node" in response.get_json()["error"].lower()
    assert len(current["nodes"]) == 6
