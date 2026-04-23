"""
SBP Client - Stigmergic Blackboard Protocol Python SDK
"""

from sbp.client import SbpClient, AsyncSbpClient
from sbp.types import (
    DecayModel,
    ExponentialDecay,
    LinearDecay,
    StepDecay,
    ImmortalDecay,
    Pheromone,
    PheromoneSnapshot,
    ThresholdCondition,
    CompositeCondition,
    RateCondition,
    TraceCondition,
    ScentCondition,
    EmitParams,
    EmitResult,
    SniffParams,
    SniffResult,
    RegisterScentParams,
    RegisterScentResult,
    TriggerPayload,
    Trace,
    InscribeParams,
    InscribeResult,
    ReadParams,
    ReadResult,
    EraseParams,
    EraseResult,
    TRACE_MAX_VALUE_SIZE,
)
from sbp.agent import SbpAgent, run_agent
from sbp.conditions import (
    # Basic builders
    threshold,
    exists,
    count_gte,
    max_gte,
    sum_gte,
    avg_gte,
    # Composite builders
    and_,
    or_,
    not_,
    # Rate builders
    rate,
    # Trace builders
    trace_exists,
    trace_not_exists,
    trace_equals,
    # Common patterns
    quorum,
    heartbeat_stale,
    high_load,
    unless_paused,
    with_cooldown_guard,
)

__version__ = "0.2.0"
__all__ = [
    # Client
    "SbpClient",
    "AsyncSbpClient",
    # Agent
    "SbpAgent",
    "run_agent",
    # Types - Decay
    "DecayModel",
    "ExponentialDecay",
    "LinearDecay",
    "StepDecay",
    "ImmortalDecay",
    # Types - Pheromone
    "Pheromone",
    "PheromoneSnapshot",
    # Types - Conditions
    "ThresholdCondition",
    "CompositeCondition",
    "RateCondition",
    "TraceCondition",
    "ScentCondition",
    # Types - Operations
    "EmitParams",
    "EmitResult",
    "SniffParams",
    "SniffResult",
    "RegisterScentParams",
    "RegisterScentResult",
    "TriggerPayload",
    # Types - Traces
    "Trace",
    "InscribeParams",
    "InscribeResult",
    "ReadParams",
    "ReadResult",
    "EraseParams",
    "EraseResult",
    "TRACE_MAX_VALUE_SIZE",
    # Condition Builders - Basic
    "threshold",
    "exists",
    "count_gte",
    "max_gte",
    "sum_gte",
    "avg_gte",
    # Condition Builders - Composite
    "and_",
    "or_",
    "not_",
    # Condition Builders - Rate
    "rate",
    # Condition Builders - Trace
    "trace_exists",
    "trace_not_exists",
    "trace_equals",
    # Condition Builders - Patterns
    "quorum",
    "heartbeat_stale",
    "high_load",
    "unless_paused",
    "with_cooldown_guard",
]
