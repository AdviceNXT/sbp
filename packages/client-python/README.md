# SBP Python Client

Python SDK for the Stigmergic Blackboard Protocol.

## Installation

```bash
pip install sbp-client
```

## Quick Start

```python
from sbp import SbpClient, ThresholdCondition

# Connect to the blackboard
with SbpClient("http://localhost:3000") as client:
    # Emit a pheromone
    client.emit(
        trail="market.signals",
        type="volatility",
        intensity=0.8,
        payload={"symbol": "BTC-USD", "vix": 45.2},
    )

    # Sniff the environment
    result = client.sniff(trails=["market.signals"])
    for p in result.pheromones:
        print(f"{p.trail}/{p.type}: {p.current_intensity:.2f}")
```

## Local Mode (No Server Required)

You can run SBP entirely in-memory within a single process. This is useful for testing, simulations, or simple multi-agent scripts where you don't want to manage a separate server process.

```python
from sbp import SbpClient, SbpAgent

# Client in local mode
with SbpClient(local=True) as client:
    client.emit("local.test", "signal", 0.9)

# Agent in local mode
# Note: In a single process, all local=True instances share the same blackboard state.
agent = SbpAgent("my-agent", local=True)

@agent.when("local.test", "signal", value=0.5)
async def handle(trigger):
    print("Received signal locally!")
```

## Async Usage

```python
import asyncio
from sbp import AsyncSbpClient, ThresholdCondition

async def main():
    async with AsyncSbpClient() as client:
        # Emit
        await client.emit("signals", "event", 0.7)

        # Register a scent (trigger condition)
        await client.register_scent(
            "my-scent",
            condition=ThresholdCondition(
                trail="signals",
                signal_type="event",
                aggregation="max",
                operator=">=",
                value=0.5,
            ),
        )

        # Subscribe to triggers via WebSocket
        async def on_trigger(trigger):
            print(f"Triggered! {trigger.scent_id}")

        await client.subscribe("my-scent", on_trigger)

asyncio.run(main())
```

## Declarative Agent Framework

```python
from sbp import SbpAgent, TriggerPayload, run_agent

agent = SbpAgent("my-agent", "http://localhost:3000")

@agent.when("tasks", "new_task", operator=">=", value=0.5)
async def handle_task(trigger: TriggerPayload):
    print(f"Got task: {trigger.context_pheromones}")
    await agent.emit("tasks", "completed", 1.0)

run_agent(agent)
```

## API Reference

### SbpClient / AsyncSbpClient

| Method | Description |
|--------|-------------|
| `emit(trail, type, intensity, ...)` | Deposit a pheromone |
| `sniff(trails, types, ...)` | Read environment state |
| `register_scent(scent_id, condition, ...)` | Register a trigger |
| `deregister_scent(scent_id)` | Remove a trigger |
| `subscribe(scent_id, handler)` | Listen for triggers (async only) |
| `inspect(include)` | Get blackboard metadata |
| `evaporate(...)` | Force cleanup |

### Condition Types

```python
# Simple threshold
ThresholdCondition(
    trail="market.signals",
    signal_type="volatility",
    aggregation="max",  # sum, max, avg, count, any
    operator=">=",      # >=, >, <=, <, ==, !=
    value=0.7,
)

# Composite (AND/OR/NOT)
CompositeCondition(
    operator="and",
    conditions=[condition1, condition2],
)

# Rate-based
RateCondition(
    trail="events",
    signal_type="click",
    metric="emissions_per_second",
    window_ms=10000,
    operator=">=",
    value=5.0,
)
```

### Decay Models

```python
from sbp.types import exponential_decay, linear_decay, immortal

# Exponential (default) - half-life in milliseconds
decay = exponential_decay(half_life_ms=300000)  # 5 minutes

# Linear - rate per millisecond
decay = linear_decay(rate_per_ms=0.0001)

# Immortal - never decays
decay = immortal()
```

## License

MIT
