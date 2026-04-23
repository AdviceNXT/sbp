/**
 * Scent condition evaluation
 */

import type {
  Pheromone,
  PheromoneSnapshot,
  ScentCondition,
  ThresholdCondition,
  CompositeCondition,
  RateCondition,
  PatternCondition,
  TraceCondition,
  TagFilter,
  Trace,
} from "./types.js";
import { computeIntensity, isEvaporated } from "./decay.js";

export interface EvaluationContext {
  pheromones: Pheromone[];
  now: number;
  emissionHistory?: Array<{ trail: string; type: string; timestamp: number }>;
  traces?: Trace[];
}

export interface EvaluationResult {
  met: boolean;
  value: number;
  matchingPheromoneIds: string[];
}

/**
 * Evaluate a scent condition against the current environment
 */
export function evaluateCondition(
  condition: ScentCondition,
  ctx: EvaluationContext
): EvaluationResult {
  switch (condition.type) {
    case "threshold":
      return evaluateThreshold(condition, ctx);
    case "composite":
      return evaluateComposite(condition, ctx);
    case "rate":
      return evaluateRate(condition, ctx);
    case "pattern":
      return evaluatePattern(condition, ctx);
    case "trace":
      return evaluateTrace(condition, ctx);
    default:
      return { met: false, value: 0, matchingPheromoneIds: [] };
  }
}

/**
 * Evaluate a threshold condition
 */
function evaluateThreshold(
  condition: ThresholdCondition,
  ctx: EvaluationContext
): EvaluationResult {
  const { pheromones, now } = ctx;

  // Filter matching pheromones
  const matching = pheromones.filter((p) => {
    // Trail must match
    if (p.trail !== condition.trail) return false;

    // Type must match (or wildcard)
    if (condition.signal_type !== "*" && p.type !== condition.signal_type) return false;

    // Must not be evaporated
    if (isEvaporated(p, now)) return false;

    // Tag filter
    if (condition.tags && !matchTags(p.tags, condition.tags)) return false;

    return true;
  });

  // Compute aggregate value
  let aggValue: number;
  const intensities = matching.map((p) => computeIntensity(p, now));

  switch (condition.aggregation) {
    case "sum":
      aggValue = intensities.reduce((a, b) => a + b, 0);
      break;
    case "max":
      aggValue = intensities.length > 0 ? Math.max(...intensities) : 0;
      break;
    case "avg":
      aggValue = intensities.length > 0
        ? intensities.reduce((a, b) => a + b, 0) / intensities.length
        : 0;
      break;
    case "count":
      aggValue = matching.length;
      break;
    case "any":
      aggValue = matching.length > 0 ? 1 : 0;
      break;
    default:
      aggValue = 0;
  }

  // Compare
  const met = compare(aggValue, condition.operator, condition.value);

  return {
    met,
    value: aggValue,
    matchingPheromoneIds: matching.map((p) => p.id),
  };
}

/**
 * Evaluate a composite condition (AND, OR, NOT)
 */
function evaluateComposite(
  condition: CompositeCondition,
  ctx: EvaluationContext
): EvaluationResult {
  if (condition.conditions.length === 0) {
    return { met: false, value: 0, matchingPheromoneIds: [] };
  }

  const results = condition.conditions.map((c) => evaluateCondition(c, ctx));
  const allPheromoneIds = [...new Set(results.flatMap((r) => r.matchingPheromoneIds))];

  let met: boolean;
  switch (condition.operator) {
    case "and":
      met = results.every((r) => r.met);
      break;
    case "or":
      met = results.some((r) => r.met);
      break;
    case "not":
      met = !results[0].met;
      break;
    default:
      met = false;
  }

  return {
    met,
    value: results.filter((r) => r.met).length,
    matchingPheromoneIds: allPheromoneIds,
  };
}

/**
 * Evaluate a rate condition
 */
function evaluateRate(
  condition: RateCondition,
  ctx: EvaluationContext
): EvaluationResult {
  const { emissionHistory = [], now } = ctx;

  // Filter emissions in the window
  const windowStart = now - condition.window_ms;
  const relevantEmissions = emissionHistory.filter(
    (e) =>
      e.trail === condition.trail &&
      (condition.signal_type === "*" || e.type === condition.signal_type) &&
      e.timestamp >= windowStart
  );

  let value: number;
  if (condition.metric === "emissions_per_second") {
    const windowSeconds = condition.window_ms / 1000;
    value = relevantEmissions.length / windowSeconds;
  } else {
    // intensity_delta would require tracking intensity over time
    // For now, approximate with emission count
    value = relevantEmissions.length;
  }

  const met = compare(value, condition.operator, condition.value);

  return {
    met,
    value,
    matchingPheromoneIds: [],
  };
}

/**
 * Evaluate a pattern condition
 * Checks if a sequence of pheromone emissions occurred within a time window
 */
function evaluatePattern(
  condition: PatternCondition,
  ctx: EvaluationContext
): EvaluationResult {
  const { emissionHistory = [], now } = ctx;
  const { sequence, window_ms, ordered = true } = condition;

  // Filter emissions within the window
  const windowStart = now - window_ms;
  const relevant = emissionHistory.filter((e) => e.timestamp >= windowStart);

  if (relevant.length === 0 || sequence.length === 0) {
    return { met: false, value: 0, matchingPheromoneIds: [] };
  }

  if (ordered) {
    // Ordered: each step must appear after the previous one
    let searchFrom = 0;
    let matchCount = 0;

    for (const step of sequence) {
      let found = false;
      for (let i = searchFrom; i < relevant.length; i++) {
        const emission = relevant[i];
        if (
          emission.trail === step.trail &&
          emission.type === step.signal_type
        ) {
          found = true;
          searchFrom = i + 1;
          matchCount++;
          break;
        }
      }
      if (!found) break;
    }

    return {
      met: matchCount === sequence.length,
      value: matchCount / sequence.length,
      matchingPheromoneIds: [],
    };
  } else {
    // Unordered: all steps must appear in any order
    const remaining = [...relevant];
    let matchCount = 0;

    for (const step of sequence) {
      const idx = remaining.findIndex(
        (e) => e.trail === step.trail && e.type === step.signal_type
      );
      if (idx >= 0) {
        remaining.splice(idx, 1);
        matchCount++;
      }
    }

    return {
      met: matchCount === sequence.length,
      value: matchCount / sequence.length,
      matchingPheromoneIds: [],
    };
  }
}

/**
 * Match tags against a filter
 */
function matchTags(tags: string[], filter: TagFilter): boolean {
  if (filter.any && filter.any.length > 0) {
    if (!filter.any.some((t) => tags.includes(t))) return false;
  }
  if (filter.all && filter.all.length > 0) {
    if (!filter.all.every((t) => tags.includes(t))) return false;
  }
  if (filter.none && filter.none.length > 0) {
    if (filter.none.some((t) => tags.includes(t))) return false;
  }
  return true;
}

/**
 * Compare two values with an operator
 */
function compare(a: number, op: string, b: number): boolean {
  switch (op) {
    case ">=":
      return a >= b;
    case ">":
      return a > b;
    case "<=":
      return a <= b;
    case "<":
      return a < b;
    case "==":
      return a === b;
    case "!=":
      return a !== b;
    default:
      return false;
  }
}

/**
 * Create a snapshot of a pheromone for trigger payloads
 */
export function createSnapshot(pheromone: Pheromone, now: number): PheromoneSnapshot {
  return {
    id: pheromone.id,
    trail: pheromone.trail,
    type: pheromone.type,
    current_intensity: computeIntensity(pheromone, now),
    payload: pheromone.payload,
    age_ms: now - pheromone.emitted_at,
    tags: pheromone.tags,
  };
}

// ============================================================================
// TRACE CONDITION
// ============================================================================

/**
 * Evaluate a trace condition — check durable knowledge state
 */
function evaluateTrace(
  condition: TraceCondition,
  ctx: EvaluationContext
): EvaluationResult {
  const traces = ctx.traces ?? [];

  // Filter matching traces
  const matching = traces.filter((t) => {
    if (t.trail !== condition.trail) return false;
    if (condition.key !== "*" && t.key !== condition.key) return false;
    return true;
  });

  switch (condition.operator) {
    case "exists":
      return { met: matching.length > 0, value: matching.length, matchingPheromoneIds: [] };

    case "not_exists":
      return { met: matching.length === 0, value: 0, matchingPheromoneIds: [] };

    case "value_eq": {
      if (!condition.field || condition.expected === undefined) {
        return { met: false, value: 0, matchingPheromoneIds: [] };
      }
      const matched = matching.some((t) => {
        const val = getNestedValue(t.value, condition.field!);
        return deepEqual(val, condition.expected);
      });
      return { met: matched, value: matched ? 1 : 0, matchingPheromoneIds: [] };
    }

    case "value_neq": {
      if (!condition.field || condition.expected === undefined) {
        return { met: false, value: 0, matchingPheromoneIds: [] };
      }
      const allNotEqual = matching.length > 0 && matching.every((t) => {
        const val = getNestedValue(t.value, condition.field!);
        return !deepEqual(val, condition.expected);
      });
      return { met: allNotEqual, value: allNotEqual ? 1 : 0, matchingPheromoneIds: [] };
    }

    default:
      return { met: false, value: 0, matchingPheromoneIds: [] };
  }
}

/**
 * Get a nested value from an object using dot-separated path.
 * e.g., getNestedValue({ a: { b: 1 } }, "a.b") => 1
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Simple deep equality check for trace value comparison
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);

  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
}
