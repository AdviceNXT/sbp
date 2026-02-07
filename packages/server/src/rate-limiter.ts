/**
 * SBP Rate Limiting Middleware
 * Token bucket rate limiter per agent ID
 */

import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";

export interface RateLimitOptions {
    /** Maximum requests per window (default: 1000) */
    maxRequests?: number;
    /** Window duration in milliseconds (default: 60000 = 1 minute) */
    windowMs?: number;
    /** Maximum scent registrations per agent (default: 100) */
    maxScentRegistrations?: number;
}

interface TokenBucket {
    tokens: number;
    lastRefill: number;
}

/**
 * Create a Fastify onRequest hook for rate limiting.
 *
 * Uses a token bucket algorithm per agent ID (from `Sbp-Agent-Id` header).
 * Returns JSON-RPC error code -32004 (RATE_LIMITED) when the limit is exceeded.
 */
export function createRateLimitHook(options: RateLimitOptions = {}) {
    const maxRequests = options.maxRequests ?? 1000;
    const windowMs = options.windowMs ?? 60000;
    const buckets = new Map<string, TokenBucket>();

    // Periodic cleanup of stale buckets (every 5 minutes)
    const cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [key, bucket] of buckets.entries()) {
            if (now - bucket.lastRefill > windowMs * 5) {
                buckets.delete(key);
            }
        }
    }, 300000);

    // Allow GC to clean up the interval if the server is stopped
    if (cleanupInterval.unref) {
        cleanupInterval.unref();
    }

    return function rateLimitHook(
        request: FastifyRequest,
        reply: FastifyReply,
        done: HookHandlerDoneFunction
    ): void {
        // Skip rate limiting for health checks and OPTIONS
        const url = request.url.split("?")[0];
        if (url === "/health" || request.method === "OPTIONS") {
            done();
            return;
        }

        // Identify the agent
        const agentId = (request.headers["sbp-agent-id"] as string) || request.ip || "anonymous";

        // Get or create token bucket
        const now = Date.now();
        let bucket = buckets.get(agentId);

        if (!bucket) {
            bucket = { tokens: maxRequests, lastRefill: now };
            buckets.set(agentId, bucket);
        }

        // Refill tokens based on elapsed time
        const elapsed = now - bucket.lastRefill;
        const refillRate = maxRequests / windowMs;
        bucket.tokens = Math.min(maxRequests, bucket.tokens + elapsed * refillRate);
        bucket.lastRefill = now;

        // Check if request is allowed
        if (bucket.tokens < 1) {
            const retryAfterMs = Math.ceil((1 - bucket.tokens) / refillRate);
            reply
                .status(429)
                .header("Retry-After", Math.ceil(retryAfterMs / 1000).toString())
                .send({
                    jsonrpc: "2.0",
                    id: null,
                    error: {
                        code: -32004,
                        message: "Rate limited: Too many requests",
                        data: {
                            retry_after_ms: retryAfterMs,
                            limit: maxRequests,
                            window_ms: windowMs,
                        },
                    },
                });
            return;
        }

        // Consume a token
        bucket.tokens -= 1;
        done();
    };
}
