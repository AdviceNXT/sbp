/**
 * SBP Client - TypeScript/JavaScript SDK
 * Streamable HTTP with SSE (following MCP transport patterns)
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ExponentialDecay {
  type: "exponential";
  half_life_ms: number;
}

export interface LinearDecay {
  type: "linear";
  rate_per_ms: number;
}

export interface ImmortalDecay {
  type: "immortal";
}

export type DecayModel = ExponentialDecay | LinearDecay | ImmortalDecay;

export interface PheromoneSnapshot {
  id: string;
  trail: string;
  type: string;
  current_intensity: number;
  payload: Record<string, unknown>;
  age_ms: number;
  tags: string[];
}

export interface ThresholdCondition {
  type: "threshold";
  trail: string;
  signal_type: string;
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

export type ScentCondition = ThresholdCondition | CompositeCondition | RateCondition;

export interface EmitResult {
  pheromone_id: string;
  action: "created" | "reinforced" | "replaced" | "merged";
  previous_intensity?: number;
  new_intensity: number;
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

export interface RegisterScentResult {
  scent_id: string;
  status: "registered" | "updated";
  current_condition_state: {
    met: boolean;
  };
}

export interface TriggerPayload {
  scent_id: string;
  triggered_at: number;
  condition_snapshot: Record<string, { value: number; pheromone_ids: string[] }>;
  context_pheromones: PheromoneSnapshot[];
  activation_payload: Record<string, unknown>;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function exponentialDecay(halfLifeMs: number): ExponentialDecay {
  return { type: "exponential", half_life_ms: halfLifeMs };
}

export function linearDecay(ratePerMs: number): LinearDecay {
  return { type: "linear", rate_per_ms: ratePerMs };
}

export function immortal(): ImmortalDecay {
  return { type: "immortal" };
}

export function threshold(
  trail: string,
  signalType: string,
  operator: ThresholdCondition["operator"],
  value: number,
  aggregation: ThresholdCondition["aggregation"] = "max"
): ThresholdCondition {
  return {
    type: "threshold",
    trail,
    signal_type: signalType,
    aggregation,
    operator,
    value,
  };
}

export function and(...conditions: ScentCondition[]): CompositeCondition {
  return { type: "composite", operator: "and", conditions };
}

export function or(...conditions: ScentCondition[]): CompositeCondition {
  return { type: "composite", operator: "or", conditions };
}

export function not(condition: ScentCondition): CompositeCondition {
  return { type: "composite", operator: "not", conditions: [condition] };
}

// ============================================================================
// CLIENT
// ============================================================================

export interface SbpClientOptions {
  url?: string;
  agentId?: string;
  timeout?: number;
}

export interface EmitOptions {
  decay?: DecayModel;
  payload?: Record<string, unknown>;
  tags?: string[];
  mergeStrategy?: "reinforce" | "replace" | "max" | "add" | "new";
}

export interface SniffOptions {
  trails?: string[];
  types?: string[];
  minIntensity?: number;
  limit?: number;
  includeEvaporated?: boolean;
}

export interface RegisterScentOptions {
  cooldownMs?: number;
  activationPayload?: Record<string, unknown>;
  triggerMode?: "level" | "edge_rising" | "edge_falling";
  contextTrails?: string[];
}

type TriggerHandler = (payload: TriggerPayload) => void | Promise<void>;

export class SbpClient {
  private url: string;
  private agentId: string;
  private timeout: number;
  private sessionId: string | null = null;
  private sseController: AbortController | null = null;
  private sseHandlers = new Map<string, TriggerHandler>();
  private requestId = 0;
  private lastEventId: string | null = null;

  constructor(options: SbpClientOptions = {}) {
    this.url = options.url ?? "http://localhost:3000";
    this.agentId = options.agentId ?? `agent-${Math.random().toString(36).slice(2, 10)}`;
    this.timeout = options.timeout ?? 30000;
  }

  // ==========================================================================
  // JSON-RPC via POST
  // ==========================================================================

  private async rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Sbp-Protocol-Version": "0.1",
      "Sbp-Agent-Id": this.agentId,
    };

    if (this.sessionId) {
      headers["Sbp-Session-Id"] = this.sessionId;
    }

    const response = await fetch(`${this.url}/sbp`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++this.requestId,
        method,
        params,
      }),
      signal: AbortSignal.timeout(this.timeout),
    });

    // Capture session ID
    const newSessionId = response.headers.get("Sbp-Session-Id");
    if (newSessionId) {
      this.sessionId = newSessionId;
    }

    const data = await response.json() as { result?: T; error?: { code: number; message: string } };

    if (data.error) {
      throw new Error(`SBP Error ${data.error.code}: ${data.error.message}`);
    }

    return data.result as T;
  }

  // ==========================================================================
  // EMIT
  // ==========================================================================

  async emit(
    trail: string,
    type: string,
    intensity: number,
    options: EmitOptions = {}
  ): Promise<EmitResult> {
    return this.rpc<EmitResult>("sbp/emit", {
      trail,
      type,
      intensity,
      decay: options.decay,
      payload: options.payload,
      tags: options.tags,
      merge_strategy: options.mergeStrategy ?? "reinforce",
      source_agent: this.agentId,
    });
  }

  // ==========================================================================
  // SNIFF
  // ==========================================================================

  async sniff(options: SniffOptions = {}): Promise<SniffResult> {
    return this.rpc<SniffResult>("sbp/sniff", {
      trails: options.trails,
      types: options.types,
      min_intensity: options.minIntensity ?? 0,
      limit: options.limit ?? 100,
      include_evaporated: options.includeEvaporated ?? false,
    });
  }

  // ==========================================================================
  // REGISTER_SCENT
  // ==========================================================================

  async registerScent(
    scentId: string,
    condition: ScentCondition,
    options: RegisterScentOptions = {}
  ): Promise<RegisterScentResult> {
    return this.rpc<RegisterScentResult>("sbp/register_scent", {
      scent_id: scentId,
      agent_endpoint: `sse://${this.agentId}`,
      condition,
      cooldown_ms: options.cooldownMs ?? 0,
      activation_payload: options.activationPayload,
      trigger_mode: options.triggerMode ?? "level",
      context_trails: options.contextTrails,
    });
  }

  // ==========================================================================
  // DEREGISTER_SCENT
  // ==========================================================================

  async deregisterScent(scentId: string): Promise<{ scent_id: string; status: string }> {
    return this.rpc("sbp/deregister_scent", { scent_id: scentId });
  }

  // ==========================================================================
  // INSPECT
  // ==========================================================================

  async inspect(include?: string[]): Promise<Record<string, unknown>> {
    return this.rpc("sbp/inspect", { include: include ?? ["trails", "scents", "stats"] });
  }

  // ==========================================================================
  // SSE SUBSCRIPTIONS
  // ==========================================================================

  async subscribe(scentId: string, handler: TriggerHandler): Promise<void> {
    // Register handler
    this.sseHandlers.set(scentId, handler);

    // Tell server we want this scent's triggers
    await this.rpc("sbp/subscribe", { scent_id: scentId });

    // Start SSE listener if not already running
    if (!this.sseController) {
      this.startSSE();
    }
  }

  async unsubscribe(scentId: string): Promise<void> {
    this.sseHandlers.delete(scentId);
    await this.rpc("sbp/unsubscribe", { scent_id: scentId });

    // Stop SSE if no more handlers
    if (this.sseHandlers.size === 0 && this.sseController) {
      this.sseController.abort();
      this.sseController = null;
    }
  }

  private async startSSE(): Promise<void> {
    this.sseController = new AbortController();

    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      "Sbp-Protocol-Version": "0.1",
      "Sbp-Agent-Id": this.agentId,
    };

    if (this.sessionId) {
      headers["Sbp-Session-Id"] = this.sessionId;
    }

    if (this.lastEventId) {
      headers["Last-Event-ID"] = this.lastEventId;
    }

    try {
      const response = await fetch(`${this.url}/sbp`, {
        method: "GET",
        headers,
        signal: this.sseController.signal,
      });

      if (!response.ok || !response.body) {
        console.error("[SBP] Failed to open SSE stream");
        return;
      }

      // Capture session ID
      const newSessionId = response.headers.get("Sbp-Session-Id");
      if (newSessionId) {
        this.sessionId = newSessionId;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventType = "";
      let eventData = "";
      let eventId = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith("id:")) {
            eventId = line.slice(3).trim();
            this.lastEventId = eventId;
          } else if (line.startsWith("data:")) {
            eventData = line.slice(5).trim();
          } else if (line === "" && eventData) {
            // End of event
            this.handleSSEEvent(eventType, eventData);
            eventType = "";
            eventData = "";
            eventId = "";
          }
          // Ignore comment lines starting with ":"
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("[SBP] SSE error:", err);
        // Reconnect after delay
        setTimeout(() => {
          if (this.sseHandlers.size > 0) {
            this.startSSE();
          }
        }, 1000);
      }
    }
  }

  private handleSSEEvent(eventType: string, data: string): void {
    try {
      if (eventType === "message") {
        const msg = JSON.parse(data);
        if (msg.method === "sbp/trigger") {
          const payload = msg.params as TriggerPayload;
          const handler = this.sseHandlers.get(payload.scent_id);
          if (handler) {
            Promise.resolve(handler(payload)).catch((err) => {
              console.error("[SBP] Trigger handler error:", err);
            });
          }
        }
      }
    } catch (err) {
      console.error("[SBP] SSE event parse error:", err);
    }
  }

  async close(): Promise<void> {
    if (this.sseController) {
      this.sseController.abort();
      this.sseController = null;
    }
  }
}

// ============================================================================
// AGENT HELPER
// ============================================================================

export interface AgentOptions extends SbpClientOptions {
  onError?: (error: Error) => void;
}

export class SbpAgent {
  private client: SbpClient;
  private scents: Array<{
    scentId: string;
    condition: ScentCondition;
    handler: TriggerHandler;
    options: RegisterScentOptions;
  }> = [];

  constructor(agentId: string, options: AgentOptions = {}) {
    this.client = new SbpClient({ ...options, agentId });
  }

  when(
    trail: string,
    signalType: string,
    operator: ThresholdCondition["operator"],
    value: number,
    handler: TriggerHandler,
    options: RegisterScentOptions = {}
  ): this {
    const scentId = `${trail}/${signalType}`;
    this.scents.push({
      scentId,
      condition: threshold(trail, signalType, operator, value),
      handler,
      options,
    });
    return this;
  }

  onScent(
    scentId: string,
    condition: ScentCondition,
    handler: TriggerHandler,
    options: RegisterScentOptions = {}
  ): this {
    this.scents.push({ scentId, condition, handler, options });
    return this;
  }

  async emit(
    trail: string,
    type: string,
    intensity: number,
    options?: EmitOptions
  ): Promise<EmitResult> {
    return this.client.emit(trail, type, intensity, options);
  }

  async sniff(options?: SniffOptions): Promise<SniffResult> {
    return this.client.sniff(options);
  }

  async run(): Promise<void> {
    for (const { scentId, condition, handler, options } of this.scents) {
      await this.client.registerScent(scentId, condition, options);
      await this.client.subscribe(scentId, handler);
      console.log(`[SBP Agent] Registered: ${scentId}`);
    }

    console.log(`[SBP Agent] Running with ${this.scents.length} scents`);

    // Keep alive
    await new Promise(() => {});
  }

  async stop(): Promise<void> {
    for (const { scentId } of this.scents) {
      await this.client.deregisterScent(scentId);
    }
    await this.client.close();
  }
}
