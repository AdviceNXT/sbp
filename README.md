# Stigmergic Blackboard Protocol (SBP)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Spec Version](https://img.shields.io/badge/spec-v0.1.0-green.svg)](SPECIFICATION.md)

A protocol for environment-based coordination between autonomous agents using digital pheromones.

> **MCP standardized how agents call tools.**
> **SBP standardizes how agents coordinate without talking to each other.**

## Quick Start

### 1. Start the Server

```bash
# Install dependencies
cd packages/server && npm install

# Start the server
npm run dev
# → Server listening on http://localhost:3000
```

### 2. Use the Python SDK

```bash
cd packages/client-python
pip install -e .
```

```python
from sbp import SbpClient, ThresholdCondition

with SbpClient() as client:
    # Emit a pheromone
    client.emit("signals", "event", 0.8, payload={"source": "sensor-1"})

    # Sniff the environment
    result = client.sniff(trails=["signals"])
    for p in result.pheromones:
        print(f"{p.trail}/{p.type}: {p.current_intensity:.2f}")
```

### 3. Build an Agent

```python
from sbp import SbpAgent, run_agent

agent = SbpAgent("my-agent")

@agent.when("tasks", "new_task", operator=">=", value=0.5)
async def handle_task(trigger):
    print(f"Task received: {trigger.context_pheromones}")
    await agent.emit("tasks", "completed", 1.0)

run_agent(agent)
```

## Local Mode (No Server Required)

You can run SBP entirely in-memory within a single process. This is useful for testing, simulations, or simple multi-agent scripts where you don't want to manage a separate server process.

```python
from sbp import SbpClient, SbpAgent

# Client in local mode (shares state with other local instances)
with SbpClient(local=True) as client:
    client.emit("local.test", "signal", 0.9)

# Agent in local mode
agent = SbpAgent("my-agent", local=True)

@agent.when("local.test", "signal", value=0.5)
async def handle(trigger):
    print("Received signal locally!")
```

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      BLACKBOARD                             │
│                                                             │
│  Pheromones decay over time:     ◉ → ○ → · → (evaporated) │
│                                                             │
│  Agents EMIT signals     ───────────────┐                  │
│  Agents SNIFF state      ◄──────────────┤                  │
│  Conditions TRIGGER agents ─────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

SBP replaces direct agent-to-agent messaging with **stigmergic coordination**. Like ants leaving pheromone trails, agents deposit signals that other agents sense and respond to.

## Key Concepts

| Concept | Description |
|---------|-------------|
| **Pheromone** | A signal with type, intensity, decay rate, and payload |
| **Intensity** | Signal strength (0.0-1.0), continuously decaying |
| **Trail** | Namespaced category (e.g., `market.signals`) |
| **Scent** | Trigger condition that activates an agent |
| **Emit** | Deposit a pheromone |
| **Sniff** | Read environmental state |

## Design Principles

1. **Stale-by-Default**: All signals decay. Unreinforced data evaporates.
2. **Sense, Don't Poll**: Agents declare interest patterns; environment triggers them.
3. **Stateless Agents**: Agents are dormant by default, activated by conditions.
4. **Intensity Over Boolean**: Signals have continuous strength, enabling nuanced response.

## Packages

| Package | Description |
|---------|-------------|
| [`@sbp/server`](packages/server) | TypeScript server implementation |
| [`@sbp/client`](packages/client-ts) | TypeScript/JavaScript client SDK |
| [`sbp-client`](packages/client-python) | Python client SDK |

## Protocol Operations

### EMIT — Deposit a pheromone

```json
{
  "method": "sbp/emit",
  "params": {
    "trail": "market.signals",
    "type": "volatility",
    "intensity": 0.8,
    "decay": { "type": "exponential", "half_life_ms": 300000 },
    "payload": { "symbol": "BTC-USD" }
  }
}
```

### SNIFF — Read environment state

```json
{
  "method": "sbp/sniff",
  "params": {
    "trails": ["market.signals"],
    "min_intensity": 0.1
  }
}
```

### REGISTER_SCENT — Declare a trigger condition

```json
{
  "method": "sbp/register_scent",
  "params": {
    "scent_id": "volatility-detector",
    "agent_endpoint": "https://agents.example.com/handler",
    "condition": {
      "type": "threshold",
      "trail": "market.signals",
      "signal_type": "volatility",
      "aggregation": "max",
      "operator": ">=",
      "value": 0.7
    },
    "cooldown_ms": 60000
  }
}
```

### TRIGGER — Blackboard activates agent

When conditions are met, the blackboard sends:

```json
{
  "method": "sbp/trigger",
  "params": {
    "scent_id": "volatility-detector",
    "triggered_at": 1707350400000,
    "context_pheromones": [...]
  }
}
```

## Comparison with MCP

| MCP | SBP |
|-----|-----|
| Tool calling | Pheromone emission |
| Direct invocation | Threshold triggering |
| Request-response | Fire-and-forget + sense |
| Explicit routing | Environmental routing |
| Stateful sessions | Stateless agents |

**MCP + SBP together** = Complete agentic infrastructure
- Use **MCP** for direct tool invocation
- Use **SBP** for emergent multi-agent coordination

## Example: Multi-Agent Market Crisis Detection

```python
from sbp import AsyncSbpClient, CompositeCondition, ThresholdCondition

# Agent 1: Market Analyzer emits volatility
await client.emit("market.signals", "volatility", 0.85)

# Agent 2: Order Monitor emits large orders
await client.emit("market.orders", "large_order", 0.7)
await client.emit("market.orders", "large_order", 0.6)

# Agent 3: Crisis Handler registered with condition:
#   "volatility >= 0.7 AND large_order count >= 2"
# → Automatically triggered when both conditions met
# → No orchestrator, no message passing, no coordination code
```

## Documentation

- **[SPECIFICATION.md](./SPECIFICATION.md)** — Complete protocol specification
- **[QUICK_REFERENCE.md](./QUICK_REFERENCE.md)** — Cheat sheet and diagrams
- **[schemas/](./schemas/)** — JSON Schema for validation
- **[examples/](./packages/client-python/examples/)** — Working examples

## Development

```bash
# Install all dependencies
npm install

# Build all packages
npm run build

# Run the server in development mode
npm run dev

# Run Python examples
cd packages/client-python
pip install -e ".[dev]"
python -m examples.market_crisis
```

## Project Structure

```
sbp/
├── SPECIFICATION.md          # Protocol specification
├── QUICK_REFERENCE.md        # Quick reference guide
├── schemas/                  # JSON Schema
│   └── sbp-v0.1.schema.json
├── packages/
│   ├── server/              # TypeScript server
│   ├── client-ts/           # TypeScript client
│   └── client-python/       # Python client
│       ├── src/sbp/
│       └── examples/
└── types/                   # Shared TypeScript types
```

## Status

**Version 0.1.0** — Working implementation, spec under refinement.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

- **Specification**: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Code**: [MIT](LICENSE)
