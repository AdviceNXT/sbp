"""
SBP Type Definitions
"""

from __future__ import annotations

from typing import Any, Literal, Union
from pydantic import BaseModel, Field


# ============================================================================
# DECAY MODELS
# ============================================================================


class ExponentialDecay(BaseModel):
    """Exponential decay: intensity halves every half_life_ms"""

    type: Literal["exponential"] = "exponential"
    half_life_ms: int = Field(gt=0)


class LinearDecay(BaseModel):
    """Linear decay: intensity decreases by rate_per_ms each millisecond"""

    type: Literal["linear"] = "linear"
    rate_per_ms: float = Field(gt=0)


class StepDecay(BaseModel):
    """Step decay: intensity changes at discrete time points"""

    type: Literal["step"] = "step"
    steps: list[dict[str, float]]  # [{"at_ms": 1000, "intensity": 0.5}, ...]


class ImmortalDecay(BaseModel):
    """Immortal: never decays"""

    type: Literal["immortal"] = "immortal"


DecayModel = Union[ExponentialDecay, LinearDecay, StepDecay, ImmortalDecay]


def exponential_decay(half_life_ms: int) -> ExponentialDecay:
    """Create an exponential decay model"""
    return ExponentialDecay(half_life_ms=half_life_ms)


def linear_decay(rate_per_ms: float) -> LinearDecay:
    """Create a linear decay model"""
    return LinearDecay(rate_per_ms=rate_per_ms)


def immortal() -> ImmortalDecay:
    """Create an immortal (non-decaying) model"""
    return ImmortalDecay()


# ============================================================================
# PHEROMONE
# ============================================================================


class Pheromone(BaseModel):
    """A pheromone in the blackboard"""

    id: str
    trail: str
    type: str
    emitted_at: int
    last_reinforced_at: int
    initial_intensity: float = Field(ge=0, le=1)
    decay_model: DecayModel
    payload: dict[str, Any] = Field(default_factory=dict)
    source_agent: str | None = None
    tags: list[str] = Field(default_factory=list)
    ttl_floor: float = 0.01


class PheromoneSnapshot(BaseModel):
    """A snapshot of a pheromone at a point in time"""

    id: str
    trail: str
    type: str
    current_intensity: float
    payload: dict[str, Any]
    age_ms: int
    tags: list[str] = Field(default_factory=list)


# ============================================================================
# TAG FILTERING
# ============================================================================


class TagFilter(BaseModel):
    """Filter pheromones by tags"""

    any: list[str] | None = None
    all: list[str] | None = None
    none: list[str] | None = None


# ============================================================================
# SCENT CONDITIONS
# ============================================================================


class ThresholdCondition(BaseModel):
    """Threshold-based condition"""

    type: Literal["threshold"] = "threshold"
    trail: str
    signal_type: str
    tags: TagFilter | None = None
    aggregation: Literal["sum", "max", "avg", "count", "any"] = "max"
    operator: Literal[">=", ">", "<=", "<", "==", "!="] = ">="
    value: float


class CompositeCondition(BaseModel):
    """Composite condition (AND, OR, NOT)"""

    type: Literal["composite"] = "composite"
    operator: Literal["and", "or", "not"]
    conditions: list["ScentCondition"]


class RateCondition(BaseModel):
    """Rate-based condition"""

    type: Literal["rate"] = "rate"
    trail: str
    signal_type: str
    metric: Literal["emissions_per_second", "intensity_delta"]
    window_ms: int = Field(gt=0)
    operator: Literal[">=", ">", "<=", "<"] = ">="
    value: float


ScentCondition = Union[ThresholdCondition, CompositeCondition, RateCondition]

# Update forward refs for recursive types
CompositeCondition.model_rebuild()


# ============================================================================
# OPERATION PARAMS & RESULTS
# ============================================================================


class EmitParams(BaseModel):
    """Parameters for EMIT operation"""

    trail: str
    type: str
    intensity: float = Field(ge=0, le=1)
    decay: DecayModel | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    merge_strategy: Literal["reinforce", "replace", "max", "add", "new"] = "reinforce"
    source_agent: str | None = None


class EmitResult(BaseModel):
    """Result of EMIT operation"""

    pheromone_id: str
    action: Literal["created", "reinforced", "replaced", "merged"]
    previous_intensity: float | None = None
    new_intensity: float


class SniffParams(BaseModel):
    """Parameters for SNIFF operation"""

    trails: list[str] | None = None
    types: list[str] | None = None
    min_intensity: float = 0
    max_age_ms: int | None = None
    tags: TagFilter | None = None
    limit: int = 100
    include_evaporated: bool = False


class AggregateStats(BaseModel):
    """Aggregated statistics for a trail/type"""

    count: int
    sum_intensity: float
    max_intensity: float
    avg_intensity: float


class SniffResult(BaseModel):
    """Result of SNIFF operation"""

    timestamp: int
    pheromones: list[PheromoneSnapshot]
    aggregates: dict[str, AggregateStats]


class RegisterScentParams(BaseModel):
    """Parameters for REGISTER_SCENT operation"""

    scent_id: str
    agent_endpoint: str
    condition: ScentCondition
    cooldown_ms: int = 0
    activation_payload: dict[str, Any] = Field(default_factory=dict)
    trigger_mode: Literal["level", "edge_rising", "edge_falling"] = "level"
    hysteresis: float = 0
    max_execution_ms: int = 30000
    context_trails: list[str] | None = None


class RegisterScentResult(BaseModel):
    """Result of REGISTER_SCENT operation"""

    scent_id: str
    status: Literal["registered", "updated"]
    current_condition_state: dict[str, Any]


class DeregisterScentParams(BaseModel):
    """Parameters for DEREGISTER_SCENT operation"""

    scent_id: str


class DeregisterScentResult(BaseModel):
    """Result of DEREGISTER_SCENT operation"""

    scent_id: str
    status: Literal["deregistered", "not_found"]


class TriggerPayload(BaseModel):
    """Payload sent when a scent triggers"""

    scent_id: str
    triggered_at: int
    condition_snapshot: dict[str, dict[str, Any]]
    context_pheromones: list[PheromoneSnapshot]
    activation_payload: dict[str, Any]


class EvaporateParams(BaseModel):
    """Parameters for EVAPORATE operation"""

    trail: str | None = None
    types: list[str] | None = None
    older_than_ms: int | None = None
    below_intensity: float | None = None
    tags: TagFilter | None = None


class EvaporateResult(BaseModel):
    """Result of EVAPORATE operation"""

    evaporated_count: int
    trails_affected: list[str]


class InspectParams(BaseModel):
    """Parameters for INSPECT operation"""

    include: list[str] | None = None


class InspectResult(BaseModel):
    """Result of INSPECT operation"""

    timestamp: int
    trails: list[dict[str, Any]] | None = None
    scents: list[dict[str, Any]] | None = None
    stats: dict[str, Any] | None = None


# ============================================================================
# JSON-RPC
# ============================================================================


class JsonRpcRequest(BaseModel):
    """JSON-RPC 2.0 request"""

    jsonrpc: Literal["2.0"] = "2.0"
    id: str | int
    method: str
    params: dict[str, Any] = Field(default_factory=dict)


class JsonRpcError(BaseModel):
    """JSON-RPC error"""

    code: int
    message: str
    data: Any | None = None


class JsonRpcResponse(BaseModel):
    """JSON-RPC 2.0 response"""

    jsonrpc: Literal["2.0"] = "2.0"
    id: str | int | None
    result: Any | None = None
    error: JsonRpcError | None = None
