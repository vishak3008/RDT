"""Acknowledgement and retry policy for simulated packet delivery."""

from __future__ import annotations

import random


def transmission_dropped(loss_probability: float, rng: random.Random) -> bool:
    """Return whether this transmission is lost on the simulated link."""
    return rng.random() < loss_probability
