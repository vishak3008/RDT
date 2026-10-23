"""Calculate transmission metrics from unique packet outcomes."""

from __future__ import annotations


def calculate_metrics(
    total_packets: int,
    delivered_packets: int,
    packet_delays_ms: list[float],
    retransmissions: int,
    elapsed_ms: float,
    delivered_payload_bytes: int,
    recovery_time_ms: float | None,
) -> dict[str, float | int | None]:
    delivery_ratio = (delivered_packets / total_packets * 100) if total_packets else 100.0
    delivered_bits = delivered_payload_bytes * 8
    elapsed_seconds = elapsed_ms / 1000
    return {
        "total_packets": total_packets,
        "delivered_packets": delivered_packets,
        "delivery_ratio_percent": round(delivery_ratio, 2),
        "packet_loss_ratio_percent": round(100 - delivery_ratio, 2),
        "average_latency_ms": round(sum(packet_delays_ms) / len(packet_delays_ms), 2) if packet_delays_ms else None,
        "throughput_bps": round(delivered_bits / elapsed_seconds, 2) if elapsed_seconds > 0 else 0.0,
        "retransmissions": retransmissions,
        "elapsed_time_ms": round(elapsed_ms, 2),
        "recovery_time_ms": round(recovery_time_ms, 2) if recovery_time_ms is not None else None,
    }
