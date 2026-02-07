"""
SBP Agent - Declarative agent framework
"""

from __future__ import annotations

import asyncio
import signal
from typing import Any, Callable, Awaitable
from dataclasses import dataclass, field

from sbp.client import AsyncSbpClient
from sbp.types import (
    ScentCondition,
    ThresholdCondition,
    CompositeCondition,
    TriggerPayload,
    DecayModel,
    ExponentialDecay,
)


@dataclass
class ScentRegistration:
    """Internal scent registration"""

    scent_id: str
    condition: ScentCondition
    handler: Callable[[TriggerPayload], Awaitable[None]]
    cooldown_ms: int = 0
    activation_payload: dict[str, Any] = field(default_factory=dict)
    context_trails: list[str] | None = None


class SbpAgent:
    """
    Declarative SBP agent that responds to environmental conditions.

    Example:
        agent = SbpAgent("market-watcher", "http://localhost:3000")

        @agent.on_scent(
            "high-volatility",
            condition=ThresholdCondition(
                trail="market.signals",
                signal_type="volatility",
                aggregation="max",
                operator=">=",
                value=0.7,
            ),
            cooldown_ms=60000,
        )
        async def handle_volatility(trigger: TriggerPayload):
            print(f"Volatility detected: {trigger.context_pheromones}")
            # Emit response
            await agent.emit("market.responses", "alert", 0.8)

        # Run the agent
        asyncio.run(agent.run())
    """

    def __init__(
        self,
        agent_id: str,
        server_url: str = "http://localhost:3000",
        default_decay: DecayModel | None = None,
        local: bool = False,
    ):
        self.agent_id = agent_id
        self.server_url = server_url
        self.default_decay = default_decay or ExponentialDecay(half_life_ms=300000)
        self.local = local
        self._client: AsyncSbpClient | None = None
        self._scents: list[ScentRegistration] = []
        self._running = False

    def on_scent(
        self,
        scent_id: str,
        condition: ScentCondition,
        *,
        cooldown_ms: int = 0,
        activation_payload: dict[str, Any] | None = None,
        context_trails: list[str] | None = None,
    ) -> Callable[[Callable[[TriggerPayload], Awaitable[None]]], Callable[[TriggerPayload], Awaitable[None]]]:
        """
        Decorator to register a handler for a scent condition.

        Args:
            scent_id: Unique identifier for this scent
            condition: The condition that triggers this handler
            cooldown_ms: Minimum time between triggers
            activation_payload: Extra data to include in trigger
            context_trails: Additional trails to include in trigger context
        """

        def decorator(
            func: Callable[[TriggerPayload], Awaitable[None]]
        ) -> Callable[[TriggerPayload], Awaitable[None]]:
            self._scents.append(
                ScentRegistration(
                    scent_id=scent_id,
                    condition=condition,
                    handler=func,
                    cooldown_ms=cooldown_ms,
                    activation_payload=activation_payload or {},
                    context_trails=context_trails,
                )
            )
            return func

        return decorator

    def when(
        self,
        trail: str,
        signal_type: str,
        *,
        aggregation: str = "max",
        operator: str = ">=",
        value: float,
        cooldown_ms: int = 0,
    ) -> Callable[[Callable[[TriggerPayload], Awaitable[None]]], Callable[[TriggerPayload], Awaitable[None]]]:
        """
        Simplified decorator for simple threshold conditions.

        Example:
            @agent.when("market.signals", "volatility", operator=">=", value=0.7)
            async def handle(trigger):
                ...
        """

        def decorator(
            func: Callable[[TriggerPayload], Awaitable[None]]
        ) -> Callable[[TriggerPayload], Awaitable[None]]:
            scent_id = f"{self.agent_id}:{trail}/{signal_type}"
            condition = ThresholdCondition(
                trail=trail,
                signal_type=signal_type,
                aggregation=aggregation,  # type: ignore
                operator=operator,  # type: ignore
                value=value,
            )
            self._scents.append(
                ScentRegistration(
                    scent_id=scent_id,
                    condition=condition,
                    handler=func,
                    cooldown_ms=cooldown_ms,
                )
            )
            return func

        return decorator

    async def emit(
        self,
        trail: str,
        type: str,
        intensity: float,
        *,
        decay: DecayModel | None = None,
        payload: dict[str, Any] | None = None,
        tags: list[str] | None = None,
        merge_strategy: str = "reinforce",
    ) -> None:
        """Emit a pheromone from this agent"""
        if not self._client:
            raise RuntimeError("Agent not running")

        await self._client.emit(
            trail,
            type,
            intensity,
            decay=decay or self.default_decay,
            payload=payload,
            tags=tags,
            merge_strategy=merge_strategy,
        )

    async def sniff(
        self,
        trails: list[str] | None = None,
        types: list[str] | None = None,
        min_intensity: float = 0,
    ) -> Any:
        """Sniff the current environment"""
        if not self._client:
            raise RuntimeError("Agent not running")

        return await self._client.sniff(trails, types, min_intensity=min_intensity)

    async def run(self) -> None:
        """Run the agent, registering all scents and listening for triggers"""
        self._client = AsyncSbpClient(self.server_url, agent_id=self.agent_id, local=self.local)
        await self._client.connect()

        self._running = True
        print(f"[SBP Agent] {self.agent_id} starting (local={self.local})...")

        try:
            # Register all scents
            for scent in self._scents:
                await self._client.register_scent(
                    scent.scent_id,
                    scent.condition,
                    cooldown_ms=scent.cooldown_ms,
                    activation_payload=scent.activation_payload,
                    context_trails=scent.context_trails,
                )
                # Subscribe to WebSocket triggers
                await self._client.subscribe(scent.scent_id, scent.handler)
                print(f"[SBP Agent] Registered scent: {scent.scent_id}")

            print(f"[SBP Agent] {self.agent_id} running with {len(self._scents)} scents")

            # Keep running until stopped
            while self._running:
                await asyncio.sleep(1)

        except asyncio.CancelledError:
            pass
        finally:
            # Cleanup
            for scent in self._scents:
                await self._client.deregister_scent(scent.scent_id)

            await self._client.close()
            print(f"[SBP Agent] {self.agent_id} stopped")

    def stop(self) -> None:
        """Stop the agent"""
        self._running = False

    async def run_until_complete(self, timeout: float | None = None) -> None:
        """Run the agent with optional timeout"""
        try:
            if timeout:
                await asyncio.wait_for(self.run(), timeout=timeout)
            else:
                await self.run()
        except asyncio.TimeoutError:
            self.stop()


def run_agent(agent: SbpAgent) -> None:
    """
    Run an agent with graceful shutdown on SIGINT/SIGTERM.

    Example:
        agent = SbpAgent("my-agent")

        @agent.when("signals", "event", value=0.5)
        async def handle(trigger):
            ...

        run_agent(agent)
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    def shutdown() -> None:
        agent.stop()

    loop.add_signal_handler(signal.SIGINT, shutdown)
    loop.add_signal_handler(signal.SIGTERM, shutdown)

    try:
        loop.run_until_complete(agent.run())
    finally:
        loop.close()
