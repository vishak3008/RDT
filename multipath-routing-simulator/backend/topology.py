"""In-memory network topology and link-state management."""

from __future__ import annotations

from dataclasses import dataclass
import math


@dataclass
class Link:
    source: str
    target: str
    cost: float
    delay_ms: float = 1.0
    capacity_mbps: float = 100.0
    available: bool = True

    def to_dict(self) -> dict[str, object]:
        return {
            "source": self.source,
            "target": self.target,
            "cost": self.cost,
            "delay_ms": self.delay_ms,
            "capacity_mbps": self.capacity_mbps,
            "available": self.available,
        }


class Topology:
    """Undirected weighted graph; unavailable links are excluded from routing."""

    def __init__(self, nodes: list[dict[str, str]], links: list[Link]):
        self.nodes: dict[str, dict[str, str]] = {}
        for node in nodes:
            node_id = node.get("id")
            if not isinstance(node_id, str) or not node_id.strip():
                raise ValueError("Every node must have a non-empty string id")
            if node_id in self.nodes:
                raise ValueError(f"Duplicate node id: {node_id}")
            label = node.get("label", node_id)
            node_type = node.get("type", "router")
            if not isinstance(label, str) or not label.strip():
                raise ValueError(f"Node {node_id} must have a non-empty label")
            if node_type not in {"computer", "router"}:
                raise ValueError(f"Node {node_id} type must be 'computer' or 'router'")
            self.nodes[node_id] = {"id": node_id, "label": label, "type": node_type}
        self.links = list(links)
        self._validate()

    @classmethod
    def from_dict(cls, data: object) -> "Topology":
        """Parse and validate a topology JSON object before replacing live state."""
        if not isinstance(data, dict):
            raise ValueError("Topology must be a JSON object")
        nodes_data, links_data = data.get("nodes"), data.get("links")
        if not isinstance(nodes_data, list) or not nodes_data:
            raise ValueError("Topology must contain a non-empty nodes array")
        if not isinstance(links_data, list):
            raise ValueError("Topology must contain a links array")

        nodes: list[dict[str, str]] = []
        for index, node in enumerate(nodes_data):
            if not isinstance(node, dict):
                raise ValueError(f"Node at index {index} must be an object")
            node_id = node.get("id")
            if not isinstance(node_id, str):
                raise ValueError(f"Node at index {index} requires a string id")
            nodes.append({
                "id": node_id,
                "label": node.get("label", node_id),
                "type": node.get("type", "router"),
            })

        links: list[Link] = []
        for index, link in enumerate(links_data):
            if not isinstance(link, dict):
                raise ValueError(f"Link at index {index} must be an object")
            source, target = link.get("source"), link.get("target")
            if not isinstance(source, str) or not isinstance(target, str):
                raise ValueError(f"Link at index {index} requires string source and target ids")
            if "cost" not in link:
                raise ValueError(f"Link at index {index} requires a cost")
            try:
                cost = float(link["cost"])
                delay_ms = float(link.get("delay_ms", 1.0))
                capacity_mbps = float(link.get("capacity_mbps", 100.0))
            except (TypeError, ValueError) as error:
                raise ValueError(f"Link at index {index} has a non-numeric cost, delay, or capacity") from error
            available = link.get("available", True)
            if not isinstance(available, bool):
                raise ValueError(f"Link at index {index} availability must be true or false")
            links.append(Link(source, target, cost, delay_ms, capacity_mbps, available))
        return cls(nodes, links)

    @classmethod
    def demo(cls) -> "Topology":
        nodes = [
            {"id": "S", "label": "Source", "type": "computer"},
            {"id": "R1", "label": "Router 1", "type": "router"},
            {"id": "R2", "label": "Router 2", "type": "router"},
            {"id": "R3", "label": "Router 3", "type": "router"},
            {"id": "R4", "label": "Router 4", "type": "router"},
            {"id": "D", "label": "Destination", "type": "computer"},
        ]
        links = [
            Link("S", "R1", 2, 4), Link("R1", "R3", 2, 4),
            Link("R3", "D", 2, 4), Link("S", "R2", 3, 5),
            Link("R2", "R4", 2, 4), Link("R4", "D", 3, 5),
            Link("R1", "R2", 1.5, 3), Link("R3", "R4", 1.5, 3),
        ]
        return cls(nodes, links)

    def _validate(self) -> None:
        if not self.nodes:
            raise ValueError("Topology must contain at least one node")
        seen_edges: set[frozenset[str]] = set()
        for link in self.links:
            if link.source not in self.nodes or link.target not in self.nodes:
                raise ValueError(f"Link references unknown node: {link.source}–{link.target}")
            if link.source == link.target:
                raise ValueError(f"Self-links are not allowed: {link.source}")
            edge = frozenset((link.source, link.target))
            if edge in seen_edges:
                raise ValueError(f"Duplicate link: {link.source}–{link.target}")
            seen_edges.add(edge)
            values = (link.cost, link.delay_ms, link.capacity_mbps)
            if not all(math.isfinite(value) for value in values):
                raise ValueError("Link cost, delay, and capacity must be finite numbers")
            if link.cost <= 0 or link.delay_ms < 0 or link.capacity_mbps <= 0:
                raise ValueError("Link cost/capacity must be positive and delay cannot be negative")

    def adjacency(self, excluded_edges: set[frozenset[str]] | None = None) -> dict[str, list[tuple[str, Link]]]:
        excluded_edges = excluded_edges or set()
        graph = {node_id: [] for node_id in self.nodes}
        for link in self.links:
            edge = frozenset((link.source, link.target))
            if link.available and edge not in excluded_edges:
                graph[link.source].append((link.target, link))
                graph[link.target].append((link.source, link))
        return graph

    def set_link_state(self, source: str, target: str, available: bool) -> bool:
        for link in self.links:
            if {link.source, link.target} == {source, target}:
                link.available = available
                return True
        return False

    def to_dict(self) -> dict[str, object]:
        return {"nodes": list(self.nodes.values()), "links": [link.to_dict() for link in self.links]}
