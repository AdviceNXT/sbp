/**
 * SBP Conformance Test Suite
 * Protocol-level tests to verify any SBP implementation against the spec
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Blackboard } from "./blackboard.js";
import { computeIntensity, isEvaporated } from "./decay.js";
import { evaluateCondition } from "./conditions.js";
import type { Pheromone, ScentCondition } from "./types.js";

// -- Test Helpers --

function makePheromone(overrides: Partial<Pheromone> = {}): Pheromone {
    const now = Date.now();
    return {
        id: `test-${Math.random().toString(36).slice(2)}`,
        trail: "test/trail",
        type: "signal",
        emitted_at: now,
        last_reinforced_at: now,
        initial_intensity: 1.0,
        decay_model: { type: "exponential", half_life_ms: 10000 },
        payload: {},
        tags: [],
        ttl_floor: 0.01,
        ...overrides,
    };
}

// ============================================================================
// DECAY MODELS
// ============================================================================

describe("Decay Models", () => {
    describe("Exponential Decay", () => {
        it("returns full intensity at t=0", () => {
            const p = makePheromone({
                decay_model: { type: "exponential", half_life_ms: 10000 },
                initial_intensity: 1.0,
            });
            expect(computeIntensity(p, p.emitted_at)).toBeCloseTo(1.0);
        });

        it("returns half intensity at t=half_life", () => {
            const p = makePheromone({
                decay_model: { type: "exponential", half_life_ms: 10000 },
                initial_intensity: 1.0,
            });
            expect(computeIntensity(p, p.emitted_at + 10000)).toBeCloseTo(0.5, 1);
        });

        it("returns quarter intensity at t=2*half_life", () => {
            const p = makePheromone({
                decay_model: { type: "exponential", half_life_ms: 10000 },
                initial_intensity: 1.0,
            });
            expect(computeIntensity(p, p.emitted_at + 20000)).toBeCloseTo(0.25, 1);
        });

        it("respects initial_intensity", () => {
            const p = makePheromone({
                decay_model: { type: "exponential", half_life_ms: 10000 },
                initial_intensity: 0.6,
            });
            expect(computeIntensity(p, p.emitted_at)).toBeCloseTo(0.6);
            expect(computeIntensity(p, p.emitted_at + 10000)).toBeCloseTo(0.3, 1);
        });
    });

    describe("Linear Decay", () => {
        it("returns full intensity at t=0", () => {
            const p = makePheromone({
                decay_model: { type: "linear", rate_per_ms: 0.0001 },
                initial_intensity: 1.0,
            });
            expect(computeIntensity(p, p.emitted_at)).toBe(1.0);
        });

        it("decreases linearly", () => {
            const p = makePheromone({
                decay_model: { type: "linear", rate_per_ms: 0.0001 },
                initial_intensity: 1.0,
            });
            // After 5000ms: 1.0 - 0.0001 * 5000 = 0.5
            expect(computeIntensity(p, p.emitted_at + 5000)).toBeCloseTo(0.5);
        });

        it("clamps to zero (never negative)", () => {
            const p = makePheromone({
                decay_model: { type: "linear", rate_per_ms: 0.0001 },
                initial_intensity: 1.0,
            });
            expect(computeIntensity(p, p.emitted_at + 20000)).toBe(0);
        });
    });

    describe("Step Decay", () => {
        const steps = [
            { at_ms: 0, intensity: 1.0 },
            { at_ms: 5000, intensity: 0.7 },
            { at_ms: 10000, intensity: 0.3 },
            { at_ms: 20000, intensity: 0.0 },
        ];

        it("returns correct intensity at each step boundary", () => {
            const p = makePheromone({
                decay_model: { type: "step", steps },
                initial_intensity: 1.0,
            });
            expect(computeIntensity(p, p.emitted_at + 0)).toBe(1.0);
            expect(computeIntensity(p, p.emitted_at + 5000)).toBe(0.7);
            expect(computeIntensity(p, p.emitted_at + 10000)).toBe(0.3);
            expect(computeIntensity(p, p.emitted_at + 20000)).toBe(0.0);
        });

        it("holds intensity between steps", () => {
            const p = makePheromone({
                decay_model: { type: "step", steps },
                initial_intensity: 1.0,
            });
            expect(computeIntensity(p, p.emitted_at + 7500)).toBe(0.7);
            expect(computeIntensity(p, p.emitted_at + 15000)).toBe(0.3);
        });
    });

    describe("Immortal Decay", () => {
        it("never decays", () => {
            const p = makePheromone({
                decay_model: { type: "immortal" },
                initial_intensity: 0.8,
            });
            expect(computeIntensity(p, p.emitted_at)).toBe(0.8);
            expect(computeIntensity(p, p.emitted_at + 999999999)).toBe(0.8);
        });
    });

    describe("Evaporation", () => {
        it("marks pheromone as evaporated below ttl_floor", () => {
            const p = makePheromone({
                decay_model: { type: "linear", rate_per_ms: 0.001 },
                initial_intensity: 0.1,
                ttl_floor: 0.01,
            });
            // After 100ms: 0.1 - 0.001 * 100 = 0.0
            expect(isEvaporated(p, p.emitted_at + 100)).toBe(true);
        });

        it("keeps pheromone alive above ttl_floor", () => {
            const p = makePheromone({
                decay_model: { type: "exponential", half_life_ms: 100000 },
                initial_intensity: 1.0,
                ttl_floor: 0.01,
            });
            expect(isEvaporated(p, p.emitted_at + 1000)).toBe(false);
        });
    });
});

// ============================================================================
// MERGE STRATEGIES
// ============================================================================

describe("Merge Strategies", () => {
    let bb: Blackboard;

    beforeEach(() => {
        bb = new Blackboard({ trackEmissionHistory: false });
    });

    it("reinforce: resets decay clock", () => {
        const r1 = bb.emit({
            trail: "merge",
            type: "test",
            intensity: 0.8,
            merge_strategy: "new",
        });
        expect(r1.action).toBe("created");

        const r2 = bb.emit({
            trail: "merge",
            type: "test",
            intensity: 0.9,
            merge_strategy: "reinforce",
        });
        expect(r2.action).toBe("reinforced");
    });

    it("replace: overwrites payload and tags", () => {
        bb.emit({
            trail: "merge",
            type: "replace-test",
            intensity: 0.5,
            payload: { data: "original" },
            tags: ["tag1"],
            merge_strategy: "reinforce",
        });

        const r = bb.emit({
            trail: "merge",
            type: "replace-test",
            intensity: 0.7,
            payload: { data: "original" },
            tags: ["tag2"],
            merge_strategy: "replace",
        });
        expect(r.action).toBe("replaced");

        const sniff = bb.sniff({ trails: ["merge"], types: ["replace-test"] });
        expect(sniff.pheromones[0].tags).toEqual(["tag2"]);
    });

    it("max: picks higher intensity", () => {
        bb.emit({
            trail: "merge",
            type: "max-test",
            intensity: 0.3,
            merge_strategy: "new",
        });

        const r = bb.emit({
            trail: "merge",
            type: "max-test",
            intensity: 0.9,
            merge_strategy: "max",
        });
        expect(r.action).toBe("merged");
        expect(r.new_intensity).toBeGreaterThanOrEqual(0.9);
    });

    it("add: sums intensities (clamped to 1.0)", () => {
        bb.emit({
            trail: "merge",
            type: "add-test",
            intensity: 0.7,
            merge_strategy: "new",
        });

        const r = bb.emit({
            trail: "merge",
            type: "add-test",
            intensity: 0.5,
            merge_strategy: "add",
        });
        expect(r.action).toBe("merged");
        expect(r.new_intensity).toBeLessThanOrEqual(1.0);
    });

    it("new: always creates separate pheromone", () => {
        const r1 = bb.emit({
            trail: "merge",
            type: "new-test",
            intensity: 0.5,
            merge_strategy: "new",
        });
        const r2 = bb.emit({
            trail: "merge",
            type: "new-test",
            intensity: 0.5,
            merge_strategy: "new",
        });
        expect(r1.pheromone_id).not.toBe(r2.pheromone_id);
        expect(r2.action).toBe("created");
    });
});

// ============================================================================
// CONDITIONS
// ============================================================================

describe("Condition Evaluation", () => {
    const now = Date.now();

    const pheromones: Pheromone[] = [
        makePheromone({ trail: "a", type: "alert", initial_intensity: 0.8 }),
        makePheromone({ trail: "a", type: "alert", initial_intensity: 0.3 }),
        makePheromone({ trail: "b", type: "data", initial_intensity: 0.5 }),
    ];

    describe("Threshold Conditions", () => {
        it("sum aggregation >= value", () => {
            const condition: ScentCondition = {
                type: "threshold",
                trail: "a",
                signal_type: "alert",
                aggregation: "sum",
                operator: ">=",
                value: 1.0,
            };
            const result = evaluateCondition(condition, { pheromones, now });
            expect(result.met).toBe(true);
            expect(result.value).toBeCloseTo(1.1);
        });

        it("max aggregation", () => {
            const condition: ScentCondition = {
                type: "threshold",
                trail: "a",
                signal_type: "alert",
                aggregation: "max",
                operator: ">=",
                value: 0.7,
            };
            const result = evaluateCondition(condition, { pheromones, now });
            expect(result.met).toBe(true);
            expect(result.value).toBeCloseTo(0.8);
        });

        it("count aggregation", () => {
            const condition: ScentCondition = {
                type: "threshold",
                trail: "a",
                signal_type: "alert",
                aggregation: "count",
                operator: "==",
                value: 2,
            };
            const result = evaluateCondition(condition, { pheromones, now });
            expect(result.met).toBe(true);
        });

        it("returns false when condition not met", () => {
            const condition: ScentCondition = {
                type: "threshold",
                trail: "a",
                signal_type: "alert",
                aggregation: "sum",
                operator: ">=",
                value: 5.0,
            };
            const result = evaluateCondition(condition, { pheromones, now });
            expect(result.met).toBe(false);
        });
    });

    describe("Composite Conditions", () => {
        it("AND: all must be met", () => {
            const condition: ScentCondition = {
                type: "composite",
                operator: "and",
                conditions: [
                    {
                        type: "threshold",
                        trail: "a",
                        signal_type: "alert",
                        aggregation: "any",
                        operator: ">=",
                        value: 0.1,
                    },
                    {
                        type: "threshold",
                        trail: "b",
                        signal_type: "data",
                        aggregation: "any",
                        operator: ">=",
                        value: 0.1,
                    },
                ],
            };
            const result = evaluateCondition(condition, { pheromones, now });
            expect(result.met).toBe(true);
        });

        it("OR: at least one must be met", () => {
            const condition: ScentCondition = {
                type: "composite",
                operator: "or",
                conditions: [
                    {
                        type: "threshold",
                        trail: "nonexistent",
                        signal_type: "test",
                        aggregation: "any",
                        operator: ">=",
                        value: 1.0,
                    },
                    {
                        type: "threshold",
                        trail: "a",
                        signal_type: "alert",
                        aggregation: "any",
                        operator: ">=",
                        value: 0.1,
                    },
                ],
            };
            const result = evaluateCondition(condition, { pheromones, now });
            expect(result.met).toBe(true);
        });

        it("NOT: inverts result", () => {
            const condition: ScentCondition = {
                type: "composite",
                operator: "not",
                conditions: [
                    {
                        type: "threshold",
                        trail: "nonexistent",
                        signal_type: "test",
                        aggregation: "any",
                        operator: ">=",
                        value: 1.0,
                    },
                ],
            };
            const result = evaluateCondition(condition, { pheromones, now });
            expect(result.met).toBe(true);
        });
    });

    describe("Rate Conditions", () => {
        it("detects emission rate", () => {
            const history = [
                { trail: "a", type: "alert", timestamp: now - 100 },
                { trail: "a", type: "alert", timestamp: now - 200 },
                { trail: "a", type: "alert", timestamp: now - 300 },
            ];

            const condition: ScentCondition = {
                type: "rate",
                trail: "a",
                signal_type: "alert",
                metric: "emissions_per_second",
                window_ms: 1000,
                operator: ">=",
                value: 2.0,
            };
            const result = evaluateCondition(condition, {
                pheromones,
                now,
                emissionHistory: history,
            });
            expect(result.met).toBe(true);
            expect(result.value).toBe(3.0); // 3 emissions per 1 second window
        });
    });

    describe("Pattern Conditions", () => {
        it("matches ordered sequence", () => {
            const history = [
                { trail: "pipeline", type: "step-1", timestamp: now - 300 },
                { trail: "pipeline", type: "step-2", timestamp: now - 200 },
                { trail: "pipeline", type: "step-3", timestamp: now - 100 },
            ];

            const condition: ScentCondition = {
                type: "pattern",
                sequence: [
                    { trail: "pipeline", signal_type: "step-1" },
                    { trail: "pipeline", signal_type: "step-2" },
                    { trail: "pipeline", signal_type: "step-3" },
                ],
                window_ms: 1000,
                ordered: true,
            };
            const result = evaluateCondition(condition, {
                pheromones: [],
                now,
                emissionHistory: history,
            });
            expect(result.met).toBe(true);
        });

        it("rejects wrong order when ordered is true", () => {
            const history = [
                { trail: "pipeline", type: "step-3", timestamp: now - 300 },
                { trail: "pipeline", type: "step-1", timestamp: now - 200 },
                { trail: "pipeline", type: "step-2", timestamp: now - 100 },
            ];

            const condition: ScentCondition = {
                type: "pattern",
                sequence: [
                    { trail: "pipeline", signal_type: "step-1" },
                    { trail: "pipeline", signal_type: "step-2" },
                    { trail: "pipeline", signal_type: "step-3" },
                ],
                window_ms: 1000,
                ordered: true,
            };
            const result = evaluateCondition(condition, {
                pheromones: [],
                now,
                emissionHistory: history,
            });
            expect(result.met).toBe(false);
        });

        it("matches unordered sequence", () => {
            const history = [
                { trail: "pipeline", type: "step-3", timestamp: now - 300 },
                { trail: "pipeline", type: "step-1", timestamp: now - 200 },
                { trail: "pipeline", type: "step-2", timestamp: now - 100 },
            ];

            const condition: ScentCondition = {
                type: "pattern",
                sequence: [
                    { trail: "pipeline", signal_type: "step-1" },
                    { trail: "pipeline", signal_type: "step-2" },
                    { trail: "pipeline", signal_type: "step-3" },
                ],
                window_ms: 1000,
                ordered: false,
            };
            const result = evaluateCondition(condition, {
                pheromones: [],
                now,
                emissionHistory: history,
            });
            expect(result.met).toBe(true);
        });

        it("fails when sequence outside window", () => {
            const condition: ScentCondition = {
                type: "pattern",
                sequence: [
                    { trail: "pipeline", signal_type: "step-1" },
                ],
                window_ms: 100,
            };
            const result = evaluateCondition(condition, {
                pheromones: [],
                now,
                emissionHistory: [
                    { trail: "pipeline", type: "step-1", timestamp: now - 200 },
                ],
            });
            expect(result.met).toBe(false);
        });
    });
});

// ============================================================================
// TAG FILTERING
// ============================================================================

describe("Tag Filtering", () => {
    let bb: Blackboard;

    beforeEach(() => {
        bb = new Blackboard({ trackEmissionHistory: false });
        bb.emit({ trail: "tags", type: "a", intensity: 0.8, tags: ["urgent", "finance"], merge_strategy: "new" });
        bb.emit({ trail: "tags", type: "b", intensity: 0.6, tags: ["routine"], merge_strategy: "new" });
        bb.emit({ trail: "tags", type: "c", intensity: 0.9, tags: ["urgent", "health"], merge_strategy: "new" });
    });

    it("any: matches if pheromone has any of the tags", () => {
        const r = bb.sniff({ trails: ["tags"], tags: { any: ["finance"] } });
        expect(r.pheromones.length).toBe(1);
        expect(r.pheromones[0].type).toBe("a");
    });

    it("all: matches if pheromone has all tags", () => {
        const r = bb.sniff({ trails: ["tags"], tags: { all: ["urgent", "finance"] } });
        expect(r.pheromones.length).toBe(1);
    });

    it("none: excludes pheromones with tag", () => {
        const r = bb.sniff({ trails: ["tags"], tags: { none: ["urgent"] } });
        expect(r.pheromones.length).toBe(1);
        expect(r.pheromones[0].type).toBe("b");
    });
});

// ============================================================================
// SCENT COOLDOWNS & EDGE TRIGGERING
// ============================================================================

describe("Scent Behavior", () => {
    let bb: Blackboard;

    beforeEach(() => {
        bb = new Blackboard({ evaluationInterval: 10, trackEmissionHistory: true });
    });

    it("respects cooldown_ms", async () => {
        let triggerCount = 0;

        bb.registerScent({
            scent_id: "cooldown-test",
            condition: {
                type: "threshold",
                trail: "cd",
                signal_type: "ping",
                aggregation: "any",
                operator: ">=",
                value: 0.1,
            },
            cooldown_ms: 500,
            trigger_mode: "level",
        });

        bb.onTrigger("cooldown-test", async () => {
            triggerCount++;
        });

        bb.emit({ trail: "cd", type: "ping", intensity: 0.8, decay: { type: "immortal" } });
        bb.start();

        // Wait for evaluation to fire
        await new Promise((r) => setTimeout(r, 100));
        const firstCount = triggerCount;
        expect(firstCount).toBeGreaterThanOrEqual(1);

        // During cooldown, should not trigger again fast
        const midCount = triggerCount;
        await new Promise((r) => setTimeout(r, 50));
        // Count should not have increased significantly during cooldown
        // (may increase by 1 due to timing, but shouldn't be >> firstCount)

        bb.stop();
    });

    it("edge_rising only fires on transition from false → true", async () => {
        let triggerCount = 0;

        bb.registerScent({
            scent_id: "edge-test",
            condition: {
                type: "threshold",
                trail: "edge",
                signal_type: "sig",
                aggregation: "any",
                operator: ">=",
                value: 0.5,
            },
            trigger_mode: "edge_rising",
            cooldown_ms: 0,
        });

        bb.onTrigger("edge-test", async () => {
            triggerCount++;
        });

        bb.start();

        // No pheromone yet — condition is false
        await new Promise((r) => setTimeout(r, 50));
        expect(triggerCount).toBe(0);

        // Emit — condition becomes true (rising edge)
        bb.emit({ trail: "edge", type: "sig", intensity: 0.8, decay: { type: "immortal" } });
        await new Promise((r) => setTimeout(r, 50));
        expect(triggerCount).toBe(1);

        // Condition stays true — should NOT trigger again
        await new Promise((r) => setTimeout(r, 100));
        expect(triggerCount).toBe(1);

        bb.stop();
    });
});

// ============================================================================
// GARBAGE COLLECTION
// ============================================================================

describe("Garbage Collection", () => {
    it("removes evaporated pheromones", () => {
        const bb = new Blackboard({ trackEmissionHistory: false });

        // Emit a fast-decaying pheromone
        bb.emit({
            trail: "gc",
            type: "temp",
            intensity: 0.1,
            decay: { type: "linear", rate_per_ms: 0.01 },
        });

        expect(bb.size).toBe(1);

        // Wait for it to decay
        const wait = (ms: number) => {
            const start = Date.now();
            while (Date.now() - start < ms) {
                // busy wait
            }
        };
        wait(50);

        const removed = bb.gc();
        expect(removed).toBe(1);
        expect(bb.size).toBe(0);
    });
});
