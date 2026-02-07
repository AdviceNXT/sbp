/**
 * SBP Server Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Blackboard } from "../src/blackboard.js";

describe("Blackboard", () => {
  let bb: Blackboard;

  beforeEach(() => {
    bb = new Blackboard();
  });

  describe("emit", () => {
    it("should create a new pheromone", () => {
      const result = bb.emit({
        trail: "test.signals",
        type: "event",
        intensity: 0.8,
      });

      expect(result.action).toBe("created");
      expect(result.new_intensity).toBe(0.8);
      expect(result.pheromone_id).toBeDefined();
    });

    it("should reinforce existing pheromone with same payload", () => {
      bb.emit({
        trail: "test.signals",
        type: "event",
        intensity: 0.5,
        payload: { id: 1 },
      });

      const result = bb.emit({
        trail: "test.signals",
        type: "event",
        intensity: 0.8,
        payload: { id: 1 },
        merge_strategy: "reinforce",
      });

      expect(result.action).toBe("reinforced");
      expect(result.new_intensity).toBe(0.8);
    });

    it("should create new pheromone with merge_strategy=new", () => {
      bb.emit({
        trail: "test.signals",
        type: "event",
        intensity: 0.5,
      });

      bb.emit({
        trail: "test.signals",
        type: "event",
        intensity: 0.8,
        merge_strategy: "new",
      });

      expect(bb.size).toBe(2);
    });

    it("should clamp intensity to [0, 1]", () => {
      const result1 = bb.emit({
        trail: "test",
        type: "a",
        intensity: 1.5,
      });
      expect(result1.new_intensity).toBe(1);

      const result2 = bb.emit({
        trail: "test",
        type: "b",
        intensity: -0.5,
      });
      expect(result2.new_intensity).toBe(0);
    });
  });

  describe("sniff", () => {
    beforeEach(() => {
      bb.emit({ trail: "market.signals", type: "volatility", intensity: 0.8 });
      bb.emit({ trail: "market.signals", type: "momentum", intensity: 0.5 });
      bb.emit({ trail: "market.orders", type: "large", intensity: 0.6 });
    });

    it("should return all pheromones when no filter", () => {
      const result = bb.sniff();
      expect(result.pheromones.length).toBe(3);
    });

    it("should filter by trail", () => {
      const result = bb.sniff({ trails: ["market.signals"] });
      expect(result.pheromones.length).toBe(2);
      expect(result.pheromones.every((p) => p.trail === "market.signals")).toBe(true);
    });

    it("should filter by type", () => {
      const result = bb.sniff({ types: ["volatility"] });
      expect(result.pheromones.length).toBe(1);
      expect(result.pheromones[0].type).toBe("volatility");
    });

    it("should filter by min_intensity", () => {
      const result = bb.sniff({ min_intensity: 0.7 });
      expect(result.pheromones.length).toBe(1);
      expect(result.pheromones[0].current_intensity).toBeGreaterThanOrEqual(0.7);
    });

    it("should return aggregates", () => {
      const result = bb.sniff();
      expect(result.aggregates["market.signals/volatility"]).toBeDefined();
      expect(result.aggregates["market.signals/volatility"].count).toBe(1);
      expect(result.aggregates["market.signals/volatility"].max_intensity).toBe(0.8);
    });

    it("should sort by intensity descending", () => {
      const result = bb.sniff();
      for (let i = 1; i < result.pheromones.length; i++) {
        expect(result.pheromones[i - 1].current_intensity).toBeGreaterThanOrEqual(
          result.pheromones[i].current_intensity
        );
      }
    });
  });

  describe("registerScent", () => {
    it("should register a new scent", () => {
      const result = bb.registerScent({
        scent_id: "test-scent",
        agent_endpoint: "http://localhost:8080",
        condition: {
          type: "threshold",
          trail: "test",
          signal_type: "event",
          aggregation: "max",
          operator: ">=",
          value: 0.5,
        },
      });

      expect(result.status).toBe("registered");
      expect(result.scent_id).toBe("test-scent");
    });

    it("should update existing scent", () => {
      bb.registerScent({
        scent_id: "test-scent",
        agent_endpoint: "http://localhost:8080",
        condition: {
          type: "threshold",
          trail: "test",
          signal_type: "event",
          aggregation: "max",
          operator: ">=",
          value: 0.5,
        },
      });

      const result = bb.registerScent({
        scent_id: "test-scent",
        agent_endpoint: "http://localhost:9090",
        condition: {
          type: "threshold",
          trail: "test",
          signal_type: "event",
          aggregation: "max",
          operator: ">=",
          value: 0.7,
        },
      });

      expect(result.status).toBe("updated");
    });

    it("should report current condition state", () => {
      bb.emit({ trail: "test", type: "event", intensity: 0.8 });

      const result = bb.registerScent({
        scent_id: "test-scent",
        agent_endpoint: "http://localhost:8080",
        condition: {
          type: "threshold",
          trail: "test",
          signal_type: "event",
          aggregation: "max",
          operator: ">=",
          value: 0.5,
        },
      });

      expect(result.current_condition_state.met).toBe(true);
    });
  });

  describe("deregisterScent", () => {
    it("should deregister existing scent", () => {
      bb.registerScent({
        scent_id: "test-scent",
        agent_endpoint: "http://localhost:8080",
        condition: {
          type: "threshold",
          trail: "test",
          signal_type: "event",
          aggregation: "max",
          operator: ">=",
          value: 0.5,
        },
      });

      const result = bb.deregisterScent({ scent_id: "test-scent" });
      expect(result.status).toBe("deregistered");
    });

    it("should return not_found for unknown scent", () => {
      const result = bb.deregisterScent({ scent_id: "unknown" });
      expect(result.status).toBe("not_found");
    });
  });

  describe("evaporate", () => {
    beforeEach(() => {
      bb.emit({ trail: "a", type: "x", intensity: 0.1 });
      bb.emit({ trail: "a", type: "y", intensity: 0.5 });
      bb.emit({ trail: "b", type: "x", intensity: 0.8 });
    });

    it("should evaporate by trail", () => {
      const result = bb.evaporate({ trail: "a" });
      expect(result.evaporated_count).toBe(2);
      expect(bb.size).toBe(1);
    });

    it("should evaporate by intensity threshold", () => {
      const result = bb.evaporate({ below_intensity: 0.3 });
      expect(result.evaporated_count).toBe(1);
    });
  });

  describe("gc", () => {
    it("should remove evaporated pheromones", async () => {
      // Create pheromone with very short half-life
      bb.emit({
        trail: "test",
        type: "event",
        intensity: 0.5,
        decay: { type: "linear", rate_per_ms: 1 }, // Decays to 0 in 500ms
      });

      expect(bb.size).toBe(1);

      // Wait for decay
      await new Promise((resolve) => setTimeout(resolve, 600));

      const removed = bb.gc();
      expect(removed).toBe(1);
      expect(bb.size).toBe(0);
    });
  });

  describe("inspect", () => {
    it("should return stats", () => {
      bb.emit({ trail: "test", type: "event", intensity: 0.5 });
      bb.registerScent({
        scent_id: "s1",
        agent_endpoint: "http://localhost",
        condition: { type: "threshold", trail: "test", signal_type: "event", aggregation: "max", operator: ">=", value: 0.1 },
      });

      const result = bb.inspect({ include: ["stats"] });
      expect(result.stats).toBeDefined();
      expect(result.stats!.total_pheromones).toBe(1);
      expect(result.stats!.total_scents).toBe(1);
    });

    it("should return trails info", () => {
      bb.emit({ trail: "a", type: "x", intensity: 0.5 });
      bb.emit({ trail: "a", type: "y", intensity: 0.3 });

      const result = bb.inspect({ include: ["trails"] });
      expect(result.trails).toBeDefined();
      expect(result.trails!.find((t) => t.name === "a")?.pheromone_count).toBe(2);
    });
  });
});
