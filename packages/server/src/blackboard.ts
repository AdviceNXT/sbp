/**
 * SBP Blackboard - Core State Management
 */

import { v4 as uuidv4 } from "uuid";
import type {
  Pheromone,
  PheromoneSnapshot,
  Scent,
  DecayModel,
  EmitParams,
  EmitResult,
  SniffParams,
  SniffResult,
  AggregateStats,
  RegisterScentParams,
  RegisterScentResult,
  DeregisterScentParams,
  DeregisterScentResult,
  EvaporateParams,
  EvaporateResult,
  InspectParams,
  InspectResult,
  TriggerPayload,
  TagFilter,
} from "./types.js";
import { computeIntensity, isEvaporated, defaultDecay } from "./decay.js";
import { evaluateCondition, createSnapshot } from "./conditions.js";
import { createHash } from "crypto";

export interface BlackboardOptions {
  /** Interval for scent evaluation in ms (default: 100) */
  evaluationInterval?: number;
  /** Default decay model for new pheromones */
  defaultDecay?: DecayModel;
  /** Default TTL floor for evaporation */
  defaultTtlFloor?: number;
  /** Maximum pheromones before GC triggers */
  maxPheromones?: number;
  /** Enable emission history tracking for rate conditions */
  trackEmissionHistory?: boolean;
  /** How long to keep emission history (ms) */
  emissionHistoryWindow?: number;
}

export interface TriggerHandler {
  (payload: TriggerPayload): Promise<void>;
}

export class Blackboard {
  private pheromones = new Map<string, Pheromone>();
  private scents = new Map<string, Scent>();
  private triggerHandlers = new Map<string, TriggerHandler>();
  private emissionHistory: Array<{ trail: string; type: string; timestamp: number }> = [];
  private evaluationTimer: ReturnType<typeof setInterval> | null = null;
  private startTime = Date.now();

  private options: Required<BlackboardOptions>;

  constructor(options: BlackboardOptions = {}) {
    this.options = {
      evaluationInterval: options.evaluationInterval ?? 100,
      defaultDecay: options.defaultDecay ?? defaultDecay(),
      defaultTtlFloor: options.defaultTtlFloor ?? 0.01,
      maxPheromones: options.maxPheromones ?? 100000,
      trackEmissionHistory: options.trackEmissionHistory ?? true,
      emissionHistoryWindow: options.emissionHistoryWindow ?? 60000,
    };
  }

  // ==========================================================================
  // EMIT
  // ==========================================================================

  emit(params: EmitParams): EmitResult {
    const now = Date.now();
    const {
      trail,
      type,
      intensity,
      decay = this.options.defaultDecay,
      payload = {},
      tags = [],
      merge_strategy = "reinforce",
      source_agent,
    } = params;

    // Validate intensity
    const clampedIntensity = Math.max(0, Math.min(1, intensity));

    // Track emission for rate conditions
    if (this.options.trackEmissionHistory) {
      this.emissionHistory.push({ trail, type, timestamp: now });
      this.pruneEmissionHistory(now);
    }

    // Generate payload hash for matching
    const payloadHash = this.hashPayload(payload);

    // Find existing pheromone for merge
    let existing: Pheromone | undefined;
    if (merge_strategy !== "new") {
      for (const p of this.pheromones.values()) {
        if (
          p.trail === trail &&
          p.type === type &&
          this.hashPayload(p.payload) === payloadHash &&
          !isEvaporated(p, now)
        ) {
          existing = p;
          break;
        }
      }
    }

    if (existing) {
      const previousIntensity = computeIntensity(existing, now);
      let action: EmitResult["action"] = "reinforced";

      switch (merge_strategy) {
        case "reinforce":
          existing.initial_intensity = clampedIntensity;
          existing.last_reinforced_at = now;
          action = "reinforced";
          break;

        case "replace":
          existing.initial_intensity = clampedIntensity;
          existing.last_reinforced_at = now;
          existing.payload = payload;
          existing.tags = tags;
          if (source_agent) existing.source_agent = source_agent;
          action = "replaced";
          break;

        case "max":
          existing.initial_intensity = Math.max(previousIntensity, clampedIntensity);
          existing.last_reinforced_at = now;
          action = "merged";
          break;

        case "add":
          existing.initial_intensity = Math.min(1, previousIntensity + clampedIntensity);
          existing.last_reinforced_at = now;
          action = "merged";
          break;
      }

      return {
        pheromone_id: existing.id,
        action,
        previous_intensity: previousIntensity,
        new_intensity: computeIntensity(existing, now),
      };
    }

    // Create new pheromone
    const id = uuidv4();
    const pheromone: Pheromone = {
      id,
      trail,
      type,
      emitted_at: now,
      last_reinforced_at: now,
      initial_intensity: clampedIntensity,
      decay_model: decay,
      payload,
      source_agent,
      tags,
      ttl_floor: this.options.defaultTtlFloor,
    };

    this.pheromones.set(id, pheromone);

    // Trigger GC if needed
    if (this.pheromones.size > this.options.maxPheromones) {
      this.gc();
    }

    return {
      pheromone_id: id,
      action: "created",
      new_intensity: clampedIntensity,
    };
  }

  // ==========================================================================
  // SNIFF
  // ==========================================================================

  sniff(params: SniffParams = {}): SniffResult {
    const now = Date.now();
    const {
      trails,
      types,
      min_intensity = 0,
      max_age_ms,
      tags,
      limit = 100,
      include_evaporated = false,
    } = params;

    const results: PheromoneSnapshot[] = [];
    const aggregates = new Map<string, { count: number; sum: number; max: number }>();

    for (const p of this.pheromones.values()) {
      // Filter by trail
      if (trails && trails.length > 0 && !trails.includes(p.trail)) continue;

      // Filter by type
      if (types && types.length > 0 && !types.includes(p.type)) continue;

      const intensity = computeIntensity(p, now);

      // Filter evaporated
      if (!include_evaporated && intensity < p.ttl_floor) continue;

      // Filter by min intensity
      if (intensity < min_intensity) continue;

      // Filter by max age
      if (max_age_ms !== undefined && now - p.emitted_at > max_age_ms) continue;

      // Filter by tags
      if (tags && !this.matchTags(p.tags, tags)) continue;

      results.push(createSnapshot(p, now));

      // Aggregate
      const key = `${p.trail}/${p.type}`;
      const agg = aggregates.get(key) || { count: 0, sum: 0, max: 0 };
      agg.count++;
      agg.sum += intensity;
      agg.max = Math.max(agg.max, intensity);
      aggregates.set(key, agg);
    }

    // Sort by intensity descending
    results.sort((a, b) => b.current_intensity - a.current_intensity);

    // Build aggregates result
    const aggregatesResult: Record<string, AggregateStats> = {};
    for (const [key, agg] of aggregates) {
      aggregatesResult[key] = {
        count: agg.count,
        sum_intensity: agg.sum,
        max_intensity: agg.max,
        avg_intensity: agg.count > 0 ? agg.sum / agg.count : 0,
      };
    }

    return {
      timestamp: now,
      pheromones: results.slice(0, limit),
      aggregates: aggregatesResult,
    };
  }

  // ==========================================================================
  // REGISTER_SCENT
  // ==========================================================================

  registerScent(params: RegisterScentParams): RegisterScentResult {
    const {
      scent_id,
      agent_endpoint,
      condition,
      cooldown_ms = 0,
      activation_payload = {},
      trigger_mode = "level",
      hysteresis = 0,
      max_execution_ms = 30000,
      context_trails,
    } = params;

    const isUpdate = this.scents.has(scent_id);

    const scent: Scent = {
      scent_id,
      agent_endpoint,
      condition,
      cooldown_ms,
      activation_payload,
      trigger_mode,
      hysteresis,
      max_execution_ms,
      last_triggered_at: null,
      last_condition_met: false,
      context_trails,
    };

    this.scents.set(scent_id, scent);

    // Evaluate current state
    const now = Date.now();
    const evalResult = evaluateCondition(condition, {
      pheromones: [...this.pheromones.values()],
      now,
      emissionHistory: this.emissionHistory,
    });

    return {
      scent_id,
      status: isUpdate ? "updated" : "registered",
      current_condition_state: {
        met: evalResult.met,
      },
    };
  }

  // ==========================================================================
  // DEREGISTER_SCENT
  // ==========================================================================

  deregisterScent(params: DeregisterScentParams): DeregisterScentResult {
    const { scent_id } = params;

    if (this.scents.has(scent_id)) {
      this.scents.delete(scent_id);
      this.triggerHandlers.delete(scent_id);
      return { scent_id, status: "deregistered" };
    }

    return { scent_id, status: "not_found" };
  }

  // ==========================================================================
  // EVAPORATE
  // ==========================================================================

  evaporate(params: EvaporateParams = {}): EvaporateResult {
    const now = Date.now();
    const { trail, types, older_than_ms, below_intensity, tags } = params;

    const toRemove: string[] = [];
    const trailsAffected = new Set<string>();

    for (const [id, p] of this.pheromones) {
      if (trail && p.trail !== trail) continue;
      if (types && types.length > 0 && !types.includes(p.type)) continue;
      if (older_than_ms !== undefined && now - p.emitted_at < older_than_ms) continue;
      if (below_intensity !== undefined && computeIntensity(p, now) >= below_intensity) continue;
      if (tags && !this.matchTags(p.tags, tags)) continue;

      toRemove.push(id);
      trailsAffected.add(p.trail);
    }

    for (const id of toRemove) {
      this.pheromones.delete(id);
    }

    return {
      evaporated_count: toRemove.length,
      trails_affected: [...trailsAffected],
    };
  }

  // ==========================================================================
  // INSPECT
  // ==========================================================================

  inspect(params: InspectParams = {}): InspectResult {
    const now = Date.now();
    const include = params.include ?? ["trails", "scents", "stats"];
    const result: InspectResult = { timestamp: now };

    if (include.includes("trails")) {
      const trailMap = new Map<string, { count: number; intensity: number }>();

      for (const p of this.pheromones.values()) {
        if (isEvaporated(p, now)) continue;

        const current = trailMap.get(p.trail) || { count: 0, intensity: 0 };
        current.count++;
        current.intensity += computeIntensity(p, now);
        trailMap.set(p.trail, current);
      }

      result.trails = [...trailMap.entries()].map(([name, data]) => ({
        name,
        pheromone_count: data.count,
        total_intensity: data.intensity,
        avg_intensity: data.count > 0 ? data.intensity / data.count : 0,
      }));
    }

    if (include.includes("scents")) {
      result.scents = [...this.scents.values()].map((s) => ({
        scent_id: s.scent_id,
        agent_endpoint: s.agent_endpoint,
        condition_met: s.last_condition_met,
        in_cooldown: s.last_triggered_at
          ? now - s.last_triggered_at < s.cooldown_ms
          : false,
        last_triggered_at: s.last_triggered_at,
      }));
    }

    if (include.includes("stats")) {
      let activeCount = 0;
      for (const p of this.pheromones.values()) {
        if (!isEvaporated(p, now)) activeCount++;
      }

      result.stats = {
        total_pheromones: this.pheromones.size,
        active_pheromones: activeCount,
        total_scents: this.scents.size,
        uptime_ms: now - this.startTime,
      };
    }

    return result;
  }

  // ==========================================================================
  // TRIGGER HANDLING
  // ==========================================================================

  /**
   * Register a local handler for a scent
   */
  onTrigger(scentId: string, handler: TriggerHandler): void {
    this.triggerHandlers.set(scentId, handler);
  }

  /**
   * Remove a local trigger handler
   */
  offTrigger(scentId: string): void {
    this.triggerHandlers.delete(scentId);
  }

  // ==========================================================================
  // EVALUATION LOOP
  // ==========================================================================

  /**
   * Start the background scent evaluation loop
   */
  start(): void {
    if (this.evaluationTimer) return;

    this.evaluationTimer = setInterval(() => {
      this.evaluateScents().catch((err) => {
        console.error("[SBP] Evaluation error:", err);
      });
    }, this.options.evaluationInterval);
  }

  /**
   * Stop the background evaluation loop
   */
  stop(): void {
    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
      this.evaluationTimer = null;
    }
  }

  /**
   * Evaluate all scents and trigger as needed
   */
  async evaluateScents(): Promise<void> {
    const now = Date.now();
    const pheromones = [...this.pheromones.values()];

    for (const scent of this.scents.values()) {
      // Check cooldown
      if (scent.last_triggered_at && now - scent.last_triggered_at < scent.cooldown_ms) {
        continue;
      }

      const evalResult = evaluateCondition(scent.condition, {
        pheromones,
        now,
        emissionHistory: this.emissionHistory,
      });

      const shouldTrigger = this.shouldTrigger(scent, evalResult.met, now);
      scent.last_condition_met = evalResult.met;

      if (shouldTrigger) {
        scent.last_triggered_at = now;
        await this.dispatchTrigger(scent, evalResult, now);
      }
    }
  }

  /**
   * Determine if a scent should trigger based on mode
   */
  private shouldTrigger(scent: Scent, conditionMet: boolean, _now: number): boolean {
    switch (scent.trigger_mode) {
      case "level":
        return conditionMet;

      case "edge_rising":
        return conditionMet && !scent.last_condition_met;

      case "edge_falling":
        return !conditionMet && scent.last_condition_met;

      default:
        return conditionMet;
    }
  }

  /**
   * Dispatch a trigger to the agent
   */
  private async dispatchTrigger(
    scent: Scent,
    evalResult: { met: boolean; value: number; matchingPheromoneIds: string[] },
    now: number
  ): Promise<void> {
    // Build context pheromones
    const contextTrails = scent.context_trails || [];
    const contextPheromones: PheromoneSnapshot[] = [];

    if (contextTrails.length > 0) {
      for (const p of this.pheromones.values()) {
        if (contextTrails.includes(p.trail) && !isEvaporated(p, now)) {
          contextPheromones.push(createSnapshot(p, now));
        }
      }
    } else {
      // Include matching pheromones
      for (const id of evalResult.matchingPheromoneIds) {
        const p = this.pheromones.get(id);
        if (p) {
          contextPheromones.push(createSnapshot(p, now));
        }
      }
    }

    const payload: TriggerPayload = {
      scent_id: scent.scent_id,
      triggered_at: now,
      condition_snapshot: {
        [scent.scent_id]: {
          value: evalResult.value,
          pheromone_ids: evalResult.matchingPheromoneIds,
        },
      },
      context_pheromones: contextPheromones,
      activation_payload: scent.activation_payload,
    };

    // Try local handler first
    const localHandler = this.triggerHandlers.get(scent.scent_id);
    if (localHandler) {
      try {
        await localHandler(payload);
      } catch (err) {
        console.error(`[SBP] Trigger handler error for ${scent.scent_id}:`, err);
      }
      return;
    }

    // Otherwise, HTTP POST to endpoint
    try {
      const response = await fetch(scent.agent_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-SBP-Version": "0.1",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "sbp/trigger",
          params: payload,
        }),
        signal: AbortSignal.timeout(scent.max_execution_ms),
      });

      if (!response.ok) {
        console.error(`[SBP] Trigger failed for ${scent.scent_id}: ${response.status}`);
      }
    } catch (err) {
      console.error(`[SBP] Trigger dispatch error for ${scent.scent_id}:`, err);
    }
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  /**
   * Garbage collect evaporated pheromones
   */
  gc(): number {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [id, p] of this.pheromones) {
      if (isEvaporated(p, now)) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      this.pheromones.delete(id);
    }

    return toRemove.length;
  }

  /**
   * Get raw pheromone count (for testing)
   */
  get size(): number {
    return this.pheromones.size;
  }

  /**
   * Get scent count
   */
  get scentCount(): number {
    return this.scents.size;
  }

  private hashPayload(payload: Record<string, unknown>): string {
    const content = JSON.stringify(payload, Object.keys(payload).sort());
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  private matchTags(tags: string[], filter: TagFilter): boolean {
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

  private pruneEmissionHistory(now: number): void {
    const cutoff = now - this.options.emissionHistoryWindow;
    this.emissionHistory = this.emissionHistory.filter((e) => e.timestamp >= cutoff);
  }
}
