/**
 * SBP Server Integration Tests
 * Tests HTTP endpoints, validation, auth, and session management
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { SbpServer } from "./server.js";

// -- Helpers --

function rpc(method: string, params: unknown = {}, id: number | string = 1) {
    return { jsonrpc: "2.0", id, method, params };
}

// -- Test Suites --

describe("SBP Server Integration", () => {
    let server: SbpServer;
    let app: ReturnType<typeof Fastify>;

    beforeAll(async () => {
        server = new SbpServer({ port: 0, host: "localhost", logging: false });
        // Access internal Fastify app for inject() testing
        app = (server as unknown as { app: ReturnType<typeof Fastify> }).app;
        await app.ready();
    });

    afterAll(async () => {
        await server.stop();
    });

    // ========================================================================
    // Health endpoint
    // ========================================================================

    describe("GET /health", () => {
        it("returns status ok", async () => {
            const res = await app.inject({ method: "GET", url: "/health" });
            expect(res.statusCode).toBe(200);
            const body = res.json();
            expect(body.status).toBe("ok");
            expect(body.version).toBe("0.1.0");
        });
    });

    // ========================================================================
    // JSON-RPC envelope validation
    // ========================================================================

    describe("JSON-RPC Envelope", () => {
        it("rejects malformed JSON", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/sbp",
                headers: { "Content-Type": "application/json" },
                body: "not json{",
            });
            expect(res.statusCode).toBe(400); // Fastify returns 400 for unparseable body
        });

        it("rejects missing jsonrpc field", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/sbp",
                payload: { id: 1, method: "sbp/sniff", params: {} },
            });
            const body = res.json();
            expect(body.error).toBeDefined();
            expect(body.error.code).toBe(-32600);
        });

        it("rejects unknown method", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/sbp",
                payload: rpc("sbp/unknown"),
            });
            const body = res.json();
            expect(body.error).toBeDefined();
            expect(body.error.code).toBe(-32601);
        });
    });

    // ========================================================================
    // sbp/emit
    // ========================================================================

    describe("sbp/emit", () => {
        it("creates a new pheromone", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/sbp",
                payload: rpc("sbp/emit", {
                    trail: "test/integration",
                    type: "signal",
                    intensity: 0.8,
                }),
            });
            const body = res.json();
            expect(body.result).toBeDefined();
            expect(body.result.action).toBe("created");
            expect(body.result.pheromone_id).toBeTruthy();
            expect(body.result.new_intensity).toBe(0.8);
        });

        it("validates intensity range", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/sbp",
                payload: rpc("sbp/emit", {
                    trail: "test",
                    type: "signal",
                    intensity: 2.0, // Invalid: > 1
                }),
            });
            const body = res.json();
            expect(body.error).toBeDefined();
            expect(body.error.code).toBe(-32602);
        });

        it("rejects empty trail", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/sbp",
                payload: rpc("sbp/emit", {
                    trail: "",
                    type: "signal",
                    intensity: 0.5,
                }),
            });
            const body = res.json();
            expect(body.error).toBeDefined();
            expect(body.error.code).toBe(-32602);
        });

        it("supports merge strategies", async () => {
            // First emit
            await app.inject({
                method: "POST",
                url: "/sbp",
                payload: rpc("sbp/emit", {
                    trail: "merge/test",
                    type: "alpha",
                    intensity: 0.5,
                    merge_strategy: "new",
                }),
            });

            // Second emit with replace
            const res = await app.inject({
                method: "POST",
                url: "/sbp",
                payload: rpc("sbp/emit", {
                    trail: "merge/test",
                    type: "alpha",
                    intensity: 0.9,
                    merge_strategy: "replace",
                }),
            });
            const body = res.json();
            expect(body.result.action).toBe("replaced");
        });
    });

    // ========================================================================
    // sbp/sniff
    // ========================================================================

    describe("sbp/sniff", () => {
        beforeEach(async () => {
            // Emit a test pheromone
            await app.inject({
                method: "POST",
                url: "/sbp",
                payload: rpc("sbp/emit", {
                    trail: "sniff/test",
                    type: "data",
                    intensity: 0.7,
                    tags: ["important"],
                }),
            });
        });

        it("returns pheromones matching trail filter", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/sbp",
                payload: rpc("sbp/sniff", {
                    trails: ["sniff/test"],
                }),
            });
            const body = res.json();
            expect(body.result).toBeDefined();
            expect(body.result.pheromones.length).toBeGreaterThan(0);
            expect(body.result.pheromones[0].trail).toBe("sniff/test");
        });

        it("filters by min_intensity", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/sbp",
                payload: rpc("sbp/sniff", {
                    trails: ["sniff/test"],
                    min_intensity: 0.99,
                }),
            });
            const body = res.json();
            expect(body.result.pheromones.length).toBe(0);
        });

        it("filters by type", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/sbp",
                payload: rpc("sbp/sniff", {
                    trails: ["sniff/test"],
                    types: ["nonexistent"],
                }),
            });
            const body = res.json();
            expect(body.result.pheromones.length).toBe(0);
        });

        it("includes aggregates", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/sbp",
                payload: rpc("sbp/sniff", { trails: ["sniff/test"] }),
            });
            const body = res.json();
            expect(body.result.aggregates).toBeDefined();
        });
    });

    // ========================================================================
    // sbp/register_scent + sbp/deregister_scent
    // ========================================================================

    describe("sbp/register_scent & sbp/deregister_scent", () => {
        it("registers a scent", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/sbp",
                payload: rpc("sbp/register_scent", {
                    scent_id: "test-scent-1",
                    condition: {
                        type: "threshold",
                        trail: "test",
                        signal_type: "alert",
                        aggregation: "any",
                        operator: ">=",
                        value: 0.5,
                    },
                }),
            });
            const body = res.json();
            expect(body.result.scent_id).toBe("test-scent-1");
            expect(body.result.status).toBe("registered");
        });

        it("deregisters a scent", async () => {
            // Register first
            await app.inject({
                method: "POST",
                url: "/sbp",
                payload: rpc("sbp/register_scent", {
                    scent_id: "to-deregister",
                    condition: {
                        type: "threshold",
                        trail: "test",
                        signal_type: "alert",
                        aggregation: "any",
                        operator: ">=",
                        value: 0.5,
                    },
                }),
            });

            const res = await app.inject({
                method: "POST",
                url: "/sbp",
                payload: rpc("sbp/deregister_scent", { scent_id: "to-deregister" }),
            });
            const body = res.json();
            expect(body.result.status).toBe("deregistered");
        });

        it("returns not_found for unknown scent", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/sbp",
                payload: rpc("sbp/deregister_scent", { scent_id: "doesnt-exist" }),
            });
            const body = res.json();
            expect(body.result.status).toBe("not_found");
        });
    });

    // ========================================================================
    // sbp/evaporate
    // ========================================================================

    describe("sbp/evaporate", () => {
        it("evaporates pheromones by trail", async () => {
            // Emit
            await app.inject({
                method: "POST",
                url: "/sbp",
                payload: rpc("sbp/emit", {
                    trail: "evap/test",
                    type: "temp",
                    intensity: 0.5,
                }),
            });

            // Evaporate
            const res = await app.inject({
                method: "POST",
                url: "/sbp",
                payload: rpc("sbp/evaporate", { trail: "evap/test" }),
            });
            const body = res.json();
            expect(body.result.evaporated_count).toBeGreaterThan(0);

            // Verify gone
            const sniffRes = await app.inject({
                method: "POST",
                url: "/sbp",
                payload: rpc("sbp/sniff", { trails: ["evap/test"] }),
            });
            expect(sniffRes.json().result.pheromones.length).toBe(0);
        });
    });

    // ========================================================================
    // sbp/inspect
    // ========================================================================

    describe("sbp/inspect", () => {
        it("returns trails, scents, and stats", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/sbp",
                payload: rpc("sbp/inspect", {
                    include: ["trails", "scents", "stats"],
                }),
            });
            const body = res.json();
            expect(body.result.trails).toBeDefined();
            expect(body.result.scents).toBeDefined();
            expect(body.result.stats).toBeDefined();
            expect(body.result.stats.uptime_ms).toBeGreaterThanOrEqual(0);
        });
    });

    // ========================================================================
    // Session management
    // ========================================================================

    describe("Session Management", () => {
        it("assigns session ID when none provided", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/sbp",
                payload: rpc("sbp/sniff"),
            });
            const sessionId = res.headers["sbp-session-id"];
            expect(sessionId).toBeTruthy();
        });
    });
});

// ============================================================================
// Authentication Tests
// ============================================================================

describe("SBP Server Authentication", () => {
    let server: SbpServer;
    let app: ReturnType<typeof Fastify>;

    beforeAll(async () => {
        server = new SbpServer({
            port: 0,
            host: "localhost",
            logging: false,
            auth: { apiKeys: ["test-key-123", "test-key-456"], requireAuth: true },
        });
        app = (server as unknown as { app: ReturnType<typeof Fastify> }).app;
        await app.ready();
    });

    afterAll(async () => {
        await server.stop();
    });

    it("rejects requests without Authorization header", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/sbp",
            payload: rpc("sbp/sniff"),
        });
        expect(res.statusCode).toBe(401);
        const body = res.json();
        expect(body.error.code).toBe(-32005);
    });

    it("rejects invalid API key", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/sbp",
            headers: { Authorization: "Bearer wrong-key" },
            payload: rpc("sbp/sniff"),
        });
        expect(res.statusCode).toBe(401);
    });

    it("accepts valid API key", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/sbp",
            headers: { Authorization: "Bearer test-key-123" },
            payload: rpc("sbp/sniff"),
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().result).toBeDefined();
    });

    it("allows health check without auth", async () => {
        const res = await app.inject({
            method: "GET",
            url: "/health",
        });
        expect(res.statusCode).toBe(200);
    });
});
