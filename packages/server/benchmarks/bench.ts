/**
 * SBP Benchmark Suite
 *
 * Measures performance characteristics of the core blackboard operations.
 * Run: npx tsx benchmarks/bench.ts
 */

import { Blackboard } from "../src/blackboard.js";
import { MemoryStore } from "../src/store.js";

// ============================================================================
// HELPERS
// ============================================================================

function formatOps(count: number, durationMs: number): string {
    const opsPerSec = Math.round((count / durationMs) * 1000);
    return `${opsPerSec.toLocaleString()} ops/sec`;
}

function formatDuration(ms: number): string {
    if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
    if (ms < 1000) return `${ms.toFixed(2)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

function runBench(name: string, fn: () => void, iterations: number = 100_000): void {
    // Warmup
    for (let i = 0; i < Math.min(1000, iterations / 10); i++) fn();

    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    const elapsed = performance.now() - start;

    const avg = elapsed / iterations;
    console.log(
        `  ${name.padEnd(45)} ${formatOps(iterations, elapsed).padStart(15)}  (avg ${formatDuration(avg)})`
    );
}

// ============================================================================
// BENCHMARKS
// ============================================================================

function benchEmitNew(): void {
    const bb = new Blackboard();

    console.log("\n📤 EMIT (new pheromone, no merge)");
    let i = 0;
    runBench("emit new pheromone", () => {
        bb.emit({
            trail: "bench.signals",
            type: `type-${i++}`,
            intensity: 0.8,
            merge_strategy: "new",
        });
    }, 50_000);
}

function benchEmitReinforce(): void {
    const bb = new Blackboard();
    bb.emit({
        trail: "bench.signals",
        type: "target",
        intensity: 0.5,
        payload: { key: "value" },
    });

    console.log("\n🔁 EMIT (reinforce existing)");
    runBench("emit reinforce", () => {
        bb.emit({
            trail: "bench.signals",
            type: "target",
            intensity: 0.7,
            payload: { key: "value" },
            merge_strategy: "reinforce",
        });
    }, 50_000);
}

function benchSniff(pheromoneCount: number): void {
    const bb = new Blackboard();
    for (let i = 0; i < pheromoneCount; i++) {
        bb.emit({
            trail: `bench.trail-${i % 10}`,
            type: `type-${i}`,
            intensity: Math.random(),
            merge_strategy: "new",
        });
    }

    console.log(`\n👃 SNIFF (${pheromoneCount.toLocaleString()} pheromones in store)`);

    runBench("sniff all (no filters)", () => {
        bb.sniff({ limit: 100 });
    }, 10_000);

    runBench("sniff single trail", () => {
        bb.sniff({ trails: ["bench.trail-0"], limit: 100 });
    }, 10_000);

    runBench("sniff with min_intensity 0.5", () => {
        bb.sniff({ min_intensity: 0.5, limit: 100 });
    }, 10_000);

    runBench("sniff with tags filter", () => {
        bb.sniff({ tags: { any: ["tag-a"] }, limit: 100 });
    }, 10_000);
}

function benchConditionEvaluation(): void {
    const bb = new Blackboard();
    for (let i = 0; i < 1000; i++) {
        bb.emit({
            trail: "bench.eval",
            type: `signal-${i % 5}`,
            intensity: 0.3 + Math.random() * 0.7,
            merge_strategy: "new",
        });
    }

    // Register a composite scent
    bb.registerScent({
        scent_id: "bench-scent",
        agent_endpoint: "http://localhost:9999",
        condition: {
            type: "composite",
            operator: "and",
            conditions: [
                {
                    type: "threshold",
                    trail: "bench.eval",
                    signal_type: "signal-0",
                    aggregation: "max",
                    operator: ">=",
                    value: 0.7,
                },
                {
                    type: "threshold",
                    trail: "bench.eval",
                    signal_type: "signal-1",
                    aggregation: "count",
                    operator: ">=",
                    value: 3,
                },
            ],
        },
        cooldown_ms: 0,
    });

    console.log("\n🧠 CONDITION EVALUATION (1,000 pheromones, composite AND)");
    runBench("evaluateScents (sync part)", () => {
        // Evaluate without triggering (cooldown = 0 means it fires and resets)
        const pheromones = [...(bb as any).store.values()];
        const { evaluateCondition } = require("../src/conditions.js");
        evaluateCondition(
            {
                type: "composite",
                operator: "and",
                conditions: [
                    {
                        type: "threshold",
                        trail: "bench.eval",
                        signal_type: "signal-0",
                        aggregation: "max",
                        operator: ">=",
                        value: 0.7,
                    },
                    {
                        type: "threshold",
                        trail: "bench.eval",
                        signal_type: "signal-1",
                        aggregation: "count",
                        operator: ">=",
                        value: 3,
                    },
                ],
            },
            { pheromones, now: Date.now(), emissionHistory: [] }
        );
    }, 10_000);
}

function benchGarbageCollection(): void {
    const bb = new Blackboard({ defaultDecay: { type: "linear", rate_per_ms: 100 } });
    for (let i = 0; i < 10_000; i++) {
        bb.emit({
            trail: "bench.gc",
            type: `type-${i}`,
            intensity: 0.5,
            merge_strategy: "new",
        });
    }
    // Let them evaporate
    const delay = (ms: number) => {
        const end = Date.now() + ms;
        while (Date.now() < end) { }
    };
    delay(50);

    console.log("\n🧹 GARBAGE COLLECTION (10,000 evaporated pheromones)");
    const start = performance.now();
    const removed = bb.gc();
    const elapsed = performance.now() - start;
    console.log(`  gc() removed ${removed.toLocaleString()} pheromones in ${formatDuration(elapsed)}`);
}

function benchStoreOperations(): void {
    console.log("\n💾 STORE OPERATIONS (MemoryStore)");
    const store = new MemoryStore();

    runBench("store.set + store.get", () => {
        const p = {
            id: "test-id",
            trail: "bench",
            type: "test",
            emitted_at: Date.now(),
            last_reinforced_at: Date.now(),
            initial_intensity: 0.5,
            decay_model: { type: "exponential" as const, half_life_ms: 300000 },
            payload: {},
            tags: [],
            ttl_floor: 0.01,
        };
        store.set("test-id", p);
        store.get("test-id");
    }, 100_000);

    // Fill store then iterate
    for (let i = 0; i < 10_000; i++) {
        store.set(`p-${i}`, {
            id: `p-${i}`,
            trail: "bench",
            type: "test",
            emitted_at: Date.now(),
            last_reinforced_at: Date.now(),
            initial_intensity: 0.5,
            decay_model: { type: "exponential" as const, half_life_ms: 300000 },
            payload: {},
            tags: [],
            ttl_floor: 0.01,
        });
    }

    runBench("store.values() iteration (10k entries)", () => {
        let count = 0;
        for (const _p of store.values()) count++;
    }, 1_000);
}

// ============================================================================
// MAIN
// ============================================================================

console.log("═══════════════════════════════════════════════════════════════");
console.log("  SBP Benchmark Suite");
console.log("═══════════════════════════════════════════════════════════════");
console.log(`  Node ${process.version} | ${process.platform} ${process.arch}`);
console.log(`  Date: ${new Date().toISOString()}`);
console.log("═══════════════════════════════════════════════════════════════");

benchEmitNew();
benchEmitReinforce();
benchSniff(100);
benchSniff(1_000);
benchSniff(10_000);
benchConditionEvaluation();
benchGarbageCollection();
benchStoreOperations();

console.log("\n═══════════════════════════════════════════════════════════════");
console.log("  Done.");
console.log("═══════════════════════════════════════════════════════════════\n");
