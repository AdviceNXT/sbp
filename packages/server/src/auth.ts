/**
 * SBP Authentication Middleware
 * Basic API key authentication for the SBP server
 */

import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";

export interface AuthOptions {
    /** List of valid API keys (grants access to pheromone operations + trace reads) */
    apiKeys?: string[];
    /** Whether authentication is required (default: false) */
    requireAuth?: boolean;
    /** API keys authorized for trace write operations (inscribe/erase).
     *  If not set, falls back to apiKeys. When set, only these keys
     *  can inscribe or erase traces — all apiKeys can still read. */
    traceWriteKeys?: string[];
}

/** Paths that skip authentication */
const PUBLIC_PATHS = ["/health"];

/**
 * Create a Fastify onRequest hook for API key authentication.
 *
 * Checks the `Authorization: Bearer <key>` header against the
 * configured list of API keys. Returns 401 with SBP error code
 * -32005 (UNAUTHORIZED) if the key is missing or invalid.
 */
export function createAuthHook(options: AuthOptions) {
    const { apiKeys = [], requireAuth = false } = options;

    return function authHook(
        request: FastifyRequest,
        reply: FastifyReply,
        done: HookHandlerDoneFunction
    ): void {
        // Skip auth if not required
        if (!requireAuth || apiKeys.length === 0) {
            done();
            return;
        }

        // Skip auth for public paths and OPTIONS
        const url = request.url.split("?")[0];
        if (PUBLIC_PATHS.includes(url) || request.method === "OPTIONS") {
            done();
            return;
        }

        // Extract bearer token
        const authHeader = request.headers.authorization;
        if (!authHeader) {
            reply.status(401).send({
                jsonrpc: "2.0",
                id: null,
                error: {
                    code: -32005,
                    message: "Unauthorized: Missing Authorization header",
                },
            });
            return;
        }

        const parts = authHeader.split(" ");
        if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
            reply.status(401).send({
                jsonrpc: "2.0",
                id: null,
                error: {
                    code: -32005,
                    message: "Unauthorized: Invalid Authorization header format. Expected: Bearer <api-key>",
                },
            });
            return;
        }

        const token = parts[1];
        if (!apiKeys.includes(token)) {
            reply.status(401).send({
                jsonrpc: "2.0",
                id: null,
                error: {
                    code: -32005,
                    message: "Unauthorized: Invalid API key",
                },
            });
            return;
        }

        // Valid key — attach agent info from token position (optional extension point)
        done();
    };
}

/**
 * Create a preHandler hook for trace write permission enforcement.
 * This runs AFTER body parsing so we can inspect the JSON-RPC method.
 * Only traceWriteKeys can call sbp/inscribe or sbp/erase.
 */
export function createTraceWriteHook(options: AuthOptions) {
    const { traceWriteKeys, requireAuth = false } = options;

    return function traceWriteHook(
        request: FastifyRequest,
        reply: FastifyReply,
        done: HookHandlerDoneFunction
    ): void {
        if (!requireAuth || !traceWriteKeys || traceWriteKeys.length === 0) {
            done();
            return;
        }

        const body = request.body as { method?: string } | undefined;
        const method = body?.method;

        if (method === "sbp/inscribe" || method === "sbp/erase") {
            const authHeader = request.headers.authorization;
            const token = authHeader?.split(" ")[1];

            if (!token || !traceWriteKeys.includes(token)) {
                reply.status(403).send({
                    jsonrpc: "2.0",
                    id: null,
                    error: {
                        code: -32005,
                        message: "Unauthorized: API key does not have trace write permissions",
                    },
                });
                return;
            }
        }

        done();
    };
}

