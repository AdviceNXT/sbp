/**
 * SBP Input Validation
 * Zod schemas for all JSON-RPC params and protocol messages
 */

import { z } from "zod";

// ============================================================================
// DECAY MODEL SCHEMAS
// ============================================================================

const ExponentialDecaySchema = z.object({
  type: z.literal("exponential"),
  half_life_ms: z.number().positive(),
});

const LinearDecaySchema = z.object({
  type: z.literal("linear"),
  rate_per_ms: z.number().positive(),
});

const StepDecaySchema = z.object({
  type: z.literal("step"),
  steps: z
    .array(
      z.object({
        at_ms: z.number().nonnegative(),
        intensity: z.number().min(0).max(1),
      })
    )
    .min(1),
});

const ImmortalDecaySchema = z.object({
  type: z.literal("immortal"),
});

const DecayModelSchema = z.discriminatedUnion("type", [
  ExponentialDecaySchema,
  LinearDecaySchema,
  StepDecaySchema,
  ImmortalDecaySchema,
]);

// ============================================================================
// TAG FILTER SCHEMAS
// ============================================================================

const TagFilterSchema = z
  .object({
    any: z.array(z.string()).optional(),
    all: z.array(z.string()).optional(),
    none: z.array(z.string()).optional(),
  })
  .strict();

// ============================================================================
// CONDITION SCHEMAS
// ============================================================================

const ThresholdConditionSchema = z.object({
  type: z.literal("threshold"),
  trail: z.string().min(1),
  signal_type: z.string().min(1),
  tags: TagFilterSchema.optional(),
  aggregation: z.enum(["sum", "max", "avg", "count", "any"]),
  operator: z.enum([">=", ">", "<=", "<", "==", "!="]),
  value: z.number(),
});

const RateConditionSchema = z.object({
  type: z.literal("rate"),
  trail: z.string().min(1),
  signal_type: z.string().min(1),
  metric: z.enum(["emissions_per_second", "intensity_delta"]),
  window_ms: z.number().positive(),
  operator: z.enum([">=", ">", "<=", "<"]),
  value: z.number(),
});

const PatternConditionSchema = z.object({
  type: z.literal("pattern"),
  sequence: z
    .array(
      z.object({
        trail: z.string().min(1),
        signal_type: z.string().min(1),
        min_intensity: z.number().min(0).max(1).optional(),
      })
    )
    .min(1),
  window_ms: z.number().positive(),
  ordered: z.boolean().optional(),
});

// Recursive condition schema using z.lazy for composite self-reference
const ScentConditionSchema: z.ZodType = z.lazy(() =>
  z.union([
    ThresholdConditionSchema,
    z.object({
      type: z.literal("composite"),
      operator: z.enum(["and", "or", "not"]),
      conditions: z.array(ScentConditionSchema).min(1),
    }),
    RateConditionSchema,
    PatternConditionSchema,
  ])
);

// ============================================================================
// OPERATION PARAM SCHEMAS
// ============================================================================

export const EmitParamsSchema = z.object({
  trail: z.string().min(1, "Trail must be a non-empty string"),
  type: z.string().min(1, "Type must be a non-empty string"),
  intensity: z.number().min(0).max(1, "Intensity must be between 0 and 1"),
  decay: DecayModelSchema.optional(),
  payload: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  merge_strategy: z.enum(["reinforce", "replace", "max", "add", "new"]).optional(),
  source_agent: z.string().optional(),
});

export const SniffParamsSchema = z.object({
  trails: z.array(z.string()).optional(),
  types: z.array(z.string()).optional(),
  min_intensity: z.number().min(0).max(1).optional(),
  max_age_ms: z.number().positive().optional(),
  tags: TagFilterSchema.optional(),
  limit: z.number().int().positive().max(10000).optional(),
  include_evaporated: z.boolean().optional(),
});

export const RegisterScentParamsSchema = z.object({
  scent_id: z.string().min(1, "Scent ID must be a non-empty string"),
  agent_endpoint: z.string().optional().default(""),
  condition: ScentConditionSchema,
  cooldown_ms: z.number().int().nonnegative().optional(),
  activation_payload: z.record(z.unknown()).optional(),
  trigger_mode: z.enum(["level", "edge_rising", "edge_falling"]).optional(),
  hysteresis: z.number().nonnegative().optional(),
  max_execution_ms: z.number().positive().optional(),
  context_trails: z.array(z.string()).optional(),
});

export const DeregisterScentParamsSchema = z.object({
  scent_id: z.string().min(1),
});

export const EvaporateParamsSchema = z.object({
  trail: z.string().optional(),
  types: z.array(z.string()).optional(),
  older_than_ms: z.number().positive().optional(),
  below_intensity: z.number().min(0).max(1).optional(),
  tags: TagFilterSchema.optional(),
});

export const InspectParamsSchema = z.object({
  include: z.array(z.enum(["trails", "scents", "stats"])).optional(),
});

export const SubscribeParamsSchema = z.object({
  scent_id: z.string().min(1),
});

export const UnsubscribeParamsSchema = z.object({
  scent_id: z.string().min(1),
});

// ============================================================================
// JSON-RPC ENVELOPE SCHEMA
// ============================================================================

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.string().min(1),
  params: z.unknown().optional().default({}),
});

// ============================================================================
// VALIDATION HELPER
// ============================================================================

/** Map of method names to their param schemas */
const METHOD_SCHEMAS: Record<string, z.ZodType> = {
  "sbp/emit": EmitParamsSchema,
  "sbp/sniff": SniffParamsSchema,
  "sbp/register_scent": RegisterScentParamsSchema,
  "sbp/deregister_scent": DeregisterScentParamsSchema,
  "sbp/evaporate": EvaporateParamsSchema,
  "sbp/inspect": InspectParamsSchema,
  "sbp/subscribe": SubscribeParamsSchema,
  "sbp/unsubscribe": UnsubscribeParamsSchema,
};

export interface ValidationError {
  code: -32600 | -32602;
  message: string;
  data?: unknown;
}

/**
 * Validate a JSON-RPC request envelope.
 * Returns the parsed request or a JSON-RPC error.
 */
export function validateEnvelope(
  body: unknown
): { ok: true; request: z.infer<typeof JsonRpcRequestSchema> } | { ok: false; error: ValidationError } {
  const result = JsonRpcRequestSchema.safeParse(body);
  if (!result.success) {
    return {
      ok: false,
      error: {
        code: -32600,
        message: "Invalid JSON-RPC request",
        data: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    };
  }
  return { ok: true, request: result.data };
}

/**
 * Validate method-specific params.
 * Returns the parsed params or a JSON-RPC error.
 */
export function validateParams(
  method: string,
  params: unknown
): { ok: true; params: unknown } | { ok: false; error: ValidationError } {
  const schema = METHOD_SCHEMAS[method];
  if (!schema) {
    // Unknown methods are handled by the RPC router, not here
    return { ok: true, params };
  }

  const result = schema.safeParse(params);
  if (!result.success) {
    return {
      ok: false,
      error: {
        code: -32602,
        message: `Invalid params for ${method}`,
        data: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    };
  }
  return { ok: true, params: result.data };
}
