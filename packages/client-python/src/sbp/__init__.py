"""
SBP Client - Stigmergic Blackboard Protocol Python SDK
"""

from sbp.agent import SbpAgent, run_agent
from sbp.client import AsyncSbpClient, SbpClient
from sbp.conditions import (
    # Composite builders
    and_,
    avg_gte,
    count_gte,
    exists,
    heartbeat_stale,
    high_load,
    max_gte,
    not_,
    or_,
    # Common patterns
    quorum,
    # Rate builders
    rate,
    sum_gte,
    # Basic builders
    threshold,
    trace_equals,
    # Trace builders
    trace_exists,
    trace_not_exists,
    unless_paused,
    with_cooldown_guard,
)
from sbp.types import (
    TRACE_MAX_VALUE_SIZE,
    CompositeCondition,
    DecayModel,
    EmitParams,
    EmitResult,
    EraseParams,
    EraseResult,
    ExponentialDecay,
    ImmortalDecay,
    InscribeParams,
    InscribeResult,
    LinearDecay,
    Pheromone,
    PheromoneSnapshot,
    RateCondition,
    ReadParams,
    ReadResult,
    RegisterScentParams,
    RegisterScentResult,
    ScentCondition,
    SniffParams,
    SniffResult,
    StepDecay,
    ThresholdCondition,
    Trace,
    TraceCondition,
    TriggerPayload,
)

__version__ = "0.2.1"
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
