/**
 * Stigmergic Blackboard Protocol (SBP) v0.1
 * TypeScript Type Definitions
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
  /** Unique identifier (UUID v7 recommended) */
  id: string;
  /** Namespaced category (e.g., "market.signals") */
  trail: string;
  /** Signal type within trail (e.g., "volatility") */
  type: string;
  /** Unix timestamp (ms) when first emitted */
  emitted_at: number;
  /** Unix timestamp (ms) of last reinforcement */
  last_reinforced_at: number;
  /** Starting intensity (0.0 - 1.0) */
  initial_intensity: number;
  /** Computed current intensity after decay */
  current_intensity: number;
  /** How this pheromone decays */
  decay_model: DecayModel;
  /** Arbitrary JSON payload */
  payload: Record<string, unknown>;
  /** Emitting agent identifier */
  source_agent?: string;
  /** Classification tags */
  tags?: string[];
  /** Minimum intensity before evaporation (default: 0.01) */
  ttl_floor?: number;
}

// ============================================================================
// TAG FILTERING
// ============================================================================

export interface TagFilter {
  /** Match if any of these tags present */
  any?: string[];
  /** Match only if all of these tags present */
  all?: string[];
  /** Match only if none of these tags present */
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

export type ScentCondition =
  | ThresholdCondition
  | CompositeCondition
  | RateCondition
  | PatternCondition;

// ============================================================================
// OPERATIONS
// ============================================================================

export type MergeStrategy = "reinforce" | "replace" | "max" | "add" | "new";
export type TriggerMode = "level" | "edge_rising" | "edge_falling";

// EMIT
export interface EmitParams {
  trail: string;
  type: string;
  intensity: number;
  decay?: DecayModel;
  payload?: Record<string, unknown>;
  tags?: string[];
  merge_strategy?: MergeStrategy;
}

export interface EmitResult {
  pheromone_id: string;
  action: "created" | "reinforced" | "replaced" | "merged";
  previous_intensity?: number;
  new_intensity: number;
}

// SNIFF
export interface SniffParams {
  trails?: string[];
  types?: string[];
  min_intensity?: number;
  tags?: TagFilter;
  limit?: number;
  include_evaporated?: boolean;
}

export interface SniffResult {
  timestamp: number;
  pheromones: Array<
    Pick<Pheromone, "id" | "trail" | "type" | "current_intensity" | "payload"> & {
      age_ms: number;
    }
  >;
  aggregates: Record<
    string,
    {
      count: number;
      sum_intensity: number;
      max_intensity: number;
      avg_intensity: number;
    }
  >;
}

// REGISTER_SCENT
export interface RegisterScentParams {
  scent_id: string;
  agent_endpoint: string;
  condition: ScentCondition;
  cooldown_ms?: number;
  activation_payload?: Record<string, unknown>;
  trigger_mode?: TriggerMode;
  hysteresis?: number;
  max_execution_ms?: number;
}

export interface RegisterScentResult {
  scent_id: string;
  status: "registered" | "updated";
  current_condition_state: {
    met: boolean;
    partial: Record<string, boolean>;
  };
}

// TRIGGER (Blackboard → Agent)
export interface TriggerPayload {
  scent_id: string;
  triggered_at: number;
  condition_snapshot: Record<
    string,
    {
      value: number;
      triggering_pheromones: string[];
    }
  >;
  context_pheromones: Pheromone[];
  activation_payload?: Record<string, unknown>;
}

// DEREGISTER_SCENT
export interface DeregisterScentParams {
  scent_id: string;
}

export interface DeregisterScentResult {
  scent_id: string;
  status: "deregistered" | "not_found";
}

// EVAPORATE
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

// INSPECT
export interface InspectParams {
  include?: Array<"trails" | "scents" | "stats" | "agents">;
}

export interface InspectResult {
  trails?: Array<{
    name: string;
    pheromone_count: number;
    total_intensity: number;
  }>;
  scents?: Array<{
    scent_id: string;
    agent_endpoint: string;
    condition_met: boolean;
    in_cooldown: boolean;
  }>;
  stats?: {
    total_pheromones: number;
    total_scents: number;
    emits_per_second: number;
    triggers_per_minute: number;
  };
}

// ============================================================================
// JSON-RPC WRAPPER
// ============================================================================

export interface JsonRpcRequest<T = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params: T;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// SBP Methods
export type SbpMethod =
  | "sbp/emit"
  | "sbp/sniff"
  | "sbp/register_scent"
  | "sbp/deregister_scent"
  | "sbp/trigger"
  | "sbp/evaporate"
  | "sbp/inspect";

// ============================================================================
// CLIENT INTERFACE
// ============================================================================

export interface SbpClient {
  emit(params: EmitParams): Promise<EmitResult>;
  sniff(params: SniffParams): Promise<SniffResult>;
  registerScent(params: RegisterScentParams): Promise<RegisterScentResult>;
  deregisterScent(params: DeregisterScentParams): Promise<DeregisterScentResult>;
  evaporate(params: EvaporateParams): Promise<EvaporateResult>;
  inspect(params: InspectParams): Promise<InspectResult>;
}

// ============================================================================
// AGENT HANDLER INTERFACE
// ============================================================================

export interface SbpAgentHandler {
  /** Called when the agent's scent condition is met */
  onTrigger(payload: TriggerPayload): Promise<void>;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Compute current intensity of a pheromone at a given time
 */
export function computeIntensity(pheromone: Pheromone, now: number): number;

/**
 * Check if a pheromone has evaporated
 */
export function isEvaporated(pheromone: Pheromone, now: number): boolean;
