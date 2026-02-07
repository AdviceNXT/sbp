# SBP Quick Reference

## Core Concepts

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BLACKBOARD                                  │
│                                                                     │
│   Trail: market.signals                 Trail: market.orders        │
│   ┌─────────────────────────┐          ┌─────────────────────────┐ │
│   │ ◉ volatility (0.8)      │          │ ◉ large_order (0.6)     │ │
│   │ ○ momentum (0.2)        │ decay    │ ◉ large_order (0.7)     │ │
│   │ · trend (0.05)          │ ────→    │ ○ fill (0.3)            │ │
│   └─────────────────────────┘          └─────────────────────────┘ │
│                                                                     │
│   ◉ Strong signal   ○ Weak signal   · Evaporating                  │
└─────────────────────────────────────────────────────────────────────┘
                │                              │
                └──────────────┬───────────────┘
                               ▼
                    ┌─────────────────────┐
                    │  SCENT EVALUATOR    │
                    │                     │
                    │  IF volatility ≥0.7 │
                    │  AND orders ≥ 2     │
                    │  THEN trigger       │
                    └──────────┬──────────┘
                               │
                               ▼ TRIGGER
                    ┌─────────────────────┐
                    │   DORMANT AGENT     │
                    │                     │
                    │  → Wake            │
                    │  → Process          │
                    │  → Emit             │
                    │  → Sleep           │
                    └─────────────────────┘
```

## Five Core Operations

| Operation | Direction | Purpose |
|-----------|-----------|---------|
| `EMIT` | Agent → Blackboard | Deposit or reinforce a pheromone |
| `SNIFF` | Agent → Blackboard | Read current environmental state |
| `REGISTER_SCENT` | Agent → Blackboard | Declare trigger condition |
| `TRIGGER` | Blackboard → Agent | Activate dormant agent |
| `DEREGISTER_SCENT` | Agent → Blackboard | Remove trigger condition |

## Pheromone Anatomy

```json
{
  "id": "uuid-v7",
  "trail": "market.signals",
  "type": "volatility",
  "initial_intensity": 0.8,
  "current_intensity": 0.65,
  "decay": { "type": "exponential", "half_life_ms": 300000 },
  "payload": { "symbol": "BTC", "value": 45.2 },
  "emitted_at": 1707350400000,
  "last_reinforced_at": 1707350400000
}
```

## Decay Models

**Exponential** (default): `I(t) = I₀ × 0.5^(t/half_life)`
```json
{ "type": "exponential", "half_life_ms": 300000 }
```

**Linear**: `I(t) = max(0, I₀ - rate × t)`
```json
{ "type": "linear", "rate_per_ms": 0.0001 }
```

**Step**: Discrete intensity levels at time offsets
```json
{ "type": "step", "steps": [
  { "at_ms": 60000, "intensity": 0.5 },
  { "at_ms": 120000, "intensity": 0.1 }
]}
```

**Immortal**: Never decays (use sparingly)
```json
{ "type": "immortal" }
```

## Scent Conditions

**Threshold** - Basic comparison:
```json
{
  "type": "threshold",
  "trail": "market.signals",
  "signal_type": "volatility",
  "aggregation": "max",
  "operator": ">=",
  "value": 0.7
}
```

**Composite** - Boolean logic:
```json
{
  "type": "composite",
  "operator": "and",
  "conditions": [
    { "type": "threshold", "trail": "a", "signal_type": "x", "aggregation": "max", "operator": ">=", "value": 0.5 },
    { "type": "threshold", "trail": "b", "signal_type": "y", "aggregation": "count", "operator": ">=", "value": 3 }
  ]
}
```

**Rate** - Change detection:
```json
{
  "type": "rate",
  "trail": "market.signals",
  "signal_type": "volatility",
  "metric": "emissions_per_second",
  "window_ms": 10000,
  "operator": ">=",
  "value": 5
}
```

## Aggregation Functions

| Function | Returns |
|----------|---------|
| `sum` | Total intensity of all matching pheromones |
| `max` | Highest intensity among matches |
| `avg` | Mean intensity among matches |
| `count` | Number of matching pheromones |
| `any` | Boolean: true if any match exists |

## Merge Strategies (EMIT)

| Strategy | Behavior |
|----------|----------|
| `reinforce` | Boost intensity, reset decay timer |
| `replace` | Overwrite entirely |
| `max` | Keep higher intensity |
| `add` | Sum intensities (capped at 1.0) |
| `new` | Always create new pheromone |

## Recommended Half-Lives

| Use Case | Half-Life |
|----------|-----------|
| Real-time signals | 30 seconds |
| Session context | 5 minutes |
| Task coordination | 30 minutes |
| Historical markers | 4+ hours |

## Common Patterns

### Fire-and-Forget Signal
```python
await bb.emit("events", "user_action", 0.5, payload={"action": "click"})
```

### Reinforcing Loop
```python
while monitoring:
    await bb.emit("health", "alive", 1.0, merge="reinforce")
    await sleep(10)  # Reinforce every 10s
```

### Quorum Detection
```python
# Each worker emits on completion
await bb.emit("tasks", "done", 1.0, payload={"worker": worker_id})

# Aggregator scent: count(tasks/done) >= 5
# Triggers when 5 workers complete
```

### Inhibition
```python
# Emit high-intensity "pause" signal
await bb.emit("control", "pause", 1.0)

# Other agents' scent includes: NOT(control/pause >= 0.5)
# They won't trigger while pause signal is strong
```

## Wire Protocol Summary

**Transport: Streamable HTTP with SSE** (same as MCP)

```
POST /sbp  →  Client sends JSON-RPC requests
GET /sbp   →  Client opens SSE stream for triggers
```

**Client → Server (POST):**
```json
{"jsonrpc": "2.0", "id": "1", "method": "sbp/emit", "params": {...}}
```

**Server → Client (SSE):**
```
event: message
id: 42
data: {"jsonrpc": "2.0", "method": "sbp/trigger", "params": {...}}
```

**Required Headers:**
```
Sbp-Protocol-Version: 0.1
Sbp-Session-Id: <session-id>
Accept: application/json, text/event-stream
```

## Error Codes

| Code | Meaning |
|------|---------|
| -32001 | Trail not found |
| -32002 | Scent not found |
| -32003 | Payload validation failed |
| -32004 | Rate limited |
| -32005 | Unauthorized |

## Comparison with MCP

| MCP | SBP |
|-----|-----|
| Tool calling | Pheromone emission |
| Direct invocation | Threshold triggering |
| Request-response | Fire-and-forget + sense |
| Explicit routing | Environmental routing |
| Stateful sessions | Stateless agents |
