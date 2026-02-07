"""
SBP Example: Market Volatility Crisis Detection

This example demonstrates multi-agent coordination using SBP.
Three agents work together without direct communication:

1. Market Analyzer - Emits volatility signals based on market data
2. Order Monitor - Emits signals about large orders
3. Crisis Handler - Wakes up when volatility AND large orders exceed thresholds

Run:
    # Terminal 1: Start the SBP server
    cd packages/server && npm run dev

    # Terminal 2: Run this example
    cd packages/client-python && python -m examples.market_crisis
"""

import asyncio
import random
from sbp import (
    AsyncSbpClient,
    ThresholdCondition,
    CompositeCondition,
    TriggerPayload,
    exponential_decay,
)


async def market_analyzer(client: AsyncSbpClient) -> None:
    """Simulates a market analyzer that emits volatility signals"""
    print("[Market Analyzer] Starting...")

    while True:
        # Simulate market volatility (random for demo)
        volatility = random.uniform(0.2, 0.95)

        await client.emit(
            trail="market.signals",
            type="volatility",
            intensity=volatility,
            decay=exponential_decay(half_life_ms=30000),  # 30 second half-life
            payload={
                "symbol": "BTC-USD",
                "vix_equivalent": volatility * 100,
                "timestamp": asyncio.get_event_loop().time(),
            },
            tags=["crypto", "realtime"],
        )

        print(f"[Market Analyzer] Emitted volatility: {volatility:.2f}")
        await asyncio.sleep(2)


async def order_monitor(client: AsyncSbpClient) -> None:
    """Simulates an order monitor that emits large order signals"""
    print("[Order Monitor] Starting...")

    while True:
        # Simulate detecting large orders (random for demo)
        if random.random() > 0.5:
            size = random.randint(500000, 5000000)
            side = random.choice(["buy", "sell"])

            await client.emit(
                trail="market.orders",
                type="large_order",
                intensity=min(1.0, size / 5000000),  # Normalize by max size
                decay=exponential_decay(half_life_ms=60000),  # 1 minute half-life
                payload={
                    "symbol": "BTC-USD",
                    "size_usd": size,
                    "side": side,
                },
                tags=["crypto", "whale"],
            )

            print(f"[Order Monitor] Detected {side} order: ${size:,}")

        await asyncio.sleep(3)


async def crisis_handler(client: AsyncSbpClient) -> None:
    """Agent that triggers when crisis conditions are met"""
    print("[Crisis Handler] Registering scent...")

    # Define the crisis condition:
    # High volatility AND multiple large orders
    condition = CompositeCondition(
        operator="and",
        conditions=[
            ThresholdCondition(
                trail="market.signals",
                signal_type="volatility",
                aggregation="max",
                operator=">=",
                value=0.7,  # 70% volatility threshold
            ),
            ThresholdCondition(
                trail="market.orders",
                signal_type="large_order",
                aggregation="count",
                operator=">=",
                value=2,  # At least 2 large orders
            ),
        ],
    )

    # Register the scent
    await client.register_scent(
        scent_id="crisis-detector",
        condition=condition,
        cooldown_ms=10000,  # 10 second cooldown between triggers
        activation_payload={"severity": "high"},
        context_trails=["market.signals", "market.orders"],
    )

    # Subscribe to triggers
    async def on_crisis(trigger: TriggerPayload) -> None:
        print("\n" + "=" * 60)
        print("🚨 CRISIS DETECTED!")
        print(f"   Triggered at: {trigger.triggered_at}")
        print(f"   Context pheromones: {len(trigger.context_pheromones)}")

        for p in trigger.context_pheromones:
            print(f"   - {p.trail}/{p.type}: {p.current_intensity:.2f}")
            print(f"     Payload: {p.payload}")

        # Crisis handler could emit its own response
        await client.emit(
            trail="system.alerts",
            type="crisis_response",
            intensity=1.0,
            payload={
                "action": "reduce_exposure",
                "triggered_by": trigger.scent_id,
            },
        )
        print("   ✓ Emitted crisis response signal")
        print("=" * 60 + "\n")

    await client.subscribe("crisis-detector", on_crisis)
    print("[Crisis Handler] Listening for crisis conditions...")

    # Keep running
    while True:
        await asyncio.sleep(1)


async def environment_monitor(client: AsyncSbpClient) -> None:
    """Periodically displays environment state"""
    while True:
        await asyncio.sleep(5)

        result = await client.sniff(
            trails=["market.signals", "market.orders", "system.alerts"],
            min_intensity=0.1,
        )

        print("\n--- Environment State ---")
        for key, agg in result.aggregates.items():
            print(f"  {key}: count={agg.count}, max={agg.max_intensity:.2f}")
        print("-------------------------\n")


async def main() -> None:
    """Run all agents concurrently"""
    print("=" * 60)
    print("SBP Market Crisis Detection Demo")
    print("=" * 60)
    print()

    # Create clients for each agent
    analyzer_client = AsyncSbpClient(agent_id="market-analyzer")
    order_client = AsyncSbpClient(agent_id="order-monitor")
    crisis_client = AsyncSbpClient(agent_id="crisis-handler")
    monitor_client = AsyncSbpClient(agent_id="env-monitor")

    await analyzer_client.connect()
    await order_client.connect()
    await crisis_client.connect()
    await monitor_client.connect()

    try:
        # Run all agents concurrently
        await asyncio.gather(
            market_analyzer(analyzer_client),
            order_monitor(order_client),
            crisis_handler(crisis_client),
            environment_monitor(monitor_client),
        )
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        await analyzer_client.close()
        await order_client.close()
        await crisis_client.close()
        await monitor_client.close()


if __name__ == "__main__":
    asyncio.run(main())
