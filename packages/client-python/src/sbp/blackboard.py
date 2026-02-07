"""
SBP Local Blackboard Implementation
"""
import time
import asyncio
import uuid
import hashlib
import json
from typing import Dict, List, Optional, Any, Callable, Awaitable, Set

from sbp.types import (
    Pheromone, PheromoneSnapshot,
    ScentCondition, DecayModel,
    EmitParams, EmitResult,
    SniffParams, SniffResult, AggregateStats,
    RegisterScentParams, RegisterScentResult,
    DeregisterScentResult,
    EvaporateParams, EvaporateResult,
    InspectResult, TriggerPayload, TagFilter
)
from sbp.decay import compute_intensity, is_evaporated
from sbp.evaluator import evaluate_condition, EvaluationContext, match_tags

class LocalBlackboard:
    def __init__(self):
        self.pheromones: Dict[str, Pheromone] = {}
        self.scents: Dict[str, Any] = {} # Storing internal scent dicts
        self.handlers: Dict[str, Callable[[TriggerPayload], Awaitable[None]]] = {}
        self.emission_history: List[Dict[str, Any]] = []
        self.start_time = int(time.time() * 1000)

        # Options
        self.emission_history_window = 60000
        self.default_ttl_floor = 0.01

        # Background task
        self._running = False
        self._task = None

    async def start(self):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _loop(self):
        while self._running:
            try:
                await self.evaluate_scents()
            except Exception as e:
                print(f"[SBP Local] Error in loop: {e}")
            await asyncio.sleep(0.1)

    def _now(self) -> int:
        return int(time.time() * 1000)

    def _hash_payload(self, payload: Dict[str, Any]) -> str:
        content = json.dumps(payload, sort_keys=True)
        return hashlib.sha256(content.encode()).hexdigest()[:16]

    def emit(self, params: EmitParams) -> EmitResult:
        now = self._now()

        # Record history
        self.emission_history.append({
            "trail": params.trail,
            "type": params.type,
            "timestamp": now
        })
        self._prune_history(now)

        payload_hash = self._hash_payload(params.payload)

        # Find existing
        existing = None
        if params.merge_strategy != "new":
            for p in self.pheromones.values():
                if (p.trail == params.trail and
                    p.type == params.type and
                    self._hash_payload(p.payload) == payload_hash and
                    not is_evaporated(p, now)):
                    existing = p
                    break

        clamped_intensity = max(0.0, min(1.0, params.intensity))

        if existing:
            prev_intensity = compute_intensity(existing, now)
            action = "reinforced"

            if params.merge_strategy == "reinforce":
                existing.initial_intensity = clamped_intensity
                existing.last_reinforced_at = now
            elif params.merge_strategy == "replace":
                existing.initial_intensity = clamped_intensity
                existing.last_reinforced_at = now
                existing.payload = params.payload
                existing.tags = params.tags
                action = "replaced"
            elif params.merge_strategy == "max":
                existing.initial_intensity = max(prev_intensity, clamped_intensity)
                existing.last_reinforced_at = now
                action = "merged"
            elif params.merge_strategy == "add":
                existing.initial_intensity = min(1.0, prev_intensity + clamped_intensity)
                existing.last_reinforced_at = now
                action = "merged"

            return EmitResult(
                pheromone_id=existing.id,
                action=action, # type: ignore
                previous_intensity=prev_intensity,
                new_intensity=compute_intensity(existing, now)
            )

        # Create new
        pid = str(uuid.uuid4())
        pheromone = Pheromone(
            id=pid,
            trail=params.trail,
            type=params.type,
            emitted_at=now,
            last_reinforced_at=now,
            initial_intensity=clamped_intensity,
            decay_model=params.decay or {"type": "exponential", "half_life_ms": 300000}, # type: ignore
            payload=params.payload,
            source_agent=params.source_agent,
            tags=params.tags,
            ttl_floor=self.default_ttl_floor
        )
        self.pheromones[pid] = pheromone

        return EmitResult(
            pheromone_id=pid,
            action="created",
            new_intensity=clamped_intensity
        )

    def sniff(self, params: SniffParams) -> SniffResult:
        now = self._now()
        results = []
        aggs: Dict[str, AggregateStats] = {}

        # Temp agg storage: key -> [sum, count, max]
        temp_aggs: Dict[str, List[float]] = {}

        for p in self.pheromones.values():
            if params.trails and p.trail not in params.trails: continue
            if params.types and p.type not in params.types: continue

            intensity = compute_intensity(p, now)

            if not params.include_evaporated and intensity < p.ttl_floor: continue
            if intensity < params.min_intensity: continue
            if params.max_age_ms and (now - p.emitted_at > params.max_age_ms): continue
            if params.tags and not match_tags(p.tags, params.tags): continue

            # Add to results
            snapshot = PheromoneSnapshot(
                id=p.id,
                trail=p.trail,
                type=p.type,
                current_intensity=intensity,
                payload=p.payload,
                age_ms=now - p.emitted_at,
                tags=p.tags
            )
            results.append(snapshot)

            # Aggregate
            key = f"{p.trail}/{p.type}"
            if key not in temp_aggs:
                temp_aggs[key] = [0.0, 0.0, 0.0] # sum, count, max

            temp_aggs[key][0] += intensity
            temp_aggs[key][1] += 1
            temp_aggs[key][2] = max(temp_aggs[key][2], intensity)

        # Sort
        results.sort(key=lambda x: x.current_intensity, reverse=True)

        # Finalize aggs
        for k, v in temp_aggs.items():
            aggs[k] = AggregateStats(
                count=int(v[1]),
                sum_intensity=v[0],
                max_intensity=v[2],
                avg_intensity=v[0]/v[1] if v[1] > 0 else 0
            )

        return SniffResult(
            timestamp=now,
            pheromones=results[:params.limit],
            aggregates=aggs
        )

    def register_scent(self, params: RegisterScentParams) -> RegisterScentResult:
        now = self._now()
        is_update = params.scent_id in self.scents

        scent = {
            "id": params.scent_id,
            "condition": params.condition,
            "cooldown_ms": params.cooldown_ms,
            "activation_payload": params.activation_payload,
            "context_trails": params.context_trails,
            "trigger_mode": params.trigger_mode,
            "last_triggered_at": 0,
            "last_condition_met": False
        }
        self.scents[params.scent_id] = scent

        # Evaluate immediately to return state
        ctx = EvaluationContext(list(self.pheromones.values()), now, self.emission_history)
        result = evaluate_condition(params.condition, ctx)

        return RegisterScentResult(
            scent_id=params.scent_id,
            status="updated" if is_update else "registered",
            current_condition_state={"met": result.met}
        )

    def deregister_scent(self, scent_id: str) -> DeregisterScentResult:
        if scent_id in self.scents:
            del self.scents[scent_id]
            if scent_id in self.handlers:
                del self.handlers[scent_id]
            return DeregisterScentResult(scent_id=scent_id, status="deregistered")
        return DeregisterScentResult(scent_id=scent_id, status="not_found")

    def subscribe(self, scent_id: str, handler: Callable[[TriggerPayload], Awaitable[None]]):
        self.handlers[scent_id] = handler

    def unsubscribe(self, scent_id: str):
        if scent_id in self.handlers:
            del self.handlers[scent_id]

    async def evaluate_scents(self):
        now = self._now()
        pheromones = list(self.pheromones.values())
        ctx = EvaluationContext(pheromones, now, self.emission_history)

        for scent in self.scents.values():
            # Cooldown check
            if now - scent["last_triggered_at"] < scent["cooldown_ms"]:
                continue

            result = evaluate_condition(scent["condition"], ctx)
            met = result.met
            last_met = scent["last_condition_met"]

            should_trigger = False
            mode = scent["trigger_mode"]

            if mode == "level":
                should_trigger = met
            elif mode == "edge_rising":
                should_trigger = met and not last_met
            elif mode == "edge_falling":
                should_trigger = not met and last_met

            scent["last_condition_met"] = met

            if should_trigger:
                scent["last_triggered_at"] = now
                await self._dispatch_trigger(scent, result, now)

    async def _dispatch_trigger(self, scent: Dict[str, Any], result, now: int):
        # Build context
        context = []
        matching_ids = set(result.matching_pheromone_ids)

        # Include context trails if specified
        if scent.get("context_trails"):
            for p in self.pheromones.values():
                if p.trail in scent["context_trails"] and not is_evaporated(p, now):
                    context.append(self._create_snapshot(p, now))
        else:
            # Otherwise include matching
            for pid in matching_ids:
                if pid in self.pheromones:
                    context.append(self._create_snapshot(self.pheromones[pid], now))

        payload = TriggerPayload(
            scent_id=scent["id"],
            triggered_at=now,
            condition_snapshot={
                scent["id"]: {
                    "value": result.value,
                    "pheromone_ids": list(matching_ids)
                }
            },
            context_pheromones=context,
            activation_payload=scent["activation_payload"]
        )

        handler = self.handlers.get(scent["id"])
        if handler:
            try:
                await handler(payload)
            except Exception as e:
                print(f"[SBP Local] Handler error: {e}")

    def _create_snapshot(self, p: Pheromone, now: int) -> PheromoneSnapshot:
        return PheromoneSnapshot(
            id=p.id,
            trail=p.trail,
            type=p.type,
            current_intensity=compute_intensity(p, now),
            payload=p.payload,
            age_ms=now - p.emitted_at,
            tags=p.tags
        )

    def _prune_history(self, now: int):
        cutoff = now - self.emission_history_window
        self.emission_history = [e for e in self.emission_history if e["timestamp"] >= cutoff]


# Singleton instance for shared local mode
_shared_blackboard: Optional[LocalBlackboard] = None

def get_shared_blackboard() -> LocalBlackboard:
    global _shared_blackboard
    if _shared_blackboard is None:
        _shared_blackboard = LocalBlackboard()
    return _shared_blackboard
