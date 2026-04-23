# Stigmergic Blackboard Protocol (SBP)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Spec Version](https://img.shields.io/badge/spec-v0.2.0-green.svg)](SPECIFICATION.md)
[![CI](https://github.com/advicenxt/sbp/actions/workflows/ci.yml/badge.svg)](https://github.com/advicenxt/sbp/actions/workflows/ci.yml)

**A coordination protocol for AI agents that work together without talking to each other.**

---

## The Problem

You have multiple AI agents. They need to coordinate. Today, you wire them together with orchestrators, message queues, or direct calls — and every new agent means more glue code, more failure modes, and tighter coupling.

What if agents could coordinate the way ants do?

Ants don't hold meetings. They don't send messages to specific ants. They leave **pheromone trails** in the environment, and other ants sense those trails and react. No coordinator. No routing. No address book. The colony self-organizes.

**SBP brings this pattern to software** — with two complementary layers:

1. **Pheromones** — Ephemeral signals with intensity that decay over time. Perfect for real-time coordination.
2. **Traces** — Durable knowledge records that persist until explicitly erased. Perfect for institutional memory.

Agents deposit signals, sense the environment, and respond when conditions are met. Coordination emerges from the environment, not from explicit wiring.

---

## Where SBP Fits: Alongside MCP, Not Instead Of It

If you're building with AI agents, you've probably seen [MCP (Model Context Protocol)](https://modelcontextprotocol.io/). MCP is excellent — it standardizes how an agent calls a tool, reads a resource, or gets a prompt. It's the standard for **agent → tool** interactions.

But MCP doesn't answer a different question: **how do multiple agents coordinate with each other?**

| | MCP | SBP |
|---|---|---|
| **What it solves** | How an agent uses tools | How agents coordinate together |
| **Interaction** | Direct: "agent calls tool" | Indirect: "agent senses environment" |
| **Coupling** | Agent knows the tool it's calling | Agents don't know each other exist |
| **Pattern** | Request → Response | Emit → Sense → React |
| **State** | Sessions between agent and server | Shared environmental state |
| **Memory** | External to protocol | Built-in (Traces for durable, Pheromones for ephemeral) |

**They're complementary.** Use MCP for tool invocation. Use SBP for multi-agent coordination.

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BLACKBOARD                                  │
│                                                                     │
│  🔥 PHEROMONE LAYER (Ephemeral)                                     │
│   Pheromones decay over time:   ◉ → ○ → · → (evaporated)          │
│                                                                     │
│  🪨 TRACE LAYER (Durable)                                           │
│   Traces persist until erased:  ■ risk-config v2  ■ thesis v3      │
│                                                                     │
│   Agents EMIT signals / INSCRIBE knowledge  ──────┐                │
│   Agents SNIFF state / READ knowledge       ◄─────┤                │
│   Conditions TRIGGER agents                 ──────┘                │
└─────────────────────────────────────────────────────────────────────┘
```

### Eight Operations

| Operation | Layer | What it does |
|-----------|-------|-------------|
| **Emit** | Pheromone | Deposit a signal (intensity + decay + payload) |
| **Sniff** | Pheromone | Read the current environmental state |
| **Register Scent** | Both | Declare "wake me up when these conditions are true" |
| **Trigger** | Both | Blackboard activates a dormant agent |
| **Deregister Scent** | Both | Remove a trigger condition |
| **Inscribe** | Trace | Create or update a durable knowledge record |
| **Read** | Trace | Query traces by trail, key, prefix, or tags |
| **Erase** | Trace | Remove traces matching criteria |

### Key Concepts

- **Pheromones** have intensity (0.0–1.0) that decays over time. Strong signals demand attention; weak ones are background noise. Unreinforced data evaporates automatically.
- **Traces** are versioned knowledge records addressed by `trail + key`. They never decay — use them for configuration, learned knowledge, audit trails, and institutional memory.
- **Trails** are shared namespaces (e.g., `market.signals`, `config`) that organize both pheromones and traces.
- **Scent conditions** are threshold rules that can combine both layers. An agent says "trigger me when volatility ≥ 0.7 AND risk-config exists" and then goes dormant until the environment wakes it.
- **Merge strategies** control what happens when you emit a pheromone that already exists — reinforce it, replace it, take the max, or add intensities.

---

## Installation

### Node.js

```bash
# Server
npm install @advicenxt/sbp-server

# Client
npm install @advicenxt/sbp-client

# Types (Shared definitions)
npm install @advicenxt/sbp-types
```

### Python

```bash
pip install sbp-client
```

## Quick Start

### Start the Server

```bash
cd packages/server && npm install
npm run dev
# → Listening on http://localhost:3000
```

### Python SDK

```bash
cd packages/client-python && pip install -e .
```

```python
from sbp import SbpClient

with SbpClient() as client:
    # Emit a real-time signal (ephemeral)
    client.emit("signals", "event", 0.8, payload={"source": "sensor-1"})

    # Inscribe durable knowledge (persistent)
    client.inscribe("config", "risk-tolerance", {"level": "moderate", "max_drawdown": 0.15})

    # Sense the environment
    result = client.sniff(trails=["signals"])
    for p in result.pheromones:
        print(f"{p.trail}/{p.type}: {p.current_intensity:.2f}")

    # Read traces
    traces = client.read(trails=["config"])
    for t in traces.traces:
        print(f"{t.trail}/{t.key} v{t.version}: {t.value}")
```

### Build a Reactive Agent

```python
from sbp import SbpAgent, run_agent
from sbp.conditions import threshold, trace_exists, and_

agent = SbpAgent("risk-monitor")

# Trigger on real-time signal
@agent.when("tasks", "new_task", operator=">=", value=0.5)
async def handle_task(trigger):
    print(f"Task received: {trigger.context_pheromones}")
    await agent.emit("tasks", "completed", 1.0)

# Cross-layer trigger: pheromone intensity + trace existence
@agent.on_scent("risk-alert",
    condition=and_(
        threshold("market", "volatility", ">=", 0.7),
        trace_exists("config", "risk-tolerance"),
    ),
)
async def handle_risk(trigger):
    # Read the config trace for context
    config = await agent.read(trails=["config"], keys=["risk-tolerance"])
    print(f"Risk alert! Config: {config.traces[0].value}")

run_agent(agent)
```

### Local Mode (No Server)

```python
from sbp import SbpClient

with SbpClient(local=True) as client:
    client.emit("local.test", "signal", 0.9)
    client.inscribe("local.config", "setting", {"debug": True})
```

---

## Use Cases

### 1. Autonomous Research Teams
An MCP-powered research agent uses tools to search the web. When it finds something important, it **emits a pheromone** and **inscribes a trace** with the raw findings. A synthesis agent, sensing a critical mass of research signals, wakes up, reads the traces for context, and compiles a report. No orchestrator scheduled any of this.

### 2. Self-Healing Infrastructure
Monitoring agents emit pheromones when they detect degradation. If the signal persists (multiple agents reinforcing the same pheromone), a remediation agent is triggered. Transient blips evaporate harmlessly because pheromones decay. Post-incident, traces record what happened for institutional memory.

### 3. Financial Signal Processing
A volatility agent emits pheromones proportional to detected volatility. An order agent does the same for large trades. A crisis handler has a **cross-layer condition**: "volatility ≥ 0.7 AND risk-config trace EXISTS." When both conditions are met, the handler wakes up, reads the risk configuration trace, and acts accordingly.

### 4. Multi-Agent Task Coordination
Worker agents emit completion pheromones. An aggregator senses "5+ stage-1 completions" and begins stage 2. Traces record the pipeline's institutional knowledge — what worked, what failed, what to try next time.

---

## Design Principles

1. **Stale-by-Default** — All pheromones decay. Unreinforced data evaporates automatically.
2. **Durable When Needed** — Traces persist for institutional memory. Two timescales, one environment.
3. **Sense, Don't Poll** — Agents declare interest patterns; the environment triggers them.
4. **Stateless Agents** — Agents are dormant by default. No persistent state between activations.
5. **Intensity Over Boolean** — Signals have continuous strength, enabling nuanced responses.

---

## Packages

| Package | Description |
|---------|-------------|
| [`@advicenxt/sbp-server`](packages/server) | TypeScript reference server |
| [`@advicenxt/sbp-types`](packages/types) | Canonical shared type definitions |
| [`@advicenxt/sbp-client`](packages/client-ts) | TypeScript/JavaScript client SDK |
| [`sbp-client`](packages/client-python) | Python client SDK |

---

## Documentation

| Document | Description |
|----------|-------------|
| [SPECIFICATION.md](./SPECIFICATION.md) | Complete protocol specification (RFC 2119) |
| [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) | Cheat sheet and diagrams |
| [schemas/openapi.yaml](./schemas/openapi.yaml) | OpenAPI 3.1 specification |
| [CHANGELOG.md](./CHANGELOG.md) | Version history |
| [docs/adr/](./docs/adr/) | Architecture Decision Records |
| [docs/rfc-process.md](./docs/rfc-process.md) | Governance and RFC process |

---

## Development

```bash
# Install all dependencies
npm install

# Run the server
npm run dev

# Run tests (113 tests across 3 suites)
cd packages/server && npm test

# Run benchmarks
npx tsx packages/server/benchmarks/bench.ts

# Python examples
cd packages/client-python
pip install -e ".[dev]"
python -m examples.market_crisis
```

---

## Project Structure

```
sbp/
├── SPECIFICATION.md              # Protocol specification
├── QUICK_REFERENCE.md            # Cheat sheet
├── CHANGELOG.md                  # Version history
├── schemas/
│   └── openapi.yaml              # OpenAPI 3.1 spec
├── docs/
│   ├── adr/                      # Architecture Decision Records
│   └── rfc-process.md            # Governance
├── rfcs/                         # RFC proposals
├── packages/
│   ├── server/                   # TypeScript server
│   │   ├── src/                  # Core (blackboard, trace-store, conditions)
│   │   └── benchmarks/           # Performance benchmarks
│   ├── types/                    # Shared @advicenxt/sbp-types
│   ├── client-ts/                # TypeScript client
│   └── client-python/            # Python client
└── examples/                     # Working examples
```

---

## Status

**Version 0.2.0** — Stable dual-layer implementation with full SDK parity (TypeScript + Python).

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines and [docs/rfc-process.md](docs/rfc-process.md) for the RFC process.

## License

- **Specification**: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Code**: [MIT](LICENSE)
