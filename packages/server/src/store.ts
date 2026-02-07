/**
 * SBP Pheromone Store - Persistence Adapter Interface
 *
 * Abstraction layer for pluggable storage backends.
 * Default implementation: MemoryStore (in-process Map).
 */

import type { Pheromone } from "./types.js";

// ============================================================================
// STORE INTERFACE
// ============================================================================

/**
 * Abstract storage interface for pheromones.
 * Implementations MUST be synchronous-safe for the core Blackboard operations.
 * Async-capable stores (Redis, SQLite) should pre-load into a local cache.
 */
export interface PheromoneStore {
    /** Get a pheromone by ID. Returns undefined if not found. */
    get(id: string): Pheromone | undefined;

    /** Store or update a pheromone. */
    set(id: string, pheromone: Pheromone): void;

    /** Delete a pheromone by ID. Returns true if existed. */
    delete(id: string): boolean;

    /** Check if a pheromone exists. */
    has(id: string): boolean;

    /** Iterate over all stored pheromones. */
    values(): IterableIterator<Pheromone>;

    /** Iterate over all [id, pheromone] pairs. */
    entries(): IterableIterator<[string, Pheromone]>;

    /** Number of stored pheromones. */
    readonly size: number;

    /** Remove all pheromones. */
    clear(): void;
}

// ============================================================================
// MEMORY STORE
// ============================================================================

/**
 * In-memory pheromone store backed by a Map.
 * This is the default store and provides the fastest access.
 * Data is lost on process restart — acceptable for ephemeral signals.
 */
export class MemoryStore implements PheromoneStore {
    private data = new Map<string, Pheromone>();

    get(id: string): Pheromone | undefined {
        return this.data.get(id);
    }

    set(id: string, pheromone: Pheromone): void {
        this.data.set(id, pheromone);
    }

    delete(id: string): boolean {
        return this.data.delete(id);
    }

    has(id: string): boolean {
        return this.data.has(id);
    }

    values(): IterableIterator<Pheromone> {
        return this.data.values();
    }

    entries(): IterableIterator<[string, Pheromone]> {
        return this.data.entries();
    }

    get size(): number {
        return this.data.size;
    }

    clear(): void {
        this.data.clear();
    }
}

// ============================================================================
// FACTORY
// ============================================================================

export type StoreType = "memory";

/**
 * Create a pheromone store of the specified type.
 * Currently only "memory" is built-in. Additional stores (Redis, SQLite)
 * can be added by implementing the PheromoneStore interface.
 */
export function createStore(type: StoreType = "memory"): PheromoneStore {
    switch (type) {
        case "memory":
            return new MemoryStore();
        default:
            throw new Error(`Unknown store type: ${type}`);
    }
}
