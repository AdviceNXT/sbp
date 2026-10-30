/**
 * SBP Rate Limiting Middleware
 * Token bucket rate limiter per API key or client address
 */

import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";

export interface RateLimitOptions {
    /** Maximum requests per window (default: 1000) */
    maxRequests?: number;
    /** Window duration in milliseconds (default: 60000 = 1 minute) */
    windowMs?: number;
    /** Maximum scent registrations per agent (default: 100) */
    maxScentRegistrations?: number;
    /** Maximum clients tracked at once; the least recently seen is dropped (default: 10000) */
    maxBuckets?: number;
    /** Key on the API key, which the auth hook has already verified. Otherwise key on the client address. */
    keyByApiKey?: boolean;
}

interface TokenBucket {
    tokens: number;
    lastRefill: number;
}

/**
 * Create a Fastify onRequest hook for rate limiting.
 *
 * Uses a token bucket algorithm. The key never comes from a header the client
 * can change freely, or a client could get a fresh bucket on every request.
 * Returns JSON-RPC error code -32004 (RATE_LIMITED) when the limit is exceeded.
 */
export function createRateLimitHook(options: RateLimitOptions = {}) {
    const maxRequests = options.maxRequests ?? 1000;
    const windowMs = options.windowMs ?? 60000;
    const maxBuckets = options.maxBuckets ?? 10000;
    const keyByApiKey = options.keyByApiKey ?? false;
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

        const apiKey = keyByApiKey ? request.headers.authorization?.split(" ")[1] : undefined;
        const clientKey = apiKey ? `key:${apiKey}` : `ip:${request.ip}`;

        // Get or create token bucket, keeping the map in least-recently-seen order
        const now = Date.now();
        const bucket = buckets.get(clientKey) ?? { tokens: maxRequests, lastRefill: now };
        buckets.delete(clientKey);
        buckets.set(clientKey, bucket);

        if (buckets.size > maxBuckets) {
            buckets.delete(buckets.keys().next().value as string);
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
