/**
 * SBP HTTP Server
 * Streamable HTTP with SSE (following MCP transport patterns)
 */

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Blackboard, BlackboardOptions } from "./blackboard.js";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  EmitParams,
  SniffParams,
  RegisterScentParams,
  DeregisterScentParams,
  EvaporateParams,
  InspectParams,
  TriggerPayload,
  InscribeParams,
  ReadParams,
  EraseParams,
} from "./types.js";
import { v7 as uuidv7 } from "uuid";
import { validateEnvelope, validateParams } from "./validation.js";
import { createAuthHook, createTraceWriteHook, type AuthOptions } from "./auth.js";
import { createRateLimitHook, type RateLimitOptions } from "./rate-limiter.js";

export interface ServerOptions extends BlackboardOptions {
  /** HTTP port (default: 3000) */
  port?: number;
  /** Host to bind to (default: localhost) */
  host?: string;
  /** Allow browser pages on any origin to call this server (default: false) */
  cors?: boolean;
  /** Request logging (default: false) */
  logging?: boolean;
  /** Authentication options */
  auth?: AuthOptions;
  /** Rate limiting options */
  rateLimit?: RateLimitOptions;
}

function isLoopbackHost(host: string): boolean {
  // A bound IPv6 address may carry a zone (::1%lo0), which URL doesn't accept
  const literal = host.includes(":") && !host.startsWith("[") ? `[${host.split("%")[0]}]` : host;
  if (!URL.canParse(`http://${literal}`)) return false;

  // URL normalizes case and every spelling of an IP address
  const name = new URL(`http://${literal}`).hostname.replace(/\.$/, "");
  return (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name === "[::1]" ||
    /^127\.\d+\.\d+\.\d+$/.test(name) ||
    /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(name)
  );
}

interface SSEClient {
  id: string;
  sessionId: string;
  reply: FastifyReply;
  scents: Set<string>;
  lastEventId: number;
}

export class SbpServer {
  private app: FastifyInstance;
  public readonly blackboard: Blackboard;
  private options: Required<Omit<ServerOptions, "auth" | "rateLimit" | "store" | "traceStore">> & {
    auth?: AuthOptions;
    rateLimit?: RateLimitOptions;
  };
  private sseClients = new Map<string, SSEClient>();
  private eventCounter = 0;

  constructor(options: ServerOptions = {}) {
    const { requireAuth, apiKeys } = options.auth ?? {};
    if (requireAuth && (!apiKeys?.length || apiKeys.some((key) => !key.trim()))) {
      throw new Error("requireAuth is set but apiKeys is empty or holds a blank key");
    }

    this.options = {
      port: options.port ?? 3000,
      host: options.host ?? "localhost",
      cors: options.cors ?? false,
      logging: options.logging ?? false,
      evaluationInterval: options.evaluationInterval ?? 100,
      defaultDecay: options.defaultDecay ?? { type: "exponential", half_life_ms: 300000 },
      defaultTtlFloor: options.defaultTtlFloor ?? 0.01,
      maxPheromones: options.maxPheromones ?? 100000,
      trackEmissionHistory: options.trackEmissionHistory ?? true,
      emissionHistoryWindow: options.emissionHistoryWindow ?? 60000,
      auth: options.auth,
      rateLimit: options.rateLimit,
    };

    this.blackboard = new Blackboard(this.options);
    this.app = Fastify({ logger: this.options.logging });

    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Without CORS, a web page mustn't reach this server. A cross-origin request
    // carries Origin. A page that rebinds its DNS name to a loopback server is
    // same-origin and can omit Origin, but its Host still names the attacker.
    if (!this.options.cors) {
      const loopbackOnly = isLoopbackHost(this.options.host);
      this.app.addHook("onRequest", async (request, reply) => {
        const rebound = loopbackOnly && !isLoopbackHost(request.hostname);
        if (request.headers.origin !== undefined || rebound) {
          reply.status(403).send({
            jsonrpc: "2.0",
            id: null,
            error: {
              code: -32005,
              message: "Forbidden: browser requests are refused unless the server enables cors",
            },
          });
          return reply;
        }
      });
    }

    // Authentication hook
    if (this.options.auth?.requireAuth) {
      this.app.addHook("onRequest", createAuthHook(this.options.auth));
      this.app.addHook("preHandler", createTraceWriteHook(this.options.auth));
    }

    // Rate limiting hook
    if (this.options.rateLimit) {
      this.app.addHook(
        "onRequest",
        createRateLimitHook({
          ...this.options.rateLimit,
          keyByApiKey: this.options.auth?.requireAuth ?? false,
        })
      );
    }

    // CORS
    if (this.options.cors) {
      this.app.addHook("onRequest", async (request, reply) => {
        reply.header("Access-Control-Allow-Origin", "*");
        reply.header("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
        reply.header(
          "Access-Control-Allow-Headers",
          "Content-Type, Accept, Authorization, Sbp-Protocol-Version, Sbp-Session-Id, Sbp-Agent-Id, Last-Event-ID"
        );

        if (request.method === "OPTIONS") {
          reply.status(204).send();
        }
      });
    }

    // Health check
    this.app.get("/health", async () => {
      const stats = this.blackboard.inspect({ include: ["stats"] });
      return {
        status: "ok",
        version: "0.2.1",
        transport: "streamable-http-sse",
        ...stats.stats,
      };
    });

    // Main SBP endpoint - POST for client->server messages
    this.app.post("/sbp", async (request: FastifyRequest, reply: FastifyReply) => {
      return this.handlePost(request, reply);
    });

    // Main SBP endpoint - GET for SSE stream (server->client)
    this.app.get("/sbp", async (request: FastifyRequest, reply: FastifyReply) => {
      return this.handleSSE(request, reply);
    });

    // Legacy JSON-RPC endpoint (for backwards compatibility)
    this.app.post("/rpc", async (request: FastifyRequest, reply: FastifyReply) => {
      return this.handlePost(request, reply);
    });

    // Convenience REST endpoints
    this.app.post("/emit", async (request, reply) => {
      return this.handleRest("sbp/emit", request.body, request, reply);
    });

    this.app.post("/sniff", async (request, reply) => {
      return this.handleRest("sbp/sniff", request.body, request, reply);
    });

    this.app.post("/scents", async (request, reply) => {
      return this.handleRest("sbp/register_scent", request.body, request, reply);
    });

    this.app.delete("/scents/:scent_id", async (request, reply) => {
      const { scent_id } = request.params as { scent_id: string };
      return this.handleRest("sbp/deregister_scent", { scent_id }, request, reply);
    });

    this.app.get("/inspect", async (request, reply) => {
      const { include } = request.query as { include?: unknown };
      return this.handleRest(
        "sbp/inspect",
        { include: typeof include === "string" ? include.split(",") : include },
        request,
        reply
      );
    });

    // Convenience REST endpoints - Traces
    this.app.post("/inscribe", async (request, reply) => {
      return this.handleRest("sbp/inscribe", request.body, request, reply);
    });

    this.app.post("/read", async (request, reply) => {
      return this.handleRest("sbp/read", request.body, request, reply);
    });

    this.app.post("/erase", async (request, reply) => {
      return this.handleRest("sbp/erase", request.body, request, reply);
    });
  }

  /**
   * Handle a REST convenience route: same validator and handler as JSON-RPC
   */
  private async handleRest(
    method: string,
    params: unknown,
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<unknown> {
    const paramsResult = validateParams(method, params);
    if (!paramsResult.ok) {
      reply.status(400);
      return { jsonrpc: "2.0", id: null, error: paramsResult.error };
    }

    const response = await this.handleRpc(
      { jsonrpc: "2.0", id: 0, method, params: paramsResult.params },
      request
    );
    if ("error" in response) {
      reply.status(500);
      return { jsonrpc: "2.0", id: null, error: response.error };
    }
    return response.result;
  }

  /**
   * Handle POST requests (client -> server messages)
   */
  private async handlePost(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
    // Validate JSON-RPC envelope
    const envelopeResult = validateEnvelope(request.body);
    if (!envelopeResult.ok) {
      reply.header("Content-Type", "application/json");
      return {
        jsonrpc: "2.0",
        id: null,
        error: envelopeResult.error,
      };
    }

    const body = envelopeResult.request;

    // Validate method-specific params
    const paramsResult = validateParams(body.method, body.params);
    if (!paramsResult.ok) {
      reply.header("Content-Type", "application/json");
      return {
        jsonrpc: "2.0",
        id: body.id,
        error: paramsResult.error,
      };
    }

    // Replace params with validated (parsed) params
    const validatedRequest: JsonRpcRequest = {
      ...body,
      params: paramsResult.params,
    };

    const sessionId = (request.headers["sbp-session-id"] as string | undefined) || uuidv7();

    // Handle JSON-RPC request
    const response = await this.handleRpc(validatedRequest, request);

    // Set session header
    reply.header("Sbp-Session-Id", sessionId);
    reply.header("Content-Type", "application/json");

    return response;
  }

  /**
   * Handle GET requests - open SSE stream for triggers
   */
  private async handleSSE(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const accept = request.headers.accept || "";

    if (!accept.includes("text/event-stream")) {
      reply.status(406).send({ error: "Accept header must include text/event-stream" });
      return;
    }

    const sessionId = (request.headers["sbp-session-id"] as string) || uuidv7();
    const lastEventId = request.headers["last-event-id"] as string | undefined;
    const clientId = uuidv7();

    // Set up SSE headers
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Sbp-Session-Id": sessionId,
      ...(this.options.cors ? { "Access-Control-Allow-Origin": "*" } : {}),
    });

    // Register SSE client
    const client: SSEClient = {
      id: clientId,
      sessionId,
      reply,
      scents: new Set(),
      lastEventId: lastEventId ? parseInt(lastEventId, 10) : 0,
    };
    this.sseClients.set(clientId, client);

    // Send initial connection event
    this.sendSSEEvent(client, "connected", { client_id: clientId, session_id: sessionId });

    // Handle client disconnect
    request.raw.on("close", () => {
      this.sseClients.delete(clientId);
      // Unregister scent handlers for this client
      for (const scentId of client.scents) {
        this.blackboard.offTrigger(scentId);
      }
    });

    // Keep connection alive with periodic comments
    const keepAlive = setInterval(() => {
      if (reply.raw.writable) {
        reply.raw.write(": keepalive\n\n");
      } else {
        clearInterval(keepAlive);
      }
    }, 30000);

    request.raw.on("close", () => clearInterval(keepAlive));
  }

  /**
   * Send an SSE event to a client
   */
  private sendSSEEvent(client: SSEClient, event: string, data: unknown): void {
    if (!client.reply.raw.writable) return;

    const eventId = ++this.eventCounter;
    const payload = JSON.stringify(data);

    client.reply.raw.write(`event: ${event}\n`);
    client.reply.raw.write(`id: ${eventId}\n`);
    client.reply.raw.write(`data: ${payload}\n\n`);

    client.lastEventId = eventId;
  }

  /**
   * Send a JSON-RPC notification via SSE
   */
  private sendSSENotification(client: SSEClient, method: string, params: unknown): void {
    const message = {
      jsonrpc: "2.0",
      method,
      params,
    };
    this.sendSSEEvent(client, "message", message);
  }

  /**
   * Handle JSON-RPC requests
   */
  private async handleRpc(request: JsonRpcRequest, httpRequest: FastifyRequest): Promise<JsonRpcResponse> {
    const { id, method, params } = request;
    const sessionId = httpRequest.headers["sbp-session-id"] as string | undefined;

    try {
      let result: unknown;

      switch (method) {
        case "sbp/emit":
          result = this.blackboard.emit(params as EmitParams);
          break;

        case "sbp/sniff":
          result = this.blackboard.sniff(params as SniffParams);
          break;

        case "sbp/register_scent": {
          const scentParams = params as RegisterScentParams;
          result = this.blackboard.registerScent(scentParams);

          // Set up trigger forwarding
          if (sessionId) {
            this.setupSSETrigger(scentParams.scent_id, sessionId);
          }
          break;
        }

        case "sbp/deregister_scent":
          result = this.blackboard.deregisterScent(params as DeregisterScentParams);
          break;

        case "sbp/evaporate":
          result = this.blackboard.evaporate(params as EvaporateParams);
          break;

        case "sbp/inspect":
          result = this.blackboard.inspect(params as InspectParams);
          break;

        case "sbp/inscribe":
          result = this.blackboard.inscribe(params as InscribeParams);
          break;

        case "sbp/read":
          result = this.blackboard.read(params as ReadParams);
          break;

        case "sbp/erase":
          result = this.blackboard.erase(params as EraseParams);
          break;

        case "sbp/subscribe": {
          // Subscribe to scent triggers (used after SSE stream is open)
          const { scent_id } = params as { scent_id: string };
          if (sessionId) {
            this.setupSSETrigger(scent_id, sessionId);
            // Mark scent subscription for all clients in this session
            for (const client of this.sseClients.values()) {
              if (client.sessionId === sessionId) {
                client.scents.add(scent_id);
              }
            }
          }
          result = { subscribed: scent_id };
          break;
        }

        case "sbp/unsubscribe": {
          const { scent_id } = params as { scent_id: string };
          this.blackboard.offTrigger(scent_id);
          // Remove from client scent sets
          for (const client of this.sseClients.values()) {
            if (client.sessionId === sessionId) {
              client.scents.delete(scent_id);
            }
          }
          result = { unsubscribed: scent_id };
          break;
        }

        default:
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32601,
              message: "Method not found",
              data: { method },
            },
          };
      }

      return {
        jsonrpc: "2.0",
        id,
        result,
      };
    } catch (err) {
      const error = err as Error;
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: error.message,
        },
      };
    }
  }

  /**
   * Set up trigger forwarding to SSE clients
   */
  private setupSSETrigger(scentId: string, sessionId: string): void {
    this.blackboard.onTrigger(scentId, async (payload: TriggerPayload) => {
      // Send to all SSE clients in this session
      for (const client of this.sseClients.values()) {
        if (client.sessionId === sessionId || client.scents.has(scentId)) {
          this.sendSSENotification(client, "sbp/trigger", payload);
        }
      }
    });
  }

  async start(): Promise<void> {
    // Start blackboard evaluation loop
    this.blackboard.start();

    // Start HTTP server
    await this.app.listen({ port: this.options.port, host: this.options.host });

    console.log(`[SBP] Server listening on http://${this.options.host}:${this.options.port}`);
    console.log(`[SBP] Streamable HTTP endpoint: POST/GET ${this.address}/sbp`);
    console.log(`[SBP] Transport: SSE (Server-Sent Events)`);
    if (this.options.auth?.requireAuth) {
      console.log(`[SBP] Authentication: API key required`);
    } else if (!isLoopbackHost(this.options.host)) {
      console.warn(`[SBP] Warning: listening on ${this.options.host} with no authentication`);
    }
    if (this.options.rateLimit) {
      console.log(`[SBP] Rate limiting: ${this.options.rateLimit.maxRequests ?? 1000} req/${(this.options.rateLimit.windowMs ?? 60000) / 1000}s`);
    }
  }

  async stop(): Promise<void> {
    this.blackboard.stop();

    // Close all SSE connections
    for (const client of this.sseClients.values()) {
      if (client.reply.raw.writable) {
        client.reply.raw.end();
      }
    }
    this.sseClients.clear();

    await this.app.close();
    console.log("[SBP] Server stopped");
  }

  get address(): string {
    return `http://${this.options.host}:${this.options.port}`;
  }
}
