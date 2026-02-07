# ADR-001: Pheromone Decay over TTL

## Status

Accepted

## Context

When agents deposit signals on the Blackboard, those signals must eventually expire. Two main approaches exist:

1. **TTL (Time-To-Live):** Signal exists for N seconds, then vanishes instantly
2. **Graduated Decay:** Signal intensity decreases continuously over time

Most coordination systems (Redis, message queues, DNS) use TTL. We needed to decide which approach serves multi-agent coordination better.

## Decision

SBP uses **graduated decay** as the primary expiration mechanism, with 4 decay models:

- **Exponential** (default): `I(t) = I₀ × 0.5^(t/half_life)` — natural signal degradation
- **Linear**: `I(t) = I₀ - rate × t` — predictable countdown
- **Step**: Discrete intensity levels at defined time points
- **Immortal**: Never decays (for configuration-like signals)

## Rationale

1. **Recency weighting is automatic.** A fresh signal at intensity 0.9 naturally outranks a stale signal at 0.3 without any application logic. TTL-based systems require the consumer to check timestamps.

2. **Graceful degradation.** In TTL systems, a signal is "fully confident" at `TTL - 1ms` and "gone" at `TTL`. This cliff creates boundary problems. Decay gives downstream agents a continuously accurate confidence measure.

3. **Reinforcement patterns emerge naturally.** When multiple agents emit the same signal type, `reinforce` merge strategy resets the decay clock. Frequently-reinforced signals stay strong; abandoned signals silently fade. This is exactly how biological pheromones work.

4. **Threshold triggers become meaningful.** A scent condition like "trigger when volatility > 0.7" has richer semantics when 0.7 is a decaying intensity rather than a static flag. The trigger fires urgently for fresh signals and defers for stale ones.

## Consequences

- Slightly more CPU usage than TTL (intensity must be computed on every sniff)
- The `computeIntensity()` function becomes a hot path
- Time synchronization across distributed nodes is more important
- Developers must think in terms of half-lives rather than timeouts
