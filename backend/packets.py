"""Packet creation and destination-side message reassembly."""

from __future__ import annotations

from hashlib import sha256


def split_message(message: str, packet_size: int) -> list[dict[str, object]]:
    if packet_size < 1:
        raise ValueError("packet_size must be at least 1")
    if not isinstance(message, str):
        raise ValueError("message must be a string")
    # Keep one packet for an empty message so its integrity can still be checked.
    chunks = [message[i : i + packet_size] for i in range(0, len(message), packet_size)] or [""]
    return [{"sequence": index, "payload": chunk} for index, chunk in enumerate(chunks)]


def checksum(message: str) -> str:
    return sha256(message.encode("utf-8")).hexdigest()


def reassemble(packets: list[dict[str, object]]) -> str:
    # The receiver tracks sequence numbers: a duplicated packet is acknowledged
    # but contributes only once to the reconstructed message.
    unique: dict[int, dict[str, object]] = {}
    for packet in packets:
        sequence = int(packet["sequence"])
        unique.setdefault(sequence, packet)
    return "".join(str(unique[sequence]["payload"]) for sequence in sorted(unique))
