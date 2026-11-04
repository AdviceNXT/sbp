"""
Concurrent trigger dispatch tests
"""

import asyncio

import pytest

from sbp.blackboard import LocalBlackboard
from sbp.types import EmitParams, ImmortalDecay, RegisterScentParams, ThresholdCondition


@pytest.mark.asyncio
async def test_a_blocked_handler_does_not_delay_another_scents_dispatch() -> None:
    bb = LocalBlackboard()
    fast_fired = asyncio.Event()
    never_unblock = asyncio.Event()

    async def slow_handler(_trigger) -> None:
        await never_unblock.wait()

    async def fast_handler(_trigger) -> None:
        fast_fired.set()

    bb.register_scent(
        RegisterScentParams(
            scent_id="slow",
            agent_endpoint="http://localhost/slow",
            condition=ThresholdCondition(trail="a", signal_type="e", operator=">=", value=0.5),
        )
    )
    bb.subscribe("slow", slow_handler)

    bb.register_scent(
        RegisterScentParams(
            scent_id="fast",
            agent_endpoint="http://localhost/fast",
            condition=ThresholdCondition(trail="b", signal_type="e", operator=">=", value=0.5),
        )
    )
    bb.subscribe("fast", fast_handler)

    bb.emit(EmitParams(trail="a", type="e", intensity=0.9, decay=ImmortalDecay()))
    bb.emit(EmitParams(trail="b", type="e", intensity=0.9, decay=ImmortalDecay()))

    await bb.evaluate_scents()

    # Sequential dispatch would hang here on the slow handler before the fast
    # one ever ran; fire-and-forget lets evaluate_scents() return immediately.
    await asyncio.wait_for(fast_fired.wait(), timeout=2.0)

    never_unblock.set()
    await bb.stop()
