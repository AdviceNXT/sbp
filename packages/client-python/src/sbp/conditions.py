"""
SBP Condition Builders - Fluent API for building scent conditions
"""

from sbp.types import (
    ThresholdCondition,
    CompositeCondition,
    RateCondition,
    ScentCondition,
)


# ============================================================================
# THRESHOLD HELPERS
# ============================================================================

def threshold(
    trail: str,
    signal_type: str,
    operator: str = ">=",
    value: float = 0.5,
    aggregation: str = "max",
) -> ThresholdCondition:
    """
    Create a threshold condition.

    Examples:
        threshold("market.signals", "volatility", ">=", 0.7)
        threshold("tasks", "pending", ">=", 5, aggregation="count")
    """
    return ThresholdCondition(
        trail=trail,
        signal_type=signal_type,
        aggregation=aggregation,  # type: ignore
        operator=operator,  # type: ignore
        value=value,
    )


def exists(trail: str, signal_type: str) -> ThresholdCondition:
    """Check if any signal of this type exists (intensity > 0)."""
    return threshold(trail, signal_type, ">=", 1, aggregation="any")


def count_gte(trail: str, signal_type: str, count: int) -> ThresholdCondition:
    """Check if count of signals >= N."""
    return threshold(trail, signal_type, ">=", count, aggregation="count")


def max_gte(trail: str, signal_type: str, value: float) -> ThresholdCondition:
    """Check if max intensity >= value."""
    return threshold(trail, signal_type, ">=", value, aggregation="max")


def sum_gte(trail: str, signal_type: str, value: float) -> ThresholdCondition:
    """Check if sum of intensities >= value."""
    return threshold(trail, signal_type, ">=", value, aggregation="sum")


def avg_gte(trail: str, signal_type: str, value: float) -> ThresholdCondition:
    """Check if average intensity >= value."""
    return threshold(trail, signal_type, ">=", value, aggregation="avg")


# ============================================================================
# COMPOSITE HELPERS
# ============================================================================

def and_(*conditions: ScentCondition) -> CompositeCondition:
    """
    All conditions must be true.

    Example:
        and_(
            threshold("a", "x", ">=", 0.5),
            threshold("b", "y", ">=", 0.3),
        )
    """
    return CompositeCondition(operator="and", conditions=list(conditions))


def or_(*conditions: ScentCondition) -> CompositeCondition:
    """
    Any condition can be true.

    Example:
        or_(
            threshold("errors", "critical", ">=", 0.1),
            threshold("errors", "timeout", ">=", 5, "count"),
        )
    """
    return CompositeCondition(operator="or", conditions=list(conditions))


def not_(condition: ScentCondition) -> CompositeCondition:
    """
    Invert a condition.

    Example:
        not_(threshold("control", "pause", ">=", 0.5))
    """
    return CompositeCondition(operator="not", conditions=[condition])


# ============================================================================
# RATE HELPERS
# ============================================================================

def rate(
    trail: str,
    signal_type: str,
    operator: str = ">=",
    value: float = 1.0,
    window_ms: int = 10000,
    metric: str = "emissions_per_second",
) -> RateCondition:
    """
    Create a rate-based condition.

    Example:
        rate("api", "request", ">=", 100, window_ms=10000)  # 100 req/sec over 10s
    """
    return RateCondition(
        trail=trail,
        signal_type=signal_type,
        metric=metric,  # type: ignore
        window_ms=window_ms,
        operator=operator,  # type: ignore
        value=value,
    )


# ============================================================================
# COMMON PATTERNS
# ============================================================================

def quorum(trail: str, signal_type: str, count: int) -> ThresholdCondition:
    """Trigger when N signals of this type exist."""
    return count_gte(trail, signal_type, count)


def heartbeat_stale(trail: str, min_intensity: float = 0.3) -> CompositeCondition:
    """Trigger when heartbeat has decayed below threshold (stale)."""
    return not_(max_gte(trail, "heartbeat", min_intensity))


def high_load(trail: str, signal_type: str, threshold_count: int = 10) -> ThresholdCondition:
    """Trigger when queue/backlog exceeds threshold."""
    return count_gte(trail, signal_type, threshold_count)


def unless_paused(condition: ScentCondition, pause_trail: str = "control") -> CompositeCondition:
    """Wrap a condition to also require NOT paused."""
    return and_(
        condition,
        not_(max_gte(pause_trail, "pause", 0.5))
    )


def with_cooldown_guard(
    condition: ScentCondition,
    guard_trail: str,
    guard_type: str = "processing",
) -> CompositeCondition:
    """Only trigger if not already processing (mutual exclusion)."""
    return and_(
        condition,
        not_(exists(guard_trail, guard_type))
    )
