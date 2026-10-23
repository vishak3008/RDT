"""Dijkstra and Yen K-shortest loopless route algorithms."""

from __future__ import annotations

import heapq
import itertools
from collections.abc import Mapping

from .topology import Link, Topology


def _link_cost(
    topology: Topology,
    link: Link,
    *,
    strategy: str,
    estimated_loads: Mapping[frozenset[str], int] | None,
    delay_weight: float,
    congestion_weight: float,
) -> float:
    if strategy == "cost":
        return link.cost
    if strategy != "congestion":
        raise ValueError("strategy must be 'cost' or 'congestion'")
    reference_capacity = max((item.capacity_mbps for item in topology.links), default=1.0)
    load = (estimated_loads or {}).get(frozenset((link.source, link.target)), 0)
    # A transmission contributes more congestion on a lower-capacity link.
    congestion_penalty = load * reference_capacity / link.capacity_mbps
    return link.cost + delay_weight * link.delay_ms + congestion_weight * congestion_penalty


def path_cost(topology: Topology, path: list[str]) -> float:
    total = 0.0
    for left, right in zip(path, path[1:]):
        edge = next(
            (link for neighbor, link in topology.adjacency()[left] if neighbor == right),
            None,
        )
        if edge is None:
            raise ValueError(f"Path uses unavailable or missing link: {left}–{right}")
        total += edge.cost
    return total


def shortest_path(
    topology: Topology,
    source: str,
    destination: str,
    *,
    excluded_nodes: set[str] | None = None,
    excluded_edges: set[frozenset[str]] | None = None,
    strategy: str = "cost",
    estimated_loads: Mapping[frozenset[str], int] | None = None,
    delay_weight: float = 0.1,
    congestion_weight: float = 1.0,
) -> tuple[list[str], float] | None:
    """Return the minimum-cost path and cost, or None when unreachable."""
    if source not in topology.nodes or destination not in topology.nodes:
        raise ValueError("Source and destination must be nodes in the topology")
    if source == destination:
        return [source], 0.0
    excluded_nodes = excluded_nodes or set()
    graph = topology.adjacency(excluded_edges)
    queue: list[tuple[float, int, str, list[str]]] = [(0.0, 0, source, [source])]
    counter = itertools.count(1)
    best: dict[str, float] = {source: 0.0}
    while queue:
        cost, _, node, path = heapq.heappop(queue)
        if cost > best.get(node, float("inf")):
            continue
        if node == destination:
            return path, cost
        for neighbor, link in graph[node]:
            if neighbor in excluded_nodes or neighbor in path:
                continue
            candidate = cost + _link_cost(
                topology,
                link,
                strategy=strategy,
                estimated_loads=estimated_loads,
                delay_weight=delay_weight,
                congestion_weight=congestion_weight,
            )
            if candidate < best.get(neighbor, float("inf")):
                best[neighbor] = candidate
                heapq.heappush(queue, (candidate, next(counter), neighbor, path + [neighbor]))
    return None


def k_shortest_paths(
    topology: Topology,
    source: str,
    destination: str,
    k: int = 2,
    *,
    strategy: str = "cost",
    estimated_loads: Mapping[frozenset[str], int] | None = None,
    delay_weight: float = 0.1,
    congestion_weight: float = 1.0,
) -> list[dict[str, object]]:
    """Use Yen's algorithm for up to k routes, optionally scored for congestion."""
    if k < 1:
        raise ValueError("k must be at least 1")
    options = {
        "strategy": strategy,
        "estimated_loads": estimated_loads,
        "delay_weight": delay_weight,
        "congestion_weight": congestion_weight,
    }
    first = shortest_path(topology, source, destination, **options)
    if first is None:
        return []
    accepted: list[tuple[list[str], float]] = [first]
    candidates: list[tuple[float, int, list[str]]] = []
    candidate_paths: set[tuple[str, ...]] = set()
    serial = itertools.count()

    for _ in range(1, k):
        previous_path = accepted[-1][0]
        for spur_index in range(len(previous_path) - 1):
            root = previous_path[: spur_index + 1]
            removed_edges: set[frozenset[str]] = set()
            for accepted_path, _cost in accepted:
                if accepted_path[: len(root)] == root and len(accepted_path) > spur_index + 1:
                    removed_edges.add(frozenset((accepted_path[spur_index], accepted_path[spur_index + 1])))
            spur = shortest_path(
                topology,
                root[-1],
                destination,
                excluded_nodes=set(root[:-1]),
                excluded_edges=removed_edges,
                **options,
            )
            if spur is None:
                continue
            combined = root[:-1] + spur[0]
            key = tuple(combined)
            if key in candidate_paths or any(combined == path for path, _ in accepted):
                continue
            cost = _path_cost(topology, combined, **options)
            heapq.heappush(candidates, (cost, next(serial), combined))
            candidate_paths.add(key)
        if not candidates:
            break
        cost, _, path = heapq.heappop(candidates)
        accepted.append((path, cost))

    routes = []
    for path, objective_cost in accepted:
        route: dict[str, object] = {"nodes": path, "cost": objective_cost}
        if strategy == "congestion":
            route["base_cost"] = path_cost(topology, path)
            route["estimated_delay_ms"] = sum(link.delay_ms for link in path_links(topology, path))
        routes.append(route)
    return routes


def _path_cost(
    topology: Topology,
    path: list[str],
    *,
    strategy: str,
    estimated_loads: Mapping[frozenset[str], int] | None,
    delay_weight: float,
    congestion_weight: float,
) -> float:
    adjacency = topology.adjacency()
    total = 0.0
    for left, right in zip(path, path[1:]):
        link = next(link for neighbor, link in adjacency[left] if neighbor == right)
        total += _link_cost(
            topology,
            link,
            strategy=strategy,
            estimated_loads=estimated_loads,
            delay_weight=delay_weight,
            congestion_weight=congestion_weight,
        )
    return total


def path_links(topology: Topology, path: list[str]) -> list[Link]:
    """Return the links traversed by a route, in order."""
    adjacency = topology.adjacency()
    result = []
    for left, right in zip(path, path[1:]):
        result.append(next(link for neighbor, link in adjacency[left] if neighbor == right))
    return result
