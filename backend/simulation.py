"""Packet transmission simulation with route changes and bounded retries."""

from __future__ import annotations

import random

from .metrics import calculate_metrics
from .packets import checksum, reassemble, split_message
from .reliability import transmission_dropped
from .routing import k_shortest_paths
from .topology import Link, Topology


def _copy_topology(topology: Topology) -> Topology:
    nodes = list(topology.nodes.values())
    links = [Link(**link.to_dict()) for link in topology.links]
    return Topology(nodes, links)


def simulate(
    topology: Topology,
    *,
    source: str,
    destination: str,
    message: str,
    mode: str = "multipath",
    k: int = 2,
    packet_size: int = 8,
    loss_probability: float = 0.0,
    max_retries: int = 3,
    seed: int = 1,
    failure: dict[str, object] | None = None,
) -> dict[str, object]:
    """Run one reproducible in-memory experiment; failure changes only its copy."""
    if mode not in {"single", "multipath", "congestion_aware"}:
        raise ValueError("mode must be 'single', 'multipath', or 'congestion_aware'")
    if not 0 <= loss_probability <= 1:
        raise ValueError("loss_probability must be between 0 and 1")
    if max_retries < 0:
        raise ValueError("max_retries cannot be negative")
    if k < 1:
        raise ValueError("k must be at least 1")
    if not isinstance(message, str):
        raise ValueError("message must be a string")
    if failure is not None and not isinstance(failure, dict):
        raise ValueError("failure must be an object with source, target, and after_transmissions")

    network = _copy_topology(topology)
    packets = split_message(message, packet_size)
    events: list[dict[str, object]] = []
    outcomes: list[dict[str, object]] = []
    elapsed_ms = 0.0
    transmission_count = 0
    failure_applied = False
    recovery_time_ms: float | None = None
    failure_time_ms: float | None = None
    original_checksum = checksum(message)
    estimated_loads: dict[frozenset[str], int] = {}

    def find_routes(route_count: int) -> list[dict[str, object]]:
        congestion_mode = mode == "congestion_aware"
        return k_shortest_paths(
            network,
            source,
            destination,
            route_count,
            strategy="congestion" if congestion_mode else "cost",
            estimated_loads=estimated_loads if congestion_mode else None,
        )

    current_routes = find_routes(k)
    initial_routes = current_routes
    if not current_routes:
        raise ValueError(f"No available route from {source} to {destination}")

    failure_after = None
    if failure:
        failure_after = int(failure.get("after_transmissions", len(packets)))
        if failure_after < 0:
            raise ValueError("failure.after_transmissions cannot be negative")

    def record(event_type: str, **details: object) -> None:
        events.append({"time_ms": round(elapsed_ms, 2), "type": event_type, **details})

    def maybe_apply_failure() -> None:
        nonlocal failure_applied, failure_time_ms, current_routes
        if failure_applied or failure is None or transmission_count < failure_after:
            return
        left, right = failure.get("source"), failure.get("target")
        if not isinstance(left, str) or not isinstance(right, str):
            raise ValueError("failure requires source and target link endpoints")
        if not network.set_link_state(left, right, False):
            raise ValueError(f"Failure link not found: {left}–{right}")
        failure_applied = True
        failure_time_ms = elapsed_ms
        record("link_failure", source=left, target=right)
        refreshed = find_routes(k)
        current_routes = refreshed
        record("routes_recalculated", paths=refreshed)

    for packet in packets:
        sequence = int(packet["sequence"])
        delivered = False
        packet_delay = 0.0
        assigned_route: list[str] | None = None
        for attempt in range(max_retries + 1):
            maybe_apply_failure()
            if mode == "single":
                chosen = k_shortest_paths(network, source, destination, 1)
                if not chosen:
                    current_routes = []
                    record("unreachable", sequence=sequence)
                    break
                route = chosen[0]
            elif mode == "congestion_aware":
                ranked = find_routes(k)
                if not ranked:
                    current_routes = []
                    record("unreachable", sequence=sequence)
                    break
                current_routes = ranked
                route = ranked[0]
                record(
                    "congestion_route_selected",
                    sequence=sequence,
                    route=route["nodes"],
                    objective_cost=round(float(route["cost"]), 3),
                    estimated_loads={" — ".join(sorted(edge)): count for edge, count in estimated_loads.items()},
                )
            else:
                if not current_routes:
                    current_routes = k_shortest_paths(network, source, destination, k)
                if not current_routes:
                    record("unreachable", sequence=sequence)
                    break
                route = current_routes[sequence % len(current_routes)]

            assigned_route = list(route["nodes"])
            transmission_count += 1
            route_links = [
                next(link for neighbor, link in network.adjacency()[left] if neighbor == right)
                for left, right in zip(assigned_route, assigned_route[1:])
            ]
            delay = sum(link.delay_ms for link in route_links)
            for link in route_links:
                edge = frozenset((link.source, link.target))
                estimated_loads[edge] = estimated_loads.get(edge, 0) + 1
            elapsed_ms += delay
            packet_delay += delay
            record("transmission", sequence=sequence, attempt=attempt + 1, route=assigned_route)
            # Key the loss draw to packet/retry identity so comparison modes share
            # the same loss pattern even when their route assignment differs.
            rng = random.Random((seed * 1_000_003) + (sequence * 10_007) + attempt)
            if transmission_dropped(loss_probability, rng):
                record("packet_dropped", sequence=sequence, attempt=attempt + 1)
                if attempt < max_retries:
                    record("retransmission", sequence=sequence, next_attempt=attempt + 2)
                continue
            delivered = True
            record("acknowledgement", sequence=sequence, route=assigned_route)
            if failure_time_ms is not None and recovery_time_ms is None:
                recovery_time_ms = elapsed_ms - failure_time_ms
                record("recovery", recovery_time_ms=round(recovery_time_ms, 2))
            break

        outcomes.append({
            "sequence": sequence,
            "payload": packet["payload"],
            "status": "delivered" if delivered else "lost",
            "route": assigned_route,
            "delay_ms": round(packet_delay, 2),
        })

    delivered_packets = [packet for packet in outcomes if packet["status"] == "delivered"]
    final_routes = find_routes(1 if mode == "single" else k)
    retransmissions = sum(1 for event in events if event["type"] == "retransmission")
    reconstructed = reassemble(delivered_packets) if len(delivered_packets) == len(packets) else None
    integrity_ok = reconstructed is not None and checksum(reconstructed) == original_checksum
    metrics = calculate_metrics(
        len(packets),
        len(delivered_packets),
        [float(packet["delay_ms"]) for packet in delivered_packets],
        retransmissions,
        elapsed_ms,
        sum(len(str(packet["payload"]).encode("utf-8")) for packet in delivered_packets),
        recovery_time_ms,
    )
    return {
        "mode": mode,
        "routing_objective": "link cost + weighted delay + estimated load/capacity penalty" if mode == "congestion_aware" else "link cost",
        "paths": initial_routes,
        "final_routes": final_routes,
        "packets": outcomes,
        "events": events,
        "metrics": metrics,
        "reconstructed_message": reconstructed,
        "integrity": {"expected_sha256": original_checksum, "received_sha256": checksum(reconstructed) if reconstructed is not None else None, "ok": integrity_ok},
        "final_topology": network.to_dict(),
    }
