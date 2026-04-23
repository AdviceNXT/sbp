# ADR-004: Durable Trace Layer

## Status

Accepted

## Date

2026-04-23

## Context

SBP's original design is purely ephemeral — all signals decay to zero over time. This is fundamental to the stigmergic model: the environment is self-cleaning, and agents carry no persistent state.

However, multi-agent systems operating at enterprise scale need to coordinate across different timescales:

1. **Real-time coordination** (seconds to minutes) — Handled well by pheromones
2. **Institutional memory** (hours to indefinite) — Configuration, learned knowledge, audit trails, agent-discovered facts

Using `immortal` decay pheromones as a workaround has problems:
- They still participate in garbage collection checks
- They pollute the pheromone namespace with fundamentally different data
- They lack versioning, composite key addressing, or size-appropriate storage

## Decision

Add a **Trace** layer alongside the existing Pheromone layer. The two layers share the `trail` namespace but have distinct characteristics:

| Property | Pheromones | Traces |
|----------|-----------|--------|
| **Lifetime** | Ephemeral (decays) | Permanent (until erased) |
| **Identity** | UUID | trail + key composite |
| **Value** | Intensity 0.0–1.0 | Arbitrary JSON (max 1 MB) |
| **Operations** | emit / sniff / evaporate | inscribe / read / erase |
| **GC** | Yes (evaporated pheromones collected) | No |
| **Versioning** | No | Auto-incrementing |

Key design choices:

- **Shared trail namespace**: Traces and pheromones coexist in the same trail hierarchy, enabling cross-layer scent conditions (e.g., "trigger when volatility pheromone is high AND risk-config trace exists")
- **Pluggable storage**: `TraceStore` interface with `MemoryTraceStore` as default, same pattern as `PheromoneStore`
- **Separate auth**: `traceWriteKeys` permits granular write control — most agents can read traces but only privileged agents can write
- **1 MB value limit**: Traces can carry markdown documents and rich knowledge, but are bounded to prevent memory exhaustion

## Consequences

### Positive
- Clean separation of concerns: ephemeral signals vs. durable knowledge
- Cross-layer scent conditions enable sophisticated coordination patterns
- Pluggable `TraceStore` interface supports future SQLite/filesystem backends
- Backward compatible: existing pheromone-only systems work unchanged

### Negative
- Increased API surface area (3 new operations, 1 new condition type)
- Memory footprint grows if traces accumulate without erasure
- Two "types of storage" may confuse new users

### Mitigations
- Clear documentation distinguishing the two layers
- `inspect()` reports `total_traces` alongside `total_pheromones` for visibility
- `ERASE` with `older_than_ms` provides time-based cleanup for trace hygiene
