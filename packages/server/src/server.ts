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
} from "./types.js";
import { randomUUID } from "crypto";

export interface ServerOptions extends BlackboardOptions {
  /** HTTP port (default: 3000) */
  port?: number;
  /** Host to bind to (default: localhost) */
  host?: string;
  /** Enable CORS (default: true) */
  cors?: boolean;
  /** Request logging (default: false) */
  logging?: boolean;
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
  private options: Required<ServerOptions>;
  private sseClients = new Map<string, SSEClient>();
  private sessions = new Map<string, { agentId: string; createdAt: number }>();
  private eventCounter = 0;

  constructor(options: ServerOptions = {}) {
    this.options = {
      port: options.port ?? 3000,
      host: options.host ?? "localhost",
      cors: options.cors ?? true,
      logging: options.logging ?? false,
      evaluationInterval: options.evaluationInterval ?? 100,
      defaultDecay: options.defaultDecay ?? { type: "exponential", half_life_ms: 300000 },
      defaultTtlFloor: options.defaultTtlFloor ?? 0.01,
      maxPheromones: options.maxPheromones ?? 100000,
      trackEmissionHistory: options.trackEmissionHistory ?? true,
      emissionHistoryWindow: options.emissionHistoryWindow ?? 60000,
    };

    this.blackboard = new Blackboard(this.options);
    this.app = Fastify({ logger: this.options.logging });

    this.setupRoutes();
  }

  private setupRoutes(): void {
    // CORS
    if (this.options.cors) {
      this.app.addHook("onRequest", async (request, reply) => {
        reply.header("Access-Control-Allow-Origin", "*");
        reply.header("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
        reply.header(
          "Access-Control-Allow-Headers",
          "Content-Type, Accept, Sbp-Protocol-Version, Sbp-Session-Id, Sbp-Agent-Id, Last-Event-ID"
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
        version: "0.1.0",
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
      const body = request.body as JsonRpcRequest;
      const response = await this.handleRpc(body, request);
      reply.header("Content-Type", "application/json");
      return response;
    });

    // Convenience REST endpoints
    this.app.post("/emit", async (request) => {
      const params = request.body as EmitParams;
      return this.blackboard.emit(params);
    });

    this.app.post("/sniff", async (request) => {
      const params = request.body as SniffParams;
      return this.blackboard.sniff(params);
    });

    this.app.post("/scents", async (request) => {
      const params = request.body as RegisterScentParams;
      return this.blackboard.registerScent(params);
    });

    this.app.delete("/scents/:scent_id", async (request) => {
      const { scent_id } = request.params as { scent_id: string };
      return this.blackboard.deregisterScent({ scent_id });
    });

    this.app.get("/inspect", async (request) => {
      const query = request.query as { include?: string };
      const include = query.include?.split(",") as InspectParams["include"];
      return this.blackboard.inspect({ include });
    });
  }

  /**
   * Handle POST requests (client -> server messages)
   */
  private async handlePost(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
    const body = request.body as JsonRpcRequest;

    // Get or create session
    let sessionId = request.headers["sbp-session-id"] as string | undefined;
    if (!sessionId) {
      sessionId = randomUUID();
      this.sessions.set(sessionId, {
        agentId: (request.headers["sbp-agent-id"] as string) || "unknown",
        createdAt: Date.now(),
      });
    }

    // Handle JSON-RPC request
    const response = await this.handleRpc(body, request);

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

    const sessionId = (request.headers["sbp-session-id"] as string) || randomUUID();
    const lastEventId = request.headers["last-event-id"] as string | undefined;
    const clientId = randomUUID();

    // Set up SSE headers
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Sbp-Session-Id": sessionId,
      "Access-Control-Allow-Origin": "*",
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

          // Set up SSE trigger forwarding for this session
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
