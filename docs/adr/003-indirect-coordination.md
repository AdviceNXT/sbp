# ADR-003: Indirect Coordination (Stigmergy) over Direct Messaging

## Status

Accepted

## Context

Multi-agent systems need coordination. Three paradigms exist:

1. **Orchestration:** A central controller directs agents (e.g., LangChain chains)
2. **Direct messaging:** Agents send messages to each other (e.g., Actor model, A2A)
3. **Stigmergy:** Agents coordinate indirectly through a shared environment

## Decision

SBP uses **stigmergic coordination** — agents interact exclusively through the Blackboard environment, never directly with each other.

## Rationale

1. **Decoupling.** Agents don't know each other exist. Agent A emits a "high-volatility" pheromone. Agent B detects it via a registered scent. Neither knows about the other. This means agents can be added, removed, or replaced without changing any other agent.

2. **No single point of failure.** In orchestrated systems, the orchestrator dying kills the entire workflow. In SBP, if one agent dies, its pheromones naturally decay and other agents adapt. The environment self-heals.

3. **Emergent behavior.** Complex coordination patterns emerge from simple rules. Three agents each emitting "risk-detected" pheromones with different contexts create a natural quorum signal — no voting protocol needed. The Blackboard's aggregate functions (`sum`, `count`, `max`) provide the coordination primitives.

4. **Temporal intelligence.** Direct messages are instant and binary — received or not. Pheromones carry temporal information through decay. An agent can sense not just *what* happened, but *how recently* and *how strongly* the signal still exists. This is closer to how biological systems coordinate.

5. **Natural load balancing.** When multiple agents register the same scent, the first to process a trigger naturally "consumes" the signal (by emitting a competing pheromone). No job queue, no lock, no distributed consensus needed.

## Consequences

- Higher latency than direct messaging (evaluation loop interval)
- Debugging is harder — no message trace, only environment snapshots
- Not suitable for request/response patterns (use MCP for that)
- Requires developers to think in environmental terms rather than control flow
- The Blackboard becomes a critical infrastructure component
