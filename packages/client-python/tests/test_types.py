"""
SBP Client Tests
"""

import pytest
from sbp.types import (
    ExponentialDecay,
    LinearDecay,
    ThresholdCondition,
    CompositeCondition,
    exponential_decay,
    linear_decay,
)


class TestDecayModels:
    def test_exponential_decay(self) -> None:
        decay = exponential_decay(half_life_ms=300000)
        assert decay.type == "exponential"
        assert decay.half_life_ms == 300000

    def test_linear_decay(self) -> None:
        decay = linear_decay(rate_per_ms=0.001)
        assert decay.type == "linear"
        assert decay.rate_per_ms == 0.001

    def test_decay_model_serialization(self) -> None:
        decay = ExponentialDecay(half_life_ms=60000)
        data = decay.model_dump()
        assert data == {"type": "exponential", "half_life_ms": 60000}


class TestConditions:
    def test_threshold_condition(self) -> None:
        condition = ThresholdCondition(
            trail="market.signals",
            signal_type="volatility",
            aggregation="max",
            operator=">=",
            value=0.7,
        )
        assert condition.type == "threshold"
        assert condition.trail == "market.signals"
        assert condition.aggregation == "max"

    def test_composite_condition(self) -> None:
        c1 = ThresholdCondition(
            trail="a",
            signal_type="x",
            aggregation="max",
            operator=">=",
            value=0.5,
        )
        c2 = ThresholdCondition(
            trail="b",
            signal_type="y",
            aggregation="count",
            operator=">=",
            value=3,
        )
        composite = CompositeCondition(
            operator="and",
            conditions=[c1, c2],
        )
        assert composite.type == "composite"
        assert composite.operator == "and"
        assert len(composite.conditions) == 2

    def test_nested_composite(self) -> None:
        inner = CompositeCondition(
            operator="or",
            conditions=[
                ThresholdCondition(trail="a", signal_type="x", aggregation="any", operator=">=", value=0),
                ThresholdCondition(trail="b", signal_type="y", aggregation="any", operator=">=", value=0),
            ],
        )
        outer = CompositeCondition(
            operator="and",
            conditions=[
                inner,
                ThresholdCondition(trail="c", signal_type="z", aggregation="max", operator=">=", value=0.5),
            ],
        )
        assert outer.conditions[0].type == "composite"  # type: ignore


class TestSerialization:
    def test_condition_to_json(self) -> None:
        condition = ThresholdCondition(
            trail="test",
            signal_type="event",
            aggregation="max",
            operator=">=",
            value=0.5,
        )
        data = condition.model_dump()
        assert data["type"] == "threshold"
        assert data["trail"] == "test"
        assert data["value"] == 0.5

    def test_composite_to_json(self) -> None:
        composite = CompositeCondition(
            operator="and",
            conditions=[
                ThresholdCondition(trail="a", signal_type="x", aggregation="max", operator=">=", value=0.5),
            ],
        )
        data = composite.model_dump()
        assert data["type"] == "composite"
        assert data["operator"] == "and"
        assert len(data["conditions"]) == 1
