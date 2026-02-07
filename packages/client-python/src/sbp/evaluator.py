"""
Scent condition evaluation
"""
from typing import List, Dict, Any, Optional
from sbp.types import (
    Pheromone,
    ScentCondition,
    ThresholdCondition,
    CompositeCondition,
    RateCondition,
    TagFilter
)
from sbp.decay import compute_intensity, is_evaporated

class EvaluationContext:
    def __init__(
        self,
        pheromones: List[Pheromone],
        now: int,
        emission_history: Optional[List[Dict[str, Any]]] = None
    ):
        self.pheromones = pheromones
        self.now = now
        self.emission_history = emission_history or []

class EvaluationResult:
    def __init__(self, met: bool, value: float, matching_pheromone_ids: List[str]):
        self.met = met
        self.value = value
        self.matching_pheromone_ids = matching_pheromone_ids

def evaluate_condition(condition: ScentCondition, ctx: EvaluationContext) -> EvaluationResult:
    """Evaluate a scent condition against the current environment"""
    if condition.type == "threshold":
        return evaluate_threshold(condition, ctx) # type: ignore
    elif condition.type == "composite":
        return evaluate_composite(condition, ctx) # type: ignore
    elif condition.type == "rate":
        return evaluate_rate(condition, ctx) # type: ignore

    return EvaluationResult(False, 0.0, [])

def match_tags(tags: List[str], tag_filter: Optional[TagFilter]) -> bool:
    if not tag_filter:
        return True

    if tag_filter.any:
        if not any(t in tags for t in tag_filter.any):
            return False

    if tag_filter.all:
        if not all(t in tags for t in tag_filter.all):
            return False

    if tag_filter.none:
        if any(t in tags for t in tag_filter.none):
            return False

    return True

def compare(a: float, op: str, b: float) -> bool:
    if op == ">=": return a >= b
    if op == ">": return a > b
    if op == "<=": return a <= b
    if op == "<": return a < b
    if op == "==": return a == b
    if op == "!=": return a != b
    return False

def evaluate_threshold(condition: ThresholdCondition, ctx: EvaluationContext) -> EvaluationResult:
    matching = []
    for p in ctx.pheromones:
        if p.trail != condition.trail:
            continue
        if condition.signal_type != "*" and p.type != condition.signal_type:
            continue
        if is_evaporated(p, ctx.now):
            continue
        if condition.tags and not match_tags(p.tags, condition.tags):
            continue
        matching.append(p)

    intensities = [compute_intensity(p, ctx.now) for p in matching]
    agg_value = 0.0

    if condition.aggregation == "sum":
        agg_value = sum(intensities)
    elif condition.aggregation == "max":
        agg_value = max(intensities) if intensities else 0.0
    elif condition.aggregation == "avg":
        agg_value = (sum(intensities) / len(intensities)) if intensities else 0.0
    elif condition.aggregation == "count":
        agg_value = float(len(matching))
    elif condition.aggregation == "any":
        agg_value = 1.0 if matching else 0.0

    met = compare(agg_value, condition.operator, condition.value)

    return EvaluationResult(
        met=met,
        value=agg_value,
        matching_pheromone_ids=[p.id for p in matching]
    )

def evaluate_composite(condition: CompositeCondition, ctx: EvaluationContext) -> EvaluationResult:
    if not condition.conditions:
        return EvaluationResult(False, 0.0, [])

    results = [evaluate_condition(c, ctx) for c in condition.conditions]
    all_ids = set()
    for r in results:
        all_ids.update(r.matching_pheromone_ids)

    met = False
    if condition.operator == "and":
        met = all(r.met for r in results)
    elif condition.operator == "or":
        met = any(r.met for r in results)
    elif condition.operator == "not":
        met = not results[0].met

    value = float(len([r for r in results if r.met]))

    return EvaluationResult(met, value, list(all_ids))

def evaluate_rate(condition: RateCondition, ctx: EvaluationContext) -> EvaluationResult:
    window_start = ctx.now - condition.window_ms

    relevant_emissions = [
        e for e in ctx.emission_history
        if e["trail"] == condition.trail and
           (condition.signal_type == "*" or e["type"] == condition.signal_type) and
           e["timestamp"] >= window_start
    ]

    value = 0.0
    if condition.metric == "emissions_per_second":
        window_seconds = condition.window_ms / 1000.0
        if window_seconds > 0:
            value = len(relevant_emissions) / window_seconds
    else:
        value = float(len(relevant_emissions))

    met = compare(value, condition.operator, condition.value)
    return EvaluationResult(met, value, [])
