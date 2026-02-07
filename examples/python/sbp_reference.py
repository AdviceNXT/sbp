"""
Stigmergic Blackboard Protocol (SBP) v0.1
Python Reference Implementation

This is a minimal in-memory reference implementation for demonstration purposes.
Production implementations should add proper persistence, networking, and scaling.
"""

from __future__ import annotations

import asyncio
import math
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Optional
from collections import defaultdict
import hashlib
import json


# ============================================================================
# DECAY MODELS
# ============================================================================

class DecayType(Enum):
    EXPONENTIAL = "exponential"
    LINEAR = "linear"
    STEP = "step"
    IMMORTAL = "immortal"


@dataclass
class DecayModel:
    type: DecayType
    half_life_ms: Optional[int] = None  # For exponential
    rate_per_ms: Optional[float] = None  # For linear
    steps: Optional[list[dict]] = None  # For step decay

    @classmethod
    def exponential(cls, half_life_ms: int) -> DecayModel:
        return cls(type=DecayType.EXPONENTIAL, half_life_ms=half_life_ms)

    @classmethod
    def linear(cls, rate_per_ms: float) -> DecayModel:
        return cls(type=DecayType.LINEAR, rate_per_ms=rate_per_ms)

    @classmethod
    def immortal(cls) -> DecayModel:
        return cls(type=DecayType.IMMORTAL)


# ============================================================================
# PHEROMONE
# ============================================================================

@dataclass
class Pheromone:
    id: str
    trail: str
    type: str
    emitted_at: int
    last_reinforced_at: int
    initial_intensity: float
    decay_model: DecayModel
    payload: dict = field(default_factory=dict)
    source_agent: Optional[str] = None
    tags: list[str] = field(default_factory=list)
    ttl_floor: float = 0.01

    def current_intensity(self, now: Optional[int] = None) -> float:
        """Compute current intensity after decay."""
        if now is None:
            now = int(time.time() * 1000)

        elapsed = now - self.last_reinforced_at

        if self.decay_model.type == DecayType.EXPONENTIAL:
            half_life = self.decay_model.half_life_ms
            return self.initial_intensity * math.pow(0.5, elapsed / half_life)

        elif self.decay_model.type == DecayType.LINEAR:
            rate = self.decay_model.rate_per_ms
            return max(0, self.initial_intensity - (rate * elapsed))

        elif self.decay_model.type == DecayType.STEP:
            steps = self.decay_model.steps or []
            for step in reversed(steps):
                if elapsed >= step["at_ms"]:
                    return step["intensity"]
            return self.initial_intensity

        elif self.decay_model.type == DecayType.IMMORTAL:
            return self.initial_intensity

        return 0

    def is_evaporated(self, now: Optional[int] = None) -> bool:
        """Check if pheromone has evaporated below threshold."""
        return self.current_intensity(now) < self.ttl_floor

    def payload_hash(self) -> str:
        """Generate hash of payload for matching."""
        content = json.dumps(self.payload, sort_keys=True)
        return hashlib.sha256(content.encode()).hexdigest()[:16]


# ============================================================================
# SCENT CONDITIONS
# ============================================================================

@dataclass
class ThresholdCondition:
    type: str = "threshold"
    trail: str = ""
    signal_type: str = ""
    aggregation: str = "max"  # sum, max, avg, count, any
    operator: str = ">="
    value: float = 0

    def evaluate(self, pheromones: list[Pheromone], now: int) -> bool:
        """Evaluate condition against pheromones."""
        matching = [
            p for p in pheromones
            if p.trail == self.trail
            and (self.signal_type == "*" or p.type == self.signal_type)
            and not p.is_evaporated(now)
        ]

        if not matching:
            agg_value = 0
        elif self.aggregation == "sum":
            agg_value = sum(p.current_intensity(now) for p in matching)
        elif self.aggregation == "max":
            agg_value = max(p.current_intensity(now) for p in matching)
        elif self.aggregation == "avg":
            agg_value = sum(p.current_intensity(now) for p in matching) / len(matching)
        elif self.aggregation == "count":
            agg_value = len(matching)
        elif self.aggregation == "any":
            agg_value = 1 if matching else 0
        else:
            agg_value = 0

        return self._compare(agg_value, self.operator, self.value)

    @staticmethod
    def _compare(a: float, op: str, b: float) -> bool:
        if op == ">=":
            return a >= b
        elif op == ">":
            return a > b
        elif op == "<=":
            return a <= b
        elif op == "<":
            return a < b
        elif op == "==":
            return a == b
        elif op == "!=":
            return a != b
        return False


@dataclass
class CompositeCondition:
    type: str = "composite"
    operator: str = "and"  # and, or, not
    conditions: list = field(default_factory=list)

    def evaluate(self, pheromones: list[Pheromone], now: int) -> bool:
        if not self.conditions:
            return False

        results = [c.evaluate(pheromones, now) for c in self.conditions]

        if self.operator == "and":
            return all(results)
        elif self.operator == "or":
            return any(results)
        elif self.operator == "not":
            return not results[0]
        return False


# ============================================================================
# SCENT REGISTRATION
# ============================================================================

@dataclass
class Scent:
    scent_id: str
    agent_endpoint: str
    condition: ThresholdCondition | CompositeCondition
    cooldown_ms: int = 0
    activation_payload: dict = field(default_factory=dict)
    last_triggered_at: Optional[int] = None

    def is_in_cooldown(self, now: int) -> bool:
        if self.last_triggered_at is None:
            return False
        return (now - self.last_triggered_at) < self.cooldown_ms

    def evaluate(self, pheromones: list[Pheromone], now: int) -> bool:
        if self.is_in_cooldown(now):
            return False
        return self.condition.evaluate(pheromones, now)


# ============================================================================
# BLACKBOARD
# ============================================================================

class Blackboard:
    """In-memory SBP Blackboard implementation."""

    def __init__(self):
        self.pheromones: dict[str, Pheromone] = {}
        self.scents: dict[str, Scent] = {}
        self.trail_defaults: dict[str, DecayModel] = {}
        self.trigger_handlers: dict[str, Callable] = {}
        self._evaluation_task: Optional[asyncio.Task] = None

    # ------------------------------------------------------------------------
    # EMIT
    # ------------------------------------------------------------------------

    def emit(
        self,
        trail: str,
        type: str,
        intensity: float,
        decay: Optional[DecayModel] = None,
        payload: Optional[dict] = None,
        tags: Optional[list[str]] = None,
        merge_strategy: str = "reinforce",
        source_agent: Optional[str] = None,
    ) -> dict:
        """Deposit or reinforce a pheromone."""
        now = int(time.time() * 1000)
        payload = payload or {}
        tags = tags or []
        decay = decay or self.trail_defaults.get(trail, DecayModel.exponential(300000))

        # Generate match key for merging
        match_key = f"{trail}:{type}:{hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]}"

        existing = None
        if merge_strategy != "new":
            for p in self.pheromones.values():
                p_key = f"{p.trail}:{p.type}:{p.payload_hash()}"
                if p_key == match_key and not p.is_evaporated(now):
                    existing = p
                    break

        if existing and merge_strategy in ("reinforce", "replace", "max", "add"):
            previous_intensity = existing.current_intensity(now)

            if merge_strategy == "reinforce":
                existing.initial_intensity = intensity
                existing.last_reinforced_at = now
                action = "reinforced"
            elif merge_strategy == "replace":
                existing.initial_intensity = intensity
                existing.last_reinforced_at = now
                existing.payload = payload
                existing.tags = tags
                action = "replaced"
            elif merge_strategy == "max":
                existing.initial_intensity = max(existing.initial_intensity, intensity)
                existing.last_reinforced_at = now
                action = "merged"
            elif merge_strategy == "add":
                existing.initial_intensity = min(1.0, existing.initial_intensity + intensity)
                existing.last_reinforced_at = now
                action = "merged"

            return {
                "pheromone_id": existing.id,
                "action": action,
                "previous_intensity": previous_intensity,
                "new_intensity": existing.current_intensity(now),
            }

        # Create new pheromone
        pheromone_id = str(uuid.uuid4())
        pheromone = Pheromone(
            id=pheromone_id,
            trail=trail,
            type=type,
            emitted_at=now,
            last_reinforced_at=now,
            initial_intensity=intensity,
            decay_model=decay,
            payload=payload,
            source_agent=source_agent,
            tags=tags,
        )
        self.pheromones[pheromone_id] = pheromone

        return {
            "pheromone_id": pheromone_id,
            "action": "created",
            "new_intensity": intensity,
        }

    # ------------------------------------------------------------------------
    # SNIFF
    # ------------------------------------------------------------------------

    def sniff(
        self,
        trails: Optional[list[str]] = None,
        types: Optional[list[str]] = None,
        min_intensity: float = 0,
        limit: int = 100,
        include_evaporated: bool = False,
    ) -> dict:
        """Sense current environmental state."""
        now = int(time.time() * 1000)
        results = []
        aggregates = defaultdict(lambda: {"count": 0, "sum": 0, "max": 0})

        for p in self.pheromones.values():
            # Filter by trail
            if trails and p.trail not in trails:
                continue
            # Filter by type
            if types and p.type not in types:
                continue

            intensity = p.current_intensity(now)

            # Filter evaporated
            if not include_evaporated and intensity < p.ttl_floor:
                continue
            # Filter by min intensity
            if intensity < min_intensity:
                continue

            results.append({
                "id": p.id,
                "trail": p.trail,
                "type": p.type,
                "current_intensity": round(intensity, 4),
                "payload": p.payload,
                "age_ms": now - p.emitted_at,
            })

            # Aggregate
            key = f"{p.trail}/{p.type}"
            aggregates[key]["count"] += 1
            aggregates[key]["sum"] += intensity
            aggregates[key]["max"] = max(aggregates[key]["max"], intensity)

        # Sort by intensity descending, limit
        results.sort(key=lambda x: x["current_intensity"], reverse=True)
        results = results[:limit]

        # Compute averages
        for key in aggregates:
            if aggregates[key]["count"] > 0:
                aggregates[key]["avg"] = aggregates[key]["sum"] / aggregates[key]["count"]
            else:
                aggregates[key]["avg"] = 0
            aggregates[key]["sum_intensity"] = aggregates[key].pop("sum")
            aggregates[key]["max_intensity"] = aggregates[key].pop("max")
            aggregates[key]["avg_intensity"] = aggregates[key].pop("avg")

        return {
            "timestamp": now,
            "pheromones": results,
            "aggregates": dict(aggregates),
        }

    # ------------------------------------------------------------------------
    # REGISTER_SCENT
    # ------------------------------------------------------------------------

    def register_scent(
        self,
        scent_id: str,
        agent_endpoint: str,
        condition: ThresholdCondition | CompositeCondition,
        cooldown_ms: int = 0,
        activation_payload: Optional[dict] = None,
    ) -> dict:
        """Register a trigger condition."""
        scent = Scent(
            scent_id=scent_id,
            agent_endpoint=agent_endpoint,
            condition=condition,
            cooldown_ms=cooldown_ms,
            activation_payload=activation_payload or {},
        )

        status = "updated" if scent_id in self.scents else "registered"
        self.scents[scent_id] = scent

        # Check current state
        now = int(time.time() * 1000)
        pheromones = list(self.pheromones.values())
        met = condition.evaluate(pheromones, now)

        return {
            "scent_id": scent_id,
            "status": status,
            "current_condition_state": {"met": met},
        }

    # ------------------------------------------------------------------------
    # DEREGISTER_SCENT
    # ------------------------------------------------------------------------

    def deregister_scent(self, scent_id: str) -> dict:
        """Remove a scent registration."""
        if scent_id in self.scents:
            del self.scents[scent_id]
            return {"scent_id": scent_id, "status": "deregistered"}
        return {"scent_id": scent_id, "status": "not_found"}

    # ------------------------------------------------------------------------
    # EVAPORATE
    # ------------------------------------------------------------------------

    def evaporate(
        self,
        trail: Optional[str] = None,
        types: Optional[list[str]] = None,
        older_than_ms: Optional[int] = None,
        below_intensity: Optional[float] = None,
    ) -> dict:
        """Force evaporation of matching pheromones."""
        now = int(time.time() * 1000)
        to_remove = []
        trails_affected = set()

        for pid, p in self.pheromones.items():
            if trail and p.trail != trail:
                continue
            if types and p.type not in types:
                continue
            if older_than_ms and (now - p.emitted_at) < older_than_ms:
                continue
            if below_intensity and p.current_intensity(now) >= below_intensity:
                continue

            to_remove.append(pid)
            trails_affected.add(p.trail)

        for pid in to_remove:
            del self.pheromones[pid]

        return {
            "evaporated_count": len(to_remove),
            "trails_affected": list(trails_affected),
        }

    # ------------------------------------------------------------------------
    # EVALUATION LOOP
    # ------------------------------------------------------------------------

    async def start_evaluation_loop(self, interval_ms: int = 100):
        """Start the scent evaluation loop."""
        self._evaluation_task = asyncio.create_task(self._evaluate_loop(interval_ms))

    async def stop_evaluation_loop(self):
        """Stop the evaluation loop."""
        if self._evaluation_task:
            self._evaluation_task.cancel()
            try:
                await self._evaluation_task
            except asyncio.CancelledError:
                pass

    async def _evaluate_loop(self, interval_ms: int):
        """Continuously evaluate scent conditions."""
        while True:
            await asyncio.sleep(interval_ms / 1000)
            await self._evaluate_scents()

    async def _evaluate_scents(self):
        """Evaluate all registered scents and trigger if conditions met."""
        now = int(time.time() * 1000)
        pheromones = list(self.pheromones.values())

        for scent in self.scents.values():
            if scent.evaluate(pheromones, now):
                scent.last_triggered_at = now
                await self._trigger_agent(scent, pheromones, now)

    async def _trigger_agent(self, scent: Scent, pheromones: list[Pheromone], now: int):
        """Send trigger to agent endpoint."""
        trigger_payload = {
            "scent_id": scent.scent_id,
            "triggered_at": now,
            "condition_snapshot": {},
            "activation_payload": scent.activation_payload,
        }

        # If a handler is registered locally, call it
        if scent.scent_id in self.trigger_handlers:
            handler = self.trigger_handlers[scent.scent_id]
            try:
                await handler(trigger_payload)
            except Exception as e:
                print(f"Trigger handler error for {scent.scent_id}: {e}")
        else:
            # In production, this would HTTP POST to scent.agent_endpoint
            print(f"[TRIGGER] {scent.scent_id} → {scent.agent_endpoint}")

    def on_trigger(self, scent_id: str):
        """Decorator to register a local trigger handler."""
        def decorator(func):
            self.trigger_handlers[scent_id] = func
            return func
        return decorator

    # ------------------------------------------------------------------------
    # GARBAGE COLLECTION
    # ------------------------------------------------------------------------

    def gc(self):
        """Remove all evaporated pheromones."""
        now = int(time.time() * 1000)
        to_remove = [pid for pid, p in self.pheromones.items() if p.is_evaporated(now)]
        for pid in to_remove:
            del self.pheromones[pid]
        return len(to_remove)


# ============================================================================
# EXAMPLE USAGE
# ============================================================================

async def example():
    """Demonstrate basic SBP usage."""
    bb = Blackboard()

    # Register a scent
    condition = CompositeCondition(
        operator="and",
        conditions=[
            ThresholdCondition(
                trail="market.signals",
                signal_type="volatility",
                aggregation="max",
                operator=">=",
                value=0.7,
            ),
            ThresholdCondition(
                trail="market.orders",
                signal_type="large_order",
                aggregation="count",
                operator=">=",
                value=2,
            ),
        ],
    )

    bb.register_scent(
        scent_id="crisis-detector",
        agent_endpoint="http://agents.example.com/crisis",
        condition=condition,
        cooldown_ms=60000,
    )

    # Register local handler
    @bb.on_trigger("crisis-detector")
    async def handle_crisis(payload):
        print(f"🚨 Crisis detected! Triggered at {payload['triggered_at']}")

    # Start evaluation
    await bb.start_evaluation_loop(interval_ms=100)

    # Emit pheromones
    print("Emitting volatility signal...")
    bb.emit("market.signals", "volatility", 0.8, payload={"symbol": "BTC"})

    print("Emitting order signals...")
    bb.emit("market.orders", "large_order", 0.6, payload={"size": 1000000})
    bb.emit("market.orders", "large_order", 0.7, payload={"size": 2000000})

    # Wait for trigger
    await asyncio.sleep(0.5)

    # Sniff the environment
    result = bb.sniff(trails=["market.signals", "market.orders"])
    print(f"\nEnvironment state:")
    for p in result["pheromones"]:
        print(f"  {p['trail']}/{p['type']}: {p['current_intensity']:.3f}")

    await bb.stop_evaluation_loop()


if __name__ == "__main__":
    asyncio.run(example())
