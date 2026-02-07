# @sbp/types

Canonical type definitions for the **Stigmergic Blackboard Protocol (SBP)** v0.1.

This package provides the shared type interfaces used across all SBP implementations — server, TypeScript client, and third-party libraries.

## Installation

```bash
npm install @sbp/types
```

## Usage

```typescript
import type {
  Pheromone,
  DecayModel,
  ScentCondition,
  EmitParams,
  SniffResult
} from "@sbp/types";
```

## What's Included

- **Decay Models** — `ExponentialDecay`, `LinearDecay`, `StepDecay`, `ImmortalDecay`
- **Data Types** — `Pheromone`, `PheromoneSnapshot`, `TagFilter`
- **Conditions** — `ThresholdCondition`, `CompositeCondition`, `RateCondition`, `PatternCondition`
- **Operations** — All params/result types for emit, sniff, register, deregister, evaporate, inspect
- **JSON-RPC** — Request, response, and error types
- **Error Codes** — `SBP_ERROR_CODES` constant and `SbpError` class
