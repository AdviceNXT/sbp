# SBP Quick Reference

## Core Concepts

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BLACKBOARD                                  │
│                                                                     │
│  🔥 PHEROMONE LAYER (Ephemeral)                                     │
│   Trail: market.signals                 Trail: market.orders        │
│   ┌─────────────────────────┐          ┌─────────────────────────┐ │
│   │ ◉ volatility (0.8)      │          │ ◉ large_order (0.6)     │ │
│   │ ○ momentum (0.2)        │ decay    │ ◉ large_order (0.7)     │ │
│   │ · trend (0.05)          │ ────→    │ ○ fill (0.3)            │ │
│   └─────────────────────────┘          └─────────────────────────┘ │
│                                                                     │
│  🪨 TRACE LAYER (Durable)                                           │
│   Trail: config                         Trail: knowledge            │
│   ┌─────────────────────────┐          ┌─────────────────────────┐ │
│   │ ■ risk-tolerance v2     │          │ ■ client-profile v1     │ │
│   │ ■ mode v1               │ persist  │ ■ market-thesis v3      │ │
│   └─────────────────────────┘          └─────────────────────────┘ │
│                                                                     │
│   ◉ Strong signal   ○ Weak signal   · Evaporating   ■ Trace        │
└─────────────────────────────────────────────────────────────────────┘
                │                              │
                └──────────────┬───────────────┘
                               ▼
                    ┌─────────────────────┐
                    │  SCENT EVALUATOR    │
                    │                     │
                    │  IF volatility ≥0.7 │
                    │  AND risk-config    │
                    │    EXISTS           │
                    │  THEN trigger       │
                    └──────────┬──────────┘
                               │
                               ▼ TRIGGER
                    ┌─────────────────────┐
                    │   DORMANT AGENT     │
                    │                     │
                    │  → Wake            │
                    │  → Process          │
                    │  → Emit / Inscribe  │
                    │  → Sleep           │
                    └─────────────────────┘
```

## Eight Core Operations

| Operation | Direction | Layer | Purpose |
|-----------|-----------|-------|---------|
| `EMIT` | Agent → Blackboard | Pheromone | Deposit or reinforce a pheromone |
| `SNIFF` | Agent → Blackboard | Pheromone | Read current environmental state |
| `REGISTER_SCENT` | Agent → Blackboard | Both | Declare trigger condition |
| `TRIGGER` | Blackboard → Agent | Both | Activate dormant agent |
| `DEREGISTER_SCENT` | Agent → Blackboard | Both | Remove trigger condition |
| `INSCRIBE` | Agent → Blackboard | Trace | Create or update a durable trace |
| `READ` | Agent → Blackboard | Trace | Read traces matching criteria |
| `ERASE` | Agent → Blackboard | Trace | Remove traces |

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

## Trace Anatomy

```json
{
  "id": "t-abc123",
  "trail": "config",
  "key": "risk-tolerance",
  "value": { "level": "moderate", "max_drawdown": 0.15 },
  "created_at": 1707350300000,
  "updated_at": 1707350400000,
  "version": 2,
  "source_agent": "config-manager",
  "tags": ["settings"]
}
```

**Key difference from pheromones:** No decay model, no intensity. Traces persist until explicitly erased.

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

**Trace** - Durable knowledge state:
```json
{
  "type": "trace",
  "trail": "config",
  "key": "risk-tolerance",
  "operator": "exists"
}
```

Trace operators: `exists`, `not_exists`, `value_eq`, `value_neq`. Use `"key": "*"` for wildcard.

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
| Permanent knowledge | **Use Traces instead** |

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

### Institutional Memory
```python
# Store durable knowledge
await bb.inscribe("config", "risk-tolerance", {"level": "moderate"})

# Read it back anytime
traces = await bb.read(trails=["config"])
```

### Cross-Layer Trigger
```python
# Trigger when volatility is high AND risk config exists
agent.on_scent("risk-alert",
    condition=and_(
        threshold("market", "volatility", ">=", 0.7),
        trace_exists("config", "risk-tolerance"),
    ),
)
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
| -32007 | Trace not found |
| -32008 | Trace value exceeds maximum size |

## Comparison with MCP

| MCP | SBP |
|-----|-----|
| Tool calling | Pheromone emission |
| Direct invocation | Threshold triggering |
| Request-response | Fire-and-forget + sense |
| Explicit routing | Environmental routing |
| Stateful sessions | Stateless agents |
| Persistent memory | Traces (durable) + Pheromones (ephemeral) |

