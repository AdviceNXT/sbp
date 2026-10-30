/**
 * Regression tests for the 0.2.1 security fix
 */

import { spawn, spawnSync } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { SbpServer, type ServerOptions } from "./server.js";
import { Blackboard } from "./blackboard.js";

type App = ReturnType<typeof Fastify>;

function rpc(method: string, params: unknown = {}) {
    return { jsonrpc: "2.0", id: 1, method, params };
}

function appOf(server: SbpServer): App {
    return (server as unknown as { app: App }).app;
}

function quiet(options: ServerOptions = {}): SbpServer {
    return new SbpServer({ port: 0, host: "127.0.0.1", logging: false, ...options });
}

const THRESHOLD = {
    type: "threshold",
    trail: "t",
    signal_type: "s",
    aggregation: "max",
    operator: ">=",
    value: 0.1,
};

describe("trace write permission on every route", () => {
    let server: SbpServer;
    let app: App;

    beforeAll(async () => {
        server = quiet({
            auth: { apiKeys: ["reader", "writer"], requireAuth: true, traceWriteKeys: ["writer"] },
        });
        app = appOf(server);
        await app.ready();
    });
    afterAll(() => server.stop());

    const writes = [
        { url: "/inscribe", payload: { trail: "t", key: "k", value: { a: 1 } } },
        { url: "/erase", payload: { trail: "t", key: "k" } },
        { url: "/sbp", payload: rpc("sbp/inscribe", { trail: "t", key: "k", value: { a: 1 } }) },
        { url: "/sbp", payload: rpc("sbp/erase", { trail: "t", key: "k" }) },
        { url: "/rpc", payload: rpc("sbp/inscribe", { trail: "t", key: "k", value: { a: 1 } }) },
        { url: "/rpc", payload: rpc("sbp/erase", { trail: "t", key: "k" }) },
    ];

    it.each(writes)("refuses a read-only key on $url", async ({ url, payload }) => {
        const res = await app.inject({
            method: "POST",
            url,
            headers: { Authorization: "Bearer reader" },
            payload,
        });
        expect(res.statusCode).toBe(403);
    });

    it.each(writes)("refuses a missing key on $url", async ({ url, payload }) => {
        const res = await app.inject({ method: "POST", url, payload });
        expect(res.statusCode).toBe(401);
    });

    it.each(writes)("accepts a write key on $url", async ({ url, payload }) => {
        const res = await app.inject({
            method: "POST",
            url,
            headers: { Authorization: "Bearer writer" },
            payload,
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().error).toBeUndefined();
    });

    it("leaves a trace untouched after a refused erase", async () => {
        await app.inject({
            method: "POST",
            url: "/inscribe",
            headers: { Authorization: "Bearer writer" },
            payload: { trail: "kept", key: "k", value: { a: 1 } },
        });
        await app.inject({
            method: "POST",
            url: "/erase",
            headers: { Authorization: "Bearer reader" },
            payload: { trail: "kept", key: "k" },
        });
        const res = await app.inject({
            method: "POST",
            url: "/read",
            headers: { Authorization: "Bearer reader" },
            payload: { trails: ["kept"] },
        });
        expect(res.json().traces).toHaveLength(1);
    });
});

describe("validation on every route", () => {
    let server: SbpServer;
    let app: App;

    beforeAll(async () => {
        server = quiet();
        app = appOf(server);
        await app.ready();
    });
    afterAll(() => server.stop());

    it.each([
        ["/emit", { trail: "t", type: "s", intensity: 5 }],
        ["/sniff", { limit: -1 }],
        ["/scents", { scent_id: "" }],
        ["/inscribe", { trail: "t" }],
        ["/read", { limit: "many" }],
        ["/erase", { trail: 7 }],
    ])("refuses a malformed body on POST %s with a clear error", async (url, payload) => {
        const res = await app.inject({ method: "POST", url, payload });
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe(-32602);
    });

    it("refuses a bad include on GET /inspect", async () => {
        const res = await app.inject({ method: "GET", url: "/inspect?include=nonsense" });
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe(-32602);
    });

    it("handles a repeated include on GET /inspect without an error", async () => {
        const valid = await app.inject({ method: "GET", url: "/inspect?include=stats&include=trails" });
        expect(valid.statusCode).toBe(200);
        const invalid = await app.inject({ method: "GET", url: "/inspect?include=stats&include=nonsense" });
        expect(invalid.statusCode).toBe(400);
    });

    it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
        "answers method %s with -32601 on /sbp and /rpc",
        async (method) => {
            for (const url of ["/sbp", "/rpc"]) {
                const res = await app.inject({ method: "POST", url, payload: rpc(method) });
                expect(res.json().error.code).toBe(-32601);
            }
        }
    );

    it("refuses a malformed envelope on POST /rpc", async () => {
        const res = await app.inject({ method: "POST", url: "/rpc", payload: { method: 7 } });
        expect(res.json().error.code).toBe(-32600);
    });

    it("refuses bad params on POST /rpc", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/rpc",
            payload: rpc("sbp/emit", { trail: "t", type: "s", intensity: 5 }),
        });
        expect(res.json().error.code).toBe(-32602);
    });

    it("still serves a valid REST call", async () => {
        const emitted = await app.inject({
            method: "POST",
            url: "/emit",
            payload: { trail: "rest", type: "s", intensity: 0.5 },
        });
        expect(emitted.statusCode).toBe(200);
        expect(emitted.json().pheromone_id).toBeDefined();

        const inspected = await app.inject({ method: "GET", url: "/inspect?include=stats" });
        expect(inspected.statusCode).toBe(200);
        expect(inspected.json().stats).toBeDefined();
    });
});

describe("authentication fails closed", () => {
    it.each([{ apiKeys: [] }, {}, { apiKeys: [""] }, { apiKeys: ["good", "  "] }])(
        "refuses to build a server with requireAuth and %j",
        (keys) => {
            expect(() => quiet({ auth: { requireAuth: true, ...keys } })).toThrow(/apiKeys/);
        }
    );

    it("refuses every trace write when traceWriteKeys is empty", async () => {
        const server = quiet({ auth: { apiKeys: ["reader"], requireAuth: true, traceWriteKeys: [] } });
        const app = appOf(server);
        await app.ready();
        const headers = { Authorization: "Bearer reader" };
        const params = { trail: "t", key: "k", value: { a: 1 } };

        const rest = await app.inject({ method: "POST", url: "/inscribe", headers, payload: params });
        expect(rest.statusCode).toBe(403);
        const json = await app.inject({ method: "POST", url: "/sbp", headers, payload: rpc("sbp/inscribe", params) });
        expect(json.statusCode).toBe(403);
        await server.stop();
    });

    function cliEnv(extra: Record<string, string>) {
        const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
        if (!("SBP_API_KEYS" in extra)) delete env.SBP_API_KEYS;
        return env;
    }

    function runCli(args: string[], env: Record<string, string> = {}) {
        return spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
            encoding: "utf8",
            timeout: 20000,
            env: cliEnv(env),
        });
    }

    it.each([
        { args: ["--api-key"], env: {} },
        { args: ["--api-key", ""], env: {} },
        { args: ["--api-key="], env: {} },
        { args: ["--api-key", ","], env: {} },
        { args: ["--api-key"], env: { SBP_API_KEYS: "from-env" } },
        { args: [], env: { SBP_API_KEYS: "" } },
        { args: [], env: { SBP_API_KEYS: " , " } },
        { args: ["--apikey", "typo"], env: {} },
        { args: ["stray"], env: {} },
        { args: ["--rate-limit", "many"], env: {} },
        { args: ["--rate-limit"], env: {} },
        { args: ["--rate-limit", "0"], env: {} },
    ])("the CLI refuses to start on $args $env", ({ args, env }) => {
        const result = runCli(args, env);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Refusing to start");
    });

    it("the CLI enforces a key given as --api-key=value", async () => {
        const port = await new Promise<number>((resolve) => {
            const probe = createServer();
            probe.listen(0, "127.0.0.1", () => {
                const { port } = probe.address() as AddressInfo;
                probe.close(() => resolve(port));
            });
        });
        const child = spawn(
            process.execPath,
            ["--import", "tsx", "src/cli.ts", "--api-key=secret", `--port=${port}`, "--host", "127.0.0.1"],
            { env: cliEnv({}), stdio: ["ignore", "pipe", "inherit"] }
        );
        try {
            await new Promise<void>((resolve, reject) => {
                let output = "";
                child.stdout.on("data", (chunk: Buffer) => {
                    output += chunk.toString();
                    if (output.includes("API key required")) resolve();
                });
                child.on("exit", () => reject(new Error(`exited early: ${output}`)));
            });
            const send = (headers: Record<string, string>) =>
                fetch(`http://127.0.0.1:${port}/sbp`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...headers },
                    body: JSON.stringify(rpc("sbp/sniff")),
                });
            expect((await send({})).status).toBe(401);
            expect((await send({ Authorization: "Bearer secret" })).status).toBe(200);
        } finally {
            child.kill();
        }
    }, 20000);
});

describe("rate limit identity", () => {
    function limited(options: ServerOptions) {
        const server = quiet(options);
        return { server, app: appOf(server) };
    }

    const emit = rpc("sbp/sniff");

    it("gives no fresh bucket for a new Sbp-Agent-Id", async () => {
        const { server, app } = limited({ rateLimit: { maxRequests: 2, windowMs: 60000 } });
        const statuses: number[] = [];
        for (let i = 0; i < 3; i++) {
            const res = await app.inject({
                method: "POST",
                url: "/sbp",
                headers: { "sbp-agent-id": `agent-${i}` },
                payload: emit,
            });
            statuses.push(res.statusCode);
        }
        expect(statuses).toEqual([200, 200, 429]);
        await server.stop();
    });

    it("gives no fresh bucket for an unverified bearer token when auth is off", async () => {
        const { server, app } = limited({ rateLimit: { maxRequests: 1, windowMs: 60000 } });
        const first = await app.inject({
            method: "POST",
            url: "/sbp",
            headers: { Authorization: "Bearer a" },
            payload: emit,
        });
        const second = await app.inject({
            method: "POST",
            url: "/sbp",
            headers: { Authorization: "Bearer b" },
            payload: emit,
        });
        expect([first.statusCode, second.statusCode]).toEqual([200, 429]);
        await server.stop();
    });

    it("gives each verified API key its own bucket", async () => {
        const { server, app } = limited({
            auth: { apiKeys: ["a", "b"], requireAuth: true },
            rateLimit: { maxRequests: 1, windowMs: 60000 },
        });
        const send = (key: string) =>
            app.inject({
                method: "POST",
                url: "/sbp",
                headers: { Authorization: `Bearer ${key}` },
                payload: emit,
            });
        expect((await send("a")).statusCode).toBe(200);
        expect((await send("a")).statusCode).toBe(429);
        expect((await send("b")).statusCode).toBe(200);
        await server.stop();
    });

    it("tracks at most maxBuckets clients, dropping the least recently seen", async () => {
        const { server, app } = limited({
            rateLimit: { maxRequests: 1, windowMs: 60000, maxBuckets: 2 },
        });
        const from = (remoteAddress: string) =>
            app.inject({ method: "POST", url: "/sbp", remoteAddress, payload: emit });

        expect((await from("10.0.0.1")).statusCode).toBe(200);
        expect((await from("10.0.0.1")).statusCode).toBe(429);
        await from("10.0.0.2");
        await from("10.0.0.3");
        // 10.0.0.1 was dropped, so it starts again with a full bucket
        expect((await from("10.0.0.1")).statusCode).toBe(200);
        await server.stop();
    });
});

describe("webhook delivery is refused", () => {
    let server: SbpServer;
    let app: App;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    beforeAll(async () => {
        server = quiet({ evaluationInterval: 5 });
        app = appOf(server);
        await app.ready();
    });
    afterAll(async () => {
        await server.stop();
        fetchSpy.mockRestore();
    });
    afterEach(() => fetchSpy.mockClear());

    const endpoints = [
        "http://169.254.169.254/latest/meta-data",
        "https://example.com/hook",
        "HTTP://127.0.0.1:8080",
        "file:///etc/passwd",
        "not a url",
    ];

    it.each(endpoints)("refuses %s on /sbp, /rpc and /scents", async (agent_endpoint) => {
        const params = { scent_id: "x", agent_endpoint, condition: THRESHOLD };
        for (const url of ["/sbp", "/rpc"]) {
            const res = await app.inject({ method: "POST", url, payload: rpc("sbp/register_scent", params) });
            expect(res.json().error.code).toBe(-32602);
        }
        const rest = await app.inject({ method: "POST", url: "/scents", payload: params });
        expect(rest.statusCode).toBe(400);
        expect(server.blackboard.inspect({ include: ["scents"] }).scents).toEqual([]);
    });

    it("refuses a webhook on an embedded Blackboard", () => {
        const blackboard = new Blackboard();
        expect(() =>
            blackboard.registerScent({
                scent_id: "x",
                agent_endpoint: "https://example.com/hook",
                condition: THRESHOLD as never,
            })
        ).toThrow(/Webhook delivery/);
    });

    it.each(["sse://agent-1", "SSE://agent-1", ""])("accepts endpoint %j and calls nothing out", async (agent_endpoint) => {
        const scent_id = `scent-${agent_endpoint}`;
        const res = await app.inject({
            method: "POST",
            url: "/sbp",
            payload: rpc("sbp/register_scent", { scent_id, agent_endpoint, condition: THRESHOLD }),
        });
        expect(res.json().result.scent_id).toBe(scent_id);

        await app.inject({
            method: "POST",
            url: "/sbp",
            payload: rpc("sbp/emit", { trail: "t", type: "s", intensity: 0.9 }),
        });
        await server.blackboard.evaluateScents();
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

describe("browser origins", () => {
    it("refuses an Origin by default, on every route", async () => {
        const server = quiet();
        const app = appOf(server);
        await app.ready();
        const headers = { Origin: "https://evil.example" };

        const post = await app.inject({ method: "POST", url: "/sbp", headers, payload: rpc("sbp/sniff") });
        expect(post.statusCode).toBe(403);
        expect(post.headers["access-control-allow-origin"]).toBeUndefined();

        const preflight = await app.inject({ method: "OPTIONS", url: "/sbp", headers });
        expect(preflight.statusCode).toBe(403);

        const health = await app.inject({ method: "GET", url: "/health", headers });
        expect(health.statusCode).toBe(403);
        await server.stop();
    });

    it.each([
        ["GET", "/inspect?include=traces"],
        ["GET", "/sbp"],
        ["HEAD", "/health"],
        ["POST", "/sbp"],
    ] as const)("refuses a rebound Host with no Origin on %s %s", async (method, url) => {
        const server = quiet();
        const app = appOf(server);
        await app.ready();
        const res = await app.inject({
            method,
            url,
            headers: { host: "rebind.attacker.example:3000", accept: "text/event-stream" },
            ...(method === "POST" ? { payload: rpc("sbp/sniff") } : {}),
        });
        expect(res.statusCode).toBe(403);
        await server.stop();
    });

    it.each(["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "localhost"])(
        "accepts loopback Host %s",
        async (host) => {
            const server = quiet();
            const app = appOf(server);
            await app.ready();
            const res = await app.inject({ method: "GET", url: "/health", headers: { host } });
            expect(res.statusCode).toBe(200);
            await server.stop();
        }
    );

    it.each(["LOCALHOST", "localhost.", "app.localhost", "127.0.0.2", "127.1", "::1", "::ffff:127.0.0.1", "0:0:0:0:0:0:0:1", "::1%lo0"])(
        "applies the Host check to a server bound to %s",
        async (host) => {
            const server = quiet({ host });
            const app = appOf(server);
            await app.ready();
            const refused = await app.inject({
                method: "GET",
                url: "/inspect?include=traces",
                headers: { host: "rebind.attacker.example:3000" },
            });
            expect(refused.statusCode).toBe(403);
            const allowed = await app.inject({ method: "GET", url: "/health", headers: { host: "LOCALHOST:3000" } });
            expect(allowed.statusCode).toBe(200);
            await server.stop();
        }
    );

    it.each(["127.attacker.example", "localhost.attacker.example", "evil-localhost"])(
        "doesn't take %s for a loopback name",
        async (host) => {
            const server = quiet();
            const app = appOf(server);
            await app.ready();
            const res = await app.inject({ method: "GET", url: "/health", headers: { host } });
            expect(res.statusCode).toBe(403);
            await server.stop();
        }
    );

    it("doesn't apply the Host check to a server bound beyond loopback", async () => {
        const server = quiet({ host: "0.0.0.0" });
        const app = appOf(server);
        await app.ready();
        const res = await app.inject({ method: "GET", url: "/health", headers: { host: "sbp.internal:3000" } });
        expect(res.statusCode).toBe(200);
        await server.stop();
    });

    it("refuses a text/plain body, which a browser can send without preflight", async () => {
        const server = quiet();
        const app = appOf(server);
        await app.ready();
        const res = await app.inject({
            method: "POST",
            url: "/erase",
            headers: { "content-type": "text/plain" },
            payload: JSON.stringify({ trail: "t" }),
        });
        expect(res.statusCode).toBe(400);
        await server.stop();
    });

    it("allows any origin only when cors is enabled", async () => {
        const server = quiet({ cors: true });
        const app = appOf(server);
        await app.ready();
        const res = await app.inject({
            method: "OPTIONS",
            url: "/sbp",
            headers: { Origin: "https://app.example" },
        });
        expect(res.statusCode).toBe(204);
        expect(res.headers["access-control-allow-origin"]).toBe("*");
        await server.stop();
    });
});

describe("a real server on a local port", () => {
    let server: SbpServer;
    let base: string;

    beforeAll(async () => {
        server = quiet({ evaluationInterval: 5 });
        await server.start();
        const { port } = appOf(server).server.address() as AddressInfo;
        base = `http://127.0.0.1:${port}`;
    });
    afterAll(() => server.stop());

    const post = (body: unknown, headers: Record<string, string> = {}) =>
        fetch(`${base}/sbp`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...headers },
            body: JSON.stringify(body),
        });

    it("serves Node's fetch, which sends no Origin", async () => {
        const res = await post(rpc("sbp/sniff"));
        expect(res.status).toBe(200);
        expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("delivers a trigger over SSE to a scent registered with sse://", async () => {
        const session = { "Sbp-Session-Id": "session-1" };
        const controller = new AbortController();
        const stream = await fetch(`${base}/sbp`, {
            headers: { Accept: "text/event-stream", ...session },
            signal: controller.signal,
        });
        expect(stream.headers.get("access-control-allow-origin")).toBeNull();

        await post(
            rpc("sbp/register_scent", {
                scent_id: "sse-delivery",
                agent_endpoint: "sse://agent-1",
                condition: { ...THRESHOLD, trail: "sse" },
            }),
            session
        );
        await post(rpc("sbp/emit", { trail: "sse", type: "s", intensity: 0.9 }));

        const reader = (stream.body as ReadableStream<Uint8Array>).getReader();
        const decoder = new TextDecoder();
        let received = "";
        while (!received.includes("sbp/trigger")) {
            const { value, done } = await reader.read();
            if (done) break;
            received += decoder.decode(value);
        }
        controller.abort();
        expect(received).toContain('"scent_id":"sse-delivery"');
    });
});
