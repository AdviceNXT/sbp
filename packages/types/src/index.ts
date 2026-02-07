/**
 * @advicenxt/sbp-types — Canonical Type Definitions
 * Stigmergic Blackboard Protocol v0.1
 *
 * This package is the single source of truth for SBP types.
 * Used by @advicenxt/sbp-server, @advicenxt/sbp-client, and third-party implementations.
 */

// ============================================================================
// DECAY MODELS
// ============================================================================

export interface ExponentialDecay {
    type: "exponential";
    half_life_ms: number;
}

export interface LinearDecay {
    type: "linear";
    rate_per_ms: number;
}

export interface StepDecay {
    type: "step";
    steps: Array<{ at_ms: number; intensity: number }>;
}

export interface ImmortalDecay {
    type: "immortal";
}

export type DecayModel = ExponentialDecay | LinearDecay | StepDecay | ImmortalDecay;

// ============================================================================
// PHEROMONE
// ============================================================================

export interface Pheromone {
    id: string;
    trail: string;
    type: string;
    emitted_at: number;
    last_reinforced_at: number;
    initial_intensity: number;
    decay_model: DecayModel;
    payload: Record<string, unknown>;
    source_agent?: string;
    tags: string[];
    ttl_floor: number;
}

export interface PheromoneSnapshot {
    id: string;
    trail: string;
    type: string;
    current_intensity: number;
    payload: Record<string, unknown>;
    age_ms: number;
    tags: string[];
}

// ============================================================================
// TAG FILTERING
// ============================================================================

export interface TagFilter {
    any?: string[];
    all?: string[];
    none?: string[];
}

// ============================================================================
// SCENT CONDITIONS
// ============================================================================

export interface ThresholdCondition {
    type: "threshold";
    trail: string;
    signal_type: string;
    tags?: TagFilter;
    aggregation: "sum" | "max" | "avg" | "count" | "any";
    operator: ">=" | ">" | "<=" | "<" | "==" | "!=";
    value: number;
}

export interface CompositeCondition {
    type: "composite";
    operator: "and" | "or" | "not";
    conditions: ScentCondition[];
}

export interface RateCondition {
    type: "rate";
    trail: string;
    signal_type: string;
    metric: "emissions_per_second" | "intensity_delta";
    window_ms: number;
    operator: ">=" | ">" | "<=" | "<";
    value: number;
}

export interface PatternCondition {
    type: "pattern";
    sequence: Array<{
        trail: string;
        signal_type: string;
        min_intensity?: number;
    }>;
    window_ms: number;
    ordered?: boolean;
}

export type ScentCondition = ThresholdCondition | CompositeCondition | RateCondition | PatternCondition;

// ============================================================================
// MERGE STRATEGIES & TRIGGER MODES
// ============================================================================

export type MergeStrategy = "reinforce" | "replace" | "max" | "add" | "new";
export type TriggerMode = "level" | "edge_rising" | "edge_falling";

// ============================================================================
// OPERATION PARAMS & RESULTS
// ============================================================================

export interface EmitParams {
    trail: string;
    type: string;
    intensity: number;
    decay?: DecayModel;
    payload?: Record<string, unknown>;
    tags?: string[];
    merge_strategy?: MergeStrategy;
    source_agent?: string;
}

export interface EmitResult {
    pheromone_id: string;
    action: "created" | "reinforced" | "replaced" | "merged";
    previous_intensity?: number;
    new_intensity: number;
}

export interface SniffParams {
    trails?: string[];
    types?: string[];
    min_intensity?: number;
    max_age_ms?: number;
    tags?: TagFilter;
    limit?: number;
    include_evaporated?: boolean;
}

export interface AggregateStats {
    count: number;
    sum_intensity: number;
    max_intensity: number;
    avg_intensity: number;
}

export interface SniffResult {
    timestamp: number;
    pheromones: PheromoneSnapshot[];
    aggregates: Record<string, AggregateStats>;
}

export interface RegisterScentParams {
    scent_id: string;
    agent_endpoint: string;
    condition: ScentCondition;
    cooldown_ms?: number;
    activation_payload?: Record<string, unknown>;
    trigger_mode?: TriggerMode;
    hysteresis?: number;
    max_execution_ms?: number;
    context_trails?: string[];
}

export interface RegisterScentResult {
    scent_id: string;
    status: "registered" | "updated";
    current_condition_state: {
        met: boolean;
        partial?: Record<string, boolean>;
    };
}

export interface DeregisterScentParams {
    scent_id: string;
}

export interface DeregisterScentResult {
    scent_id: string;
    status: "deregistered" | "not_found";
}

export interface TriggerPayload {
    scent_id: string;
    triggered_at: number;
    condition_snapshot: Record<string, { value: number; pheromone_ids: string[] }>;
    context_pheromones: PheromoneSnapshot[];
    activation_payload: Record<string, unknown>;
}

export interface EvaporateParams {
    trail?: string;
    types?: string[];
    older_than_ms?: number;
    below_intensity?: number;
    tags?: TagFilter;
}

export interface EvaporateResult {
    evaporated_count: number;
    trails_affected: string[];
}

export interface InspectParams {
    include?: Array<"trails" | "scents" | "stats">;
}

export interface TrailInfo {
    name: string;
    pheromone_count: number;
    total_intensity: number;
    avg_intensity: number;
}

export interface ScentInfo {
    scent_id: string;
    agent_endpoint: string;
    condition_met: boolean;
    in_cooldown: boolean;
    last_triggered_at: number | null;
}

export interface InspectResult {
    timestamp: number;
    trails?: TrailInfo[];
    scents?: ScentInfo[];
    stats?: {
        total_pheromones: number;
        active_pheromones: number;
        total_scents: number;
        uptime_ms: number;
    };
}

// ============================================================================
// JSON-RPC
// ============================================================================

export interface JsonRpcRequest<T = unknown> {
    jsonrpc: "2.0";
    id: string | number;
    method: string;
    params: T;
}

export interface JsonRpcSuccessResponse<T = unknown> {
    jsonrpc: "2.0";
    id: string | number;
    result: T;
}

export interface JsonRpcErrorResponse {
    jsonrpc: "2.0";
    id: string | number | null;
    error: {
        code: number;
        message: string;
        data?: unknown;
    };
}

export type JsonRpcResponse<T = unknown> = JsonRpcSuccessResponse<T> | JsonRpcErrorResponse;

// ============================================================================
// ERROR CODES
// ============================================================================

export const SBP_ERROR_CODES = {
    TRAIL_NOT_FOUND: -32001,
    SCENT_NOT_FOUND: -32002,
    PAYLOAD_VALIDATION_FAILED: -32003,
    RATE_LIMITED: -32004,
    UNAUTHORIZED: -32005,
    INVALID_CONDITION: -32006,
} as const;

export class SbpError extends Error {
    constructor(
        public code: number,
        message: string,
        public data?: unknown
    ) {
        super(message);
        this.name = "SbpError";
    }
}
