# Stigmergic Blackboard Protocol (SBP)

**Version:** 0.1.0-draft
**Status:** Draft Specification
**Date:** 2026-02-07

---

## Abstract

The Stigmergic Blackboard Protocol (SBP) defines a standard for environment-based coordination between autonomous agents. Instead of direct agent-to-agent messaging, agents interact through a shared digital environment by depositing and sensing **Digital Pheromones**—data signals with intensity and natural decay.

SBP enables decoupled, self-organizing multi-agent systems where coordination emerges from environmental state rather than explicit orchestration.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Design Principles](#2-design-principles)
3. [Terminology](#3-terminology)
4. [Data Model](#4-data-model)
5. [Protocol Operations](#5-protocol-operations)
6. [Decay Mechanics](#6-decay-mechanics)
7. [Threshold Triggers](#7-threshold-triggers)
8. [Agent Lifecycle](#8-agent-lifecycle)
9. [Wire Protocol](#9-wire-protocol)
10. [Namespacing](#10-namespacing)
11. [Security Considerations](#11-security-considerations)
12. [Implementation Guidelines](#12-implementation-guidelines)

---

## 1. Introduction

### 1.1 Motivation

Traditional multi-agent architectures rely on one of two patterns:

1. **Orchestration**: A central coordinator dispatches tasks to agents
2. **Choreography**: Agents communicate directly via message passing

Both patterns create coupling—agents must know about each other, handle message routing, and manage conversation state. This coupling increases complexity and reduces resilience.

**Stigmergy** offers an alternative. Derived from the Greek *stigma* (mark) and *ergon* (work), stigmergy describes indirect coordination through environmental modification. Ants coordinate colony behavior not by talking to each other, but by depositing pheromones that other ants sense.

SBP applies this biological pattern to digital agents.

### 1.2 Goals

- **Simplicity**: Minimal primitives, easy to implement
- **Decoupling**: Agents need no knowledge of each other
- **Self-Cleaning**: Stale data evaporates automatically
- **Emergent Coordination**: Complex behavior from simple rules
- **Interoperability**: Language and platform agnostic

### 1.3 Non-Goals

- Real-time streaming (use dedicated streaming protocols)
- Binary data transport (pheromones carry structured metadata only)
- Agent-to-agent direct messaging (use MCP or similar)

---

## 2. Design Principles

### 2.1 Stale-by-Default

All signals decay. If not reinforced, they evaporate to zero intensity. The environment is self-cleaning.

### 2.2 Sense, Don't Poll

Agents do not actively query the environment. They declare interest patterns, and the environment triggers them when conditions are met.

### 2.3 Stateless Agents

Agents are dormant by default. They carry no persistent state between activations. All relevant context is encoded in the environmental signals that triggered them.

### 2.4 Intensity Over Boolean

Signals are not present/absent. They have continuous intensity. This enables nuanced responses: an agent might ignore a weak signal but respond urgently to a strong one.

### 2.5 Composition Through Thresholds

Complex coordination emerges from simple threshold rules combining multiple signal types.

---

## 3. Terminology

| Term | Definition |
|------|------------|
| **Blackboard** | The shared environment where pheromones exist |
| **Pheromone** | A data signal with type, intensity, decay rate, and payload |
| **Intensity** | A non-negative floating-point value representing signal strength |
| **Decay Rate** | The rate at which intensity diminishes per time unit |
| **Half-Life** | Time for a pheromone to decay to 50% intensity (alternative to decay rate) |
| **Trail** | A namespaced category of related pheromones |
| **Scent** | A threshold condition that triggers agent activation |
| **Sniff** | The act of an agent sensing the current environmental state |
| **Emit** | Depositing a new pheromone or reinforcing an existing one |
| **Evaporate** | The natural decay of pheromone intensity over time |

---

## 4. Data Model

### 4.1 Pheromone Structure

A pheromone is the fundamental unit of data in SBP.

```typescript
interface Pheromone {
  // Identity
  id: string;                    // Unique identifier (UUID v7 recommended)
  trail: string;                 // Namespaced category (e.g., "market.signals")
  type: string;                  // Signal type within trail (e.g., "volatility")

  // Temporal
  emitted_at: number;            // Unix timestamp (milliseconds)
  last_reinforced_at: number;    // Last reinforcement timestamp

  // Intensity & Decay
  initial_intensity: number;     // Starting intensity (0.0 - 1.0 normalized)
  current_intensity: number;     // Computed current intensity after decay
  decay_model: DecayModel;       // How this pheromone decays

  // Content
  payload: object;               // Arbitrary JSON payload
  source_agent: string;          // Emitting agent identifier (optional)

  // Metadata
  tags: string[];                // Optional classification tags
  ttl_floor: number;             // Minimum intensity before considered "evaporated"
}
```

### 4.2 Decay Models

SBP supports multiple decay models to match different signal semantics.

```typescript
type DecayModel =
  | { type: "exponential"; half_life_ms: number }
  | { type: "linear"; rate_per_ms: number }
  | { type: "step"; steps: StepDecay[] }
  | { type: "immortal" }  // Never decays (use sparingly)

interface StepDecay {
  at_ms: number;        // Time offset from emission
  intensity: number;    // Intensity at this step
}
```

**Exponential Decay** (Recommended Default):
```
intensity(t) = initial_intensity * (0.5 ^ (t / half_life))
```

**Linear Decay**:
```
intensity(t) = max(0, initial_intensity - (rate * t))
```

### 4.3 Computed Intensity

Current intensity is always computed, never stored. This ensures:
- No background update processes needed
- Consistent reads regardless of when computed
- Trivial horizontal scaling

```typescript
function computeIntensity(pheromone: Pheromone, now: number): number {
  const elapsed = now - pheromone.last_reinforced_at;

  switch (pheromone.decay_model.type) {
    case "exponential":
      const halfLife = pheromone.decay_model.half_life_ms;
      return pheromone.initial_intensity * Math.pow(0.5, elapsed / halfLife);

    case "linear":
      const rate = pheromone.decay_model.rate_per_ms;
      return Math.max(0, pheromone.initial_intensity - (rate * elapsed));

    case "step":
      const steps = pheromone.decay_model.steps;
      for (let i = steps.length - 1; i >= 0; i--) {
        if (elapsed >= steps[i].at_ms) return steps[i].intensity;
      }
      return pheromone.initial_intensity;

    case "immortal":
      return pheromone.initial_intensity;
  }
}
```

### 4.4 Trail Structure

Trails organize pheromones into logical namespaces.

```typescript
interface Trail {
  name: string;                  // Fully qualified name (e.g., "market.signals")
  description: string;           // Human-readable description
  default_decay: DecayModel;     // Default decay for pheromones in this trail
  schema: JSONSchema;            // Payload schema for validation (optional)
  retention_policy: RetentionPolicy;
}

interface RetentionPolicy {
  evaporation_threshold: number; // Intensity below which pheromone is garbage collected
  max_pheromones: number;        // Maximum pheromones in trail (oldest evaporated first)
  archive_evaporated: boolean;   // Whether to archive evaporated pheromones
}
```

---

## 5. Protocol Operations

SBP defines a minimal set of operations. All operations are idempotent where possible.

### 5.1 EMIT

Deposit a new pheromone or reinforce an existing one.

**Request:**
```json
{
  "method": "sbp/emit",
  "params": {
    "trail": "market.signals",
    "type": "volatility",
    "intensity": 0.8,
    "decay": { "type": "exponential", "half_life_ms": 300000 },
    "payload": {
      "symbol": "BTC-USD",
      "vix_equivalent": 45.2,
      "source": "volatility-analyzer"
    },
    "tags": ["crypto", "high-priority"],
    "merge_strategy": "reinforce"
  }
}
```

**Merge Strategies:**
- `"reinforce"`: If matching pheromone exists, boost intensity and reset decay timer
- `"replace"`: Replace existing pheromone entirely
- `"max"`: Take maximum of existing and new intensity
- `"add"`: Add intensities (capped at 1.0)
- `"new"`: Always create new pheromone (no merging)

**Matching for Merge:**
Pheromones match if `trail + type + payload_hash` are identical.

**Response:**
```json
{
  "result": {
    "pheromone_id": "01945abc-def0-7890-abcd-ef1234567890",
    "action": "reinforced",
    "previous_intensity": 0.3,
    "new_intensity": 0.8
  }
}
```

### 5.2 SNIFF

Sense the current environmental state. Unlike polling, SNIFF is a one-time read of matching signals.

**Request:**
```json
{
  "method": "sbp/sniff",
  "params": {
    "trails": ["market.signals", "market.orders"],
    "types": ["volatility", "large_order"],
    "min_intensity": 0.1,
    "tags": { "any": ["crypto"] },
    "limit": 100,
    "include_evaporated": false
  }
}
```

**Response:**
```json
{
  "result": {
    "timestamp": 1707350400000,
    "pheromones": [
      {
        "id": "01945abc-def0-7890-abcd-ef1234567890",
        "trail": "market.signals",
        "type": "volatility",
        "current_intensity": 0.65,
        "payload": { "symbol": "BTC-USD", "vix_equivalent": 45.2 },
        "age_ms": 120000
      }
    ],
    "aggregates": {
      "market.signals/volatility": {
        "count": 3,
        "sum_intensity": 1.45,
        "max_intensity": 0.65,
        "avg_intensity": 0.48
      }
    }
  }
}
```

### 5.3 REGISTER_SCENT

Declare a threshold condition that triggers agent activation. This is how agents "subscribe" without polling.

**Request:**
```json
{
  "method": "sbp/register_scent",
  "params": {
    "scent_id": "volatility-crisis-detector",
    "agent_endpoint": "https://agents.example.com/crisis-handler",
    "condition": {
      "type": "composite",
      "operator": "and",
      "conditions": [
        {
          "type": "threshold",
          "trail": "market.signals",
          "signal_type": "volatility",
          "aggregation": "max",
          "operator": ">=",
          "value": 0.7
        },
        {
          "type": "threshold",
          "trail": "market.orders",
          "signal_type": "large_order",
          "aggregation": "count",
          "operator": ">=",
          "value": 5
        }
      ]
    },
    "cooldown_ms": 60000,
    "activation_payload": {
      "urgency": "high",
      "context_trails": ["market.signals", "market.orders"]
    }
  }
}
```

**Condition Types:**

```typescript
type ScentCondition =
  | ThresholdCondition
  | CompositeCondition
  | RateCondition
  | PatternCondition

interface ThresholdCondition {
  type: "threshold";
  trail: string;
  signal_type: string;            // "*" for any type in trail
  tags?: TagFilter;
  aggregation: "sum" | "max" | "avg" | "count" | "any";
  operator: ">=" | ">" | "<=" | "<" | "==" | "!=";
  value: number;
}

interface CompositeCondition {
  type: "composite";
  operator: "and" | "or" | "not";
  conditions: ScentCondition[];
}

interface RateCondition {
  type: "rate";
  trail: string;
  signal_type: string;
  metric: "emissions_per_second" | "intensity_delta";
  window_ms: number;
  operator: ">=" | ">" | "<=" | "<";
  value: number;
}

interface PatternCondition {
  type: "pattern";
  sequence: SequenceStep[];
  within_ms: number;
}
```

**Response:**
```json
{
  "result": {
    "scent_id": "volatility-crisis-detector",
    "status": "registered",
    "current_condition_state": {
      "met": false,
      "partial": {
        "market.signals/volatility >= 0.7": false,
        "market.orders/large_order count >= 5": true
      }
    }
  }
}
```

### 5.4 TRIGGER (Environment → Agent)

When a scent condition is met, the blackboard sends a trigger to the registered agent.

**Trigger Payload:**
```json
{
  "method": "sbp/trigger",
  "params": {
    "scent_id": "volatility-crisis-detector",
    "triggered_at": 1707350400000,
    "condition_snapshot": {
      "market.signals/volatility": {
        "max": 0.85,
        "triggering_pheromones": ["01945abc-..."]
      },
      "market.orders/large_order": {
        "count": 7,
        "triggering_pheromones": ["01945def-...", "01945ghi-..."]
      }
    },
    "context_pheromones": [
      // Full pheromone objects from context_trails
    ],
    "activation_payload": {
      "urgency": "high"
    }
  }
}
```

### 5.5 DEREGISTER_SCENT

Remove a scent registration.

**Request:**
```json
{
  "method": "sbp/deregister_scent",
  "params": {
    "scent_id": "volatility-crisis-detector"
  }
}
```

### 5.6 EVAPORATE (Administrative)

Force immediate evaporation of pheromones matching criteria. Typically used for cleanup or emergency reset.

**Request:**
```json
{
  "method": "sbp/evaporate",
  "params": {
    "trail": "market.signals",
    "types": ["volatility"],
    "older_than_ms": 3600000,
    "below_intensity": 0.1
  }
}
```

### 5.7 INSPECT

Get metadata about trails, registered scents, and system state.

**Request:**
```json
{
  "method": "sbp/inspect",
  "params": {
    "include": ["trails", "scents", "stats"]
  }
}
```

---

## 6. Decay Mechanics

### 6.1 Time Resolution

All timestamps use Unix milliseconds (UTC). Implementations SHOULD use monotonic clocks where available for elapsed time calculations.

### 6.2 Reinforcement

When a pheromone is reinforced:
1. `last_reinforced_at` updates to current time
2. `initial_intensity` updates to new intensity
3. Decay timer resets

This models biological pheromone behavior where repeated deposits strengthen a trail.

### 6.3 Evaporation Threshold

When `current_intensity` falls below the trail's `evaporation_threshold`, the pheromone is considered evaporated. Evaporated pheromones:
- Are excluded from SNIFF results (unless `include_evaporated: true`)
- Do not contribute to threshold conditions
- MAY be garbage collected or archived per retention policy

### 6.4 Recommended Defaults

| Use Case | Decay Model | Half-Life |
|----------|-------------|-----------|
| Real-time signals | Exponential | 30 seconds |
| Session data | Exponential | 5 minutes |
| Task coordination | Exponential | 30 minutes |
| Context preservation | Exponential | 4 hours |
| Historical markers | Step decay | Custom |

---

## 7. Threshold Triggers

### 7.1 Evaluation

The blackboard continuously evaluates registered scent conditions. Evaluation SHOULD occur:
- On every EMIT that could affect a registered condition
- Periodically (implementation-defined, recommended 100ms minimum)

### 7.2 Cooldown

After triggering, a scent enters cooldown for `cooldown_ms`. During cooldown:
- The scent is not evaluated
- Additional triggers are suppressed

This prevents trigger storms from rapidly fluctuating signals.

### 7.3 Aggregation Functions

| Function | Description |
|----------|-------------|
| `sum` | Sum of intensities of matching pheromones |
| `max` | Maximum intensity among matching pheromones |
| `avg` | Average intensity among matching pheromones |
| `count` | Number of matching pheromones above evaporation threshold |
| `any` | True if any matching pheromone exists (intensity > 0) |

### 7.4 Edge vs Level Triggering

SBP uses **level triggering** by default: triggers fire when conditions become true. Combined with cooldown, this provides predictable behavior.

Optional edge-triggering mode:
```json
{
  "trigger_mode": "edge_rising",  // Trigger only when crossing threshold upward
  "hysteresis": 0.1               // Must fall 0.1 below threshold before re-triggering
}
```

---

## 8. Agent Lifecycle

### 8.1 Dormant by Default

Agents have no persistent running state. They exist as:
- A registered scent (condition + endpoint)
- Handler code waiting for invocation

### 8.2 Activation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        BLACKBOARD                               │
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│  │ Pheromone A │    │ Pheromone B │    │ Pheromone C │        │
│  │ intensity:  │    │ intensity:  │    │ intensity:  │        │
│  │    0.7      │    │    0.5      │    │    0.3      │        │
│  └─────────────┘    └─────────────┘    └─────────────┘        │
│                                                                 │
│  ┌──────────────────────────────────────┐                      │
│  │ Scent Evaluator                      │                      │
│  │                                      │                      │
│  │  "A >= 0.6 AND B >= 0.4" → TRUE     │──────┐               │
│  └──────────────────────────────────────┘      │               │
└────────────────────────────────────────────────│───────────────┘
                                                 │
                                                 ▼ TRIGGER
                                    ┌─────────────────────────┐
                                    │     DORMANT AGENT       │
                                    │                         │
                                    │  1. Receive trigger     │
                                    │  2. Process context     │
                                    │  3. EMIT new signals    │
                                    │  4. Return to dormant   │
                                    └─────────────────────────┘
```

### 8.3 Agent Response

After processing, an agent MAY:
- EMIT new pheromones (continue the stigmergic chain)
- Perform external actions (side effects)
- Return a result (for logging/observability)

Agents SHOULD NOT:
- Maintain state between activations
- Assume previous activation context
- Directly invoke other agents

### 8.4 Activation Timeout

Triggers include `max_execution_ms`. If an agent exceeds this, the blackboard:
- Marks the activation as timed out
- Optionally emits a `system.errors/agent_timeout` pheromone

---

## 9. Wire Protocol

SBP uses **Streamable HTTP** as its primary transport, following the same patterns as MCP (Model Context Protocol). This uses HTTP POST for client-to-server messages and Server-Sent Events (SSE) for server-to-client streaming.

### 9.1 Streamable HTTP Transport

The server provides a single HTTP endpoint (the **SBP endpoint**) that supports both POST and GET methods. For example: `https://example.com/sbp`

#### 9.1.1 Sending Messages to the Server (POST)

All client-to-server messages (EMIT, SNIFF, REGISTER_SCENT, etc.) use HTTP POST:

1. The client **MUST** use HTTP POST to send JSON-RPC messages to the SBP endpoint.
2. The client **MUST** include an `Accept` header listing both `application/json` and `text/event-stream`.
3. The body **MUST** be a single JSON-RPC request or notification.
4. The server **MUST** respond with either:
   - `Content-Type: application/json` for a single JSON response, OR
   - `Content-Type: text/event-stream` to initiate an SSE stream

```
POST /sbp HTTP/1.1
Host: blackboard.example.com
Content-Type: application/json
Accept: application/json, text/event-stream
Sbp-Session-Id: abc123
Sbp-Protocol-Version: 0.1

{
  "jsonrpc": "2.0",
  "id": "req-1",
  "method": "sbp/emit",
  "params": { "trail": "signals", "type": "event", "intensity": 0.8 }
}
```

#### 9.1.2 Listening for Triggers (GET + SSE)

To receive triggers from the blackboard, clients open an SSE stream:

1. The client **MUST** issue an HTTP GET to the SBP endpoint.
2. The client **MUST** include `Accept: text/event-stream` header.
3. The server **MUST** respond with `Content-Type: text/event-stream`.
4. The server sends JSON-RPC notifications as SSE events when scent conditions are met.

```
GET /sbp HTTP/1.1
Host: blackboard.example.com
Accept: text/event-stream
Sbp-Session-Id: abc123
Sbp-Protocol-Version: 0.1
```

**SSE Response Stream:**
```
event: message
id: evt-001
data: {"jsonrpc":"2.0","method":"sbp/trigger","params":{"scent_id":"crisis-detector","triggered_at":1707350400000,"context_pheromones":[...]}}

event: message
id: evt-002
data: {"jsonrpc":"2.0","method":"sbp/trigger","params":{"scent_id":"task-ready","triggered_at":1707350500000,"context_pheromones":[...]}}
```

#### 9.1.3 SSE Event Format

Each SSE event contains:
- `event`: Always `"message"` for JSON-RPC messages
- `id`: Unique event ID for resumability (optional but recommended)
- `data`: JSON-RPC notification or request

#### 9.1.4 Resumability

To support reconnection after network interruption:

1. Servers **SHOULD** attach an `id` field to SSE events.
2. Clients **MAY** include `Last-Event-ID` header when reconnecting.
3. Servers **MAY** replay missed events based on the last event ID.

### 9.2 Session Management

1. The server **MAY** assign a session ID during the first request by including `Sbp-Session-Id` in the response header.
2. Clients **MUST** include `Sbp-Session-Id` in all subsequent requests.
3. The server **MAY** return HTTP 404 to indicate an expired session.

### 9.3 Message Format

SBP uses JSON-RPC 2.0 as its message envelope.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "method": "sbp/emit",
  "params": { ... }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "result": { ... }
}
```

**Error:**
```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "error": {
    "code": -32001,
    "message": "Trail not found",
    "data": { "trail": "unknown.trail" }
  }
}
```

**Notification (no response expected):**
```json
{
  "jsonrpc": "2.0",
  "method": "sbp/trigger",
  "params": { ... }
}
```

### 9.4 Protocol Flow

```
Agent                                    Blackboard
  │                                           │
  │──── POST /sbp (register_scent) ──────────▶│
  │◀─── 200 OK (JSON response) ───────────────│
  │                                           │
  │──── GET /sbp (open SSE stream) ──────────▶│
  │◀════ SSE: connection opened ══════════════│
  │                                           │
  │──── POST /sbp (emit) ────────────────────▶│  (from another agent)
  │                                           │
  │◀──── SSE: trigger event ──────────────────│  (condition met!)
  │◀──── SSE: trigger event ──────────────────│
  │                                           │
  │──── POST /sbp (emit response) ───────────▶│
  │                                           │
```

### 9.5 Error Codes

| Code | Message | Description |
|------|---------|-------------|
| -32700 | Parse error | Invalid JSON |
| -32600 | Invalid request | Not valid JSON-RPC |
| -32601 | Method not found | Unknown SBP method |
| -32602 | Invalid params | Parameter validation failed |
| -32001 | Trail not found | Referenced trail doesn't exist |
| -32002 | Scent not found | Referenced scent doesn't exist |
| -32003 | Payload validation failed | Payload doesn't match trail schema |
| -32004 | Rate limited | Too many requests |
| -32005 | Unauthorized | Missing or invalid credentials |

### 9.6 Required Headers

| Header | Direction | Description |
|--------|-----------|-------------|
| `Content-Type` | Both | `application/json` for POST body, `text/event-stream` for SSE |
| `Accept` | Request | `application/json, text/event-stream` |
| `Sbp-Protocol-Version` | Request | Protocol version (e.g., `0.1`) |
| `Sbp-Session-Id` | Both | Session identifier (after initial request) |
| `Sbp-Agent-Id` | Request | Agent identifier (optional) |
| `Last-Event-ID` | Request | Last received SSE event ID (for resumability) |

### 9.7 Alternative Transports

While Streamable HTTP is the standard transport, implementations MAY also support:

- **stdio**: For subprocess-based communication (like MCP)
- **Unix Domain Socket**: For local same-machine communication

Custom transports MUST preserve JSON-RPC message format and protocol semantics

---

## 10. Namespacing

### 10.1 Trail Names

Trail names follow reverse-domain notation:
```
<domain>.<category>[.<subcategory>...]

Examples:
  market.signals
  market.orders.large
  system.health
  trading.strategy.momentum
```

### 10.2 Reserved Namespaces

| Prefix | Purpose |
|--------|---------|
| `system.*` | Blackboard internals (health, errors, metrics) |
| `sbp.*` | Protocol-level signals |
| `_*` | Implementation-specific internals |

### 10.3 Signal Types

Within a trail, signal types are simple identifiers:
```
volatility
large_order
heartbeat
error
```

Full signal address: `trail/type` (e.g., `market.signals/volatility`)

---

## 11. Security Considerations

### 11.1 Authentication

Implementations MUST support:
- API keys for agent identification
- Mutual TLS for transport security

Implementations SHOULD support:
- JWT tokens with scoped permissions
- OAuth 2.0 client credentials flow

### 11.2 Authorization

Fine-grained permissions on:
- Trails (read/write per trail)
- Operations (emit/sniff/register)
- Intensity limits (prevent signal flooding)

Example permission structure:
```json
{
  "agent_id": "market-analyzer",
  "permissions": [
    { "trail": "market.*", "operations": ["emit", "sniff"] },
    { "trail": "system.*", "operations": ["sniff"] }
  ],
  "rate_limits": {
    "emit_per_second": 100,
    "max_intensity_per_emit": 1.0
  }
}
```

### 11.3 Payload Security

- Payloads MUST NOT contain secrets
- Sensitive data should be references (IDs) not values
- Implementations MAY encrypt payloads at rest

### 11.4 Denial of Service

Protections against:
- Signal flooding (rate limits)
- Intensity bombing (max intensity caps)
- Scent explosion (max registrations per agent)
- Evaluation storms (minimum evaluation interval)

---

## 12. Implementation Guidelines

### 12.1 Minimum Viable Implementation

A conformant SBP implementation MUST support:
- EMIT with exponential decay
- SNIFF with intensity filtering
- REGISTER_SCENT with threshold conditions
- TRIGGER delivery

### 12.2 Recommended Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      SBP Server                             │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  Pheromone  │  │   Scent     │  │    Trigger          │ │
│  │   Store     │  │  Evaluator  │  │   Dispatcher        │ │
│  │             │  │             │  │                     │ │
│  │ - In-memory │  │ - Condition │  │ - Webhook delivery  │ │
│  │ - Redis     │  │   matching  │  │ - WebSocket push    │ │
│  │ - SQLite    │  │ - Rate      │  │ - Retry logic       │ │
│  │             │  │   tracking  │  │ - Cooldown mgmt     │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                   Protocol Handler                      ││
│  │            (HTTP/2, WebSocket, Unix Socket)             ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### 12.3 Storage Considerations

**In-Memory** (recommended for most cases):
- Fastest intensity computation
- Natural garbage collection of evaporated pheromones
- Lost on restart (acceptable for ephemeral signals)

**Persistent** (for audit/replay):
- Store emission events, not current state
- Rebuild state by replaying with decay computation
- Enables time-travel debugging

### 12.4 Scaling

**Horizontal Scaling:**
- Partition by trail
- Scent evaluation is trail-local
- Cross-trail conditions require coordination

**Clock Synchronization:**
- Use logical clocks for ordering
- Physical time only for decay computation
- NTP synchronization between nodes

### 12.5 Observability

Implementations SHOULD emit to `system.metrics`:
- `blackboard_active_pheromones` (gauge)
- `blackboard_emit_rate` (counter)
- `blackboard_trigger_rate` (counter)
- `blackboard_evaluation_latency` (histogram)

---

## Appendix A: Example Scenarios

### A.1 Market Volatility Response

```python
# Market Analyzer Agent emits volatility signal
await blackboard.emit(
    trail="market.signals",
    type="volatility",
    intensity=0.8,
    decay={"type": "exponential", "half_life_ms": 300000},
    payload={"symbol": "BTC-USD", "vix": 45.2}
)

# Order Monitor Agent emits large order signals
await blackboard.emit(
    trail="market.orders",
    type="large_order",
    intensity=0.6,
    payload={"symbol": "BTC-USD", "size": 1000000, "side": "sell"}
)

# Crisis Handler Agent has registered scent:
# "volatility >= 0.7 AND large_order count >= 3"
# → Automatically triggered when conditions met
```

### A.2 Task Coordination

```python
# Worker agent completes subtask, emits completion signal
await blackboard.emit(
    trail="pipeline.stage1",
    type="completed",
    intensity=1.0,
    decay={"type": "exponential", "half_life_ms": 600000},
    payload={"batch_id": "batch-123", "records": 1000}
)

# Aggregator agent's scent: "stage1/completed count >= 5"
# → Triggered when enough workers complete
# → Reads all completion pheromones for full context
# → Emits stage2 trigger
```

### A.3 Self-Healing System

```python
# Health monitor emits degraded service signal
await blackboard.emit(
    trail="system.health",
    type="degraded",
    intensity=0.9,
    decay={"type": "exponential", "half_life_ms": 60000},
    payload={"service": "payment-api", "error_rate": 0.15}
)

# If not reinforced, signal decays quickly
# If problem persists, continuous reinforcement maintains intensity

# Remediation agent's scent: "degraded >= 0.5 for 30 seconds"
# → Only triggers for persistent issues
# → Transient blips evaporate harmlessly
```

---

## Appendix B: Comparison with Alternatives

| Aspect | SBP | Message Queue | Pub/Sub | Blackboard (Traditional) |
|--------|-----|---------------|---------|--------------------------|
| Coupling | None | Producer→Queue | Topic-based | Shared memory |
| State | Environmental | Message | Event | Explicit |
| Decay | Native | TTL only | None | Manual |
| Triggering | Threshold | Message arrival | Subscription | Polling |
| Agents | Stateless | Stateful | Stateful | Stateful |

---

## Appendix C: JSON Schema

Complete JSON schemas for all message types are available at:
`https://sbp.spec/schemas/v0.1/`

---

## Acknowledgments

This specification draws inspiration from:
- Biological stigmergy research
- Blackboard architectures in AI (Erman et al.)
- Model Context Protocol (Anthropic)
- Actor model (Hewitt)
- Tuple spaces (Gelernter)

---

## Changelog

### 0.1.0-draft (2026-02-07)
- Initial draft specification
