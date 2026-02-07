"""
Decay computation utilities
"""
import math
from typing import Optional
from sbp.types import DecayModel, Pheromone

def compute_intensity(pheromone: Pheromone, now: int) -> float:
    """Compute the current intensity of a pheromone after decay"""
    elapsed = now - pheromone.last_reinforced_at

    if elapsed <= 0:
        return pheromone.initial_intensity

    decay = pheromone.decay_model

    if decay.type == "exponential":
        return pheromone.initial_intensity * math.pow(0.5, elapsed / decay.half_life_ms) # type: ignore

    elif decay.type == "linear":
        rate = decay.rate_per_ms # type: ignore
        return max(0.0, pheromone.initial_intensity - rate * elapsed)

    elif decay.type == "step":
        steps = decay.steps # type: ignore
        # Find the applicable step (steps should be sorted by at_ms)
        for step in reversed(steps):
            if elapsed >= step["at_ms"]:
                return step["intensity"]
        return pheromone.initial_intensity

    elif decay.type == "immortal":
        return pheromone.initial_intensity

    return 0.0

def is_evaporated(pheromone: Pheromone, now: int) -> bool:
    """Check if a pheromone has evaporated below its floor"""
    return compute_intensity(pheromone, now) < pheromone.ttl_floor
