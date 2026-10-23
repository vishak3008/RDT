import random

from backend.packets import checksum, reassemble, split_message
from backend.reliability import transmission_dropped


def test_message_is_split_and_reassembled_in_sequence_order():
    packets = split_message("abcdefghij", packet_size=4)

    assert [packet["payload"] for packet in packets] == ["abcd", "efgh", "ij"]
    assert reassemble([packets[2], packets[0], packets[1]]) == "abcdefghij"


def test_duplicate_sequence_number_is_not_added_twice():
    packets = [
        {"sequence": 1, "payload": "world"},
        {"sequence": 0, "payload": "hello "},
        {"sequence": 1, "payload": "world"},
    ]

    assert reassemble(packets) == "hello world"


def test_checksum_detects_changed_payload():
    assert checksum("network") == checksum("network")
    assert checksum("network") != checksum("netw0rk")


def test_loss_probability_boundaries_are_deterministic():
    assert not transmission_dropped(0.0, random.Random(7))
    assert transmission_dropped(1.0, random.Random(7))
