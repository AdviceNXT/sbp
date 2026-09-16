"""
Hysteresis re-arm tests (spec §7.4)
"""

import pytest

from sbp.blackboard import LocalBlackboard
from sbp.types import (
    EmitParams,
    ImmortalDecay,
    RegisterScentParams,
    ThresholdCondition,
)


@pytest.mark.asyncio
async def test_hysteresis_keeps_an_edge_scent_disarmed_until_the_value_clears_the_band() -> None:
    bb = LocalBlackboard()
    fired = 0

    async def handler(_trigger) -> None:
        nonlocal fired
        fired += 1

    bb.register_scent(
        RegisterScentParams(
            scent_id="hysteresis-test",
            agent_endpoint="http://localhost/x",
            condition=ThresholdCondition(trail="hys", signal_type="sig", operator=">=", value=0.5),
            trigger_mode="edge_rising",
            hysteresis=0.2,
            cooldown_ms=0,
        )
    )
    bb.subscribe("hysteresis-test", handler)

    def emit(intensity: float) -> None:
        bb.emit(EmitParams(
            trail="hys", type="sig", intensity=intensity,
            decay=ImmortalDecay(), merge_strategy="replace",
        ))

    emit(0.8)
    await bb.evaluate_scents()
    assert fired == 1

    # 0.4 is below threshold but inside the 0.2 hysteresis band -- stays disarmed.
    emit(0.4)
    await bb.evaluate_scents()
    emit(0.8)
    await bb.evaluate_scents()
    assert fired == 1

    # 0.2 clears the hysteresis band (<= 0.5 - 0.2) and re-arms the scent.
    emit(0.2)
    await bb.evaluate_scents()
    emit(0.8)
    await bb.evaluate_scents()
    assert fired == 2
