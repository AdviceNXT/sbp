/**
 * Decay computation utilities
 */

import type { DecayModel, Pheromone } from "./types.js";

/**
 * Compute the current intensity of a pheromone after decay
 */
export function computeIntensity(pheromone: Pheromone, now: number): number {
  const elapsed = now - pheromone.last_reinforced_at;

  if (elapsed <= 0) {
    return pheromone.initial_intensity;
  }

  switch (pheromone.decay_model.type) {
    case "exponential": {
      const halfLife = pheromone.decay_model.half_life_ms;
      return pheromone.initial_intensity * Math.pow(0.5, elapsed / halfLife);
    }

    case "linear": {
      const rate = pheromone.decay_model.rate_per_ms;
      return Math.max(0, pheromone.initial_intensity - rate * elapsed);
    }

    case "step": {
      const steps = pheromone.decay_model.steps;
      // Find the applicable step (steps should be sorted by at_ms)
      for (let i = steps.length - 1; i >= 0; i--) {
        if (elapsed >= steps[i].at_ms) {
          return steps[i].intensity;
        }
      }
      return pheromone.initial_intensity;
    }

    case "immortal":
      return pheromone.initial_intensity;

    default:
      return 0;
  }
}

/**
 * Check if a pheromone has evaporated below its floor
 */
export function isEvaporated(pheromone: Pheromone, now: number): boolean {
  return computeIntensity(pheromone, now) < pheromone.ttl_floor;
}

/**
 * Get the default decay model
 */
export function defaultDecay(): DecayModel {
  return { type: "exponential", half_life_ms: 300000 }; // 5 minutes
}

/**
 * Estimate time until pheromone evaporates
 */
export function timeToEvaporation(pheromone: Pheromone, now: number): number | null {
  const currentIntensity = computeIntensity(pheromone, now);

  if (currentIntensity <= pheromone.ttl_floor) {
    return 0; // Already evaporated
  }

  switch (pheromone.decay_model.type) {
    case "exponential": {
      // Solve: ttl_floor = current * 0.5^(t/halfLife)
      // t = halfLife * log2(current / ttl_floor)
      const halfLife = pheromone.decay_model.half_life_ms;
      const ratio = currentIntensity / pheromone.ttl_floor;
      return halfLife * Math.log2(ratio);
    }

    case "linear": {
      // Solve: ttl_floor = current - rate * t
      // t = (current - ttl_floor) / rate
      const rate = pheromone.decay_model.rate_per_ms;
      if (rate <= 0) return null;
      return (currentIntensity - pheromone.ttl_floor) / rate;
    }

    case "step": {
      // Find next step below threshold
      const steps = pheromone.decay_model.steps;
      const elapsed = now - pheromone.last_reinforced_at;
      for (const step of steps) {
        if (step.at_ms > elapsed && step.intensity < pheromone.ttl_floor) {
          return step.at_ms - elapsed;
        }
      }
      return null; // May never evaporate with given steps
    }

    case "immortal":
      return null; // Never evaporates
  }
}
