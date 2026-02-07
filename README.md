# Stigmergic Blackboard Protocol (SBP)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Spec Version](https://img.shields.io/badge/spec-v0.1.0-green.svg)](SPECIFICATION.md)
[![CI](https://github.com/advicenxt/sbp/actions/workflows/ci.yml/badge.svg)](https://github.com/advicenxt/sbp/actions/workflows/ci.yml)

**A coordination protocol for AI agents that work together without talking to each other.**

---

## The Problem

You have multiple AI agents. They need to coordinate. Today, you wire them together with orchestrators, message queues, or direct calls — and every new agent means more glue code, more failure modes, and tighter coupling.

What if agents could coordinate the way ants do?

Ants don't hold meetings. They don't send messages to specific ants. They leave **pheromone trails** in the environment, and other ants sense those trails and react. No coordinator. No routing. No address book. The colony self-organizes.

**SBP brings this pattern to software.** Agents deposit digital pheromones — signals with intensity that decay over time. Other agents sense the environment and respond when conditions are met. Coordination emerges from the environment, not from explicit wiring.

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

**They're complementary.** Use MCP for tool invocation. Use SBP for multi-agent coordination.

### Use Cases Where SBP + MCP Shine Together

#### 1. Autonomous Research Teams
An MCP-powered research agent uses tools to search the web and summarize papers. When it finds something important, it **emits a pheromone** to the shared blackboard. A synthesis agent, sensing a critical mass of research signals, wakes up and uses its own MCP tools to compile a report. A review agent senses the report signal and begins fact-checking. No orchestrator scheduled any of this — the environment triggered it.

#### 2. Self-Healing Infrastructure
Monitoring agents use MCP tools to check service health. When they detect degradation, they emit pheromones. If the signal persists (multiple agents reinforcing the same pheromone), a remediation agent is triggered to restart containers, scale resources, or reroute traffic — all via MCP tool calls. Transient blips evaporate harmlessly because pheromones decay.

#### 3. Financial Signal Processing
A volatility-detection agent uses MCP tools to pull market data. It emits pheromones proportional to detected volatility. An order-monitoring agent does the same for large trades. A crisis handler has registered a **composite condition**: "volatility ≥ 0.7 AND large orders ≥ 3." When both signals cross that threshold simultaneously, the handler wakes up and uses MCP tools to adjust portfolios. The environment did the correlation — no agent needed to know about the others.

#### 4. Content Moderation Pipeline
A classifier agent uses MCP tools to analyze incoming content. It emits pheromones for each issue found (toxicity, spam, copyright). Different severity levels map to different intensities. A human-review agent is triggered only when multiple issue types converge on the same content. A ban agent requires sustained high-intensity signals before acting. Stale signals (one-off false positives) decay away.

#### 5. Multi-Agent Task Coordination
Worker agents pull tasks via MCP tools and emit completion pheromones. An aggregator agent senses "5 or more stage-1 completions" and begins stage 2. A QA agent senses stage-2 completion and begins validation. The pipeline self-assembles from threshold conditions — add more workers and it scales automatically.

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                         BLACKBOARD                               │
│                                                                   │
│   Pheromones decay over time:      ◉ → ○ → · → (evaporated)     │
│                                                                   │
│   Agents EMIT signals       ─────────────────┐                   │
│   Agents SNIFF state        ◄────────────────┤                   │
│   Conditions TRIGGER agents ─────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

**Three operations are all you need:**

| Operation | What it does |
|-----------|-------------|
| **Emit** | Deposit a pheromone (signal + intensity + decay rate + payload) |
| **Sniff** | Read the current environmental state |
| **Register Scent** | Declare "wake me up when these conditions are true" |

**Key concepts:**

- **Pheromones** have intensity (0.0–1.0) that decays over time. Strong signals demand attention; weak ones are background noise.
- **Trails** are namespaces (e.g., `market.signals`, `pipeline.stage1`) that organize pheromones.
- **Scent conditions** are threshold rules. An agent says "trigger me when the max volatility signal ≥ 0.7" and then goes dormant until the environment wakes it.
- **Merge strategies** control what happens when you emit a pheromone that already exists — reinforce it, replace it, take the max, or add intensities.

---

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
    # Emit a signal
    client.emit("signals", "event", 0.8, payload={"source": "sensor-1"})

    # Sense the environment
    result = client.sniff(trails=["signals"])
    for p in result.pheromones:
        print(f"{p.trail}/{p.type}: {p.current_intensity:.2f}")
```

### Build a Reactive Agent

```python
from sbp import SbpAgent, run_agent

agent = SbpAgent("my-agent")

@agent.when("tasks", "new_task", operator=">=", value=0.5)
async def handle_task(trigger):
    print(f"Task received: {trigger.context_pheromones}")
    await agent.emit("tasks", "completed", 1.0)

run_agent(agent)
```

### Local Mode (No Server)

```python
from sbp import SbpClient

with SbpClient(local=True) as client:
    client.emit("local.test", "signal", 0.9)
```

---

## Design Principles

1. **Stale-by-Default** — All signals decay. Unreinforced data evaporates automatically.
2. **Sense, Don't Poll** — Agents declare interest patterns; the environment triggers them.
3. **Stateless Agents** — Agents are dormant by default. No persistent state between activations.
4. **Intensity Over Boolean** — Signals have continuous strength, enabling nuanced responses.

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
| [schemas/sbp-v0.1.schema.json](./schemas/sbp-v0.1.schema.json) | JSON Schema for validation |
| [CHANGELOG.md](./CHANGELOG.md) | Version history |
| [docs/rfc-process.md](./docs/rfc-process.md) | Governance and RFC process |

---

## Development

```bash
# Install all dependencies
npm install

# Run the server
npm run dev

# Run tests (77 tests across 3 suites)
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
├── CHANGELOG.md                  # Version history
├── schemas/
│   ├── openapi.yaml              # OpenAPI 3.1 spec
│   └── sbp-v0.1.schema.json     # JSON Schema
├── docs/
│   ├── adrs/                     # Architecture Decision Records
│   └── rfc-process.md            # Governance
├── rfcs/                         # RFC proposals
├── packages/
│   ├── server/                   # TypeScript server
│   │   ├── src/                  # Core implementation
│   │   └── benchmarks/           # Performance benchmarks
│   ├── types/                    # Shared @advicenxt/sbp-types
│   ├── client-ts/                # TypeScript client
│   └── client-python/            # Python client
└── examples/                     # Working examples
```

---

## Status

**Version 0.1.0-draft** — Working implementation, spec under active refinement.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines and [docs/rfc-process.md](docs/rfc-process.md) for the RFC process.

## License

- **Specification**: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Code**: [MIT](LICENSE)
