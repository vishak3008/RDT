from backend.routing import k_shortest_paths, shortest_path
from backend.topology import Topology


def test_dijkstra_finds_lowest_cost_route():
    topology = Topology.demo()

    result = shortest_path(topology, "S", "D")

    assert result == (["S", "R1", "R3", "D"], 6)


def test_yen_returns_distinct_loopless_paths_in_cost_order():
    topology = Topology.demo()

    routes = k_shortest_paths(topology, "S", "D", k=3)

    assert len(routes) == 3
    assert [route["cost"] for route in routes] == sorted(route["cost"] for route in routes)
    assert len({tuple(route["nodes"]) for route in routes}) == 3
    for route in routes:
        assert route["nodes"][0] == "S"
        assert route["nodes"][-1] == "D"
        assert len(route["nodes"]) == len(set(route["nodes"]))


def test_unavailable_link_is_excluded_from_route_calculation():
    topology = Topology.demo()
    assert topology.set_link_state("S", "R1", False)

    route, cost = shortest_path(topology, "S", "D")

    assert route[0] == "S" and route[-1] == "D"
    assert "R1" not in route
    assert cost > 0


def test_unknown_endpoint_is_reported():
    topology = Topology.demo()

    try:
        shortest_path(topology, "missing", "D")
    except ValueError as error:
        assert "nodes" in str(error)
    else:
        raise AssertionError("Expected an unknown-node validation error")


def test_congestion_strategy_avoids_heavily_loaded_low_capacity_link():
    topology = Topology.demo()
    loaded_edge = frozenset(("S", "R1"))

    route = k_shortest_paths(
        topology,
        "S",
        "D",
        k=1,
        strategy="congestion",
        estimated_loads={loaded_edge: 5},
    )[0]

    assert "R1" not in route["nodes"]
    assert route["cost"] > route["base_cost"]
    assert route["estimated_delay_ms"] > 0
