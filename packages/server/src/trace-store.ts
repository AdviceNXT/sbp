/**
 * SBP Trace Store - Persistence Adapter Interface
 *
 * Abstraction layer for pluggable trace storage backends.
 * Default implementation: MemoryTraceStore (in-process Map).
 *
 * Unlike PheromoneStore, traces are durable — they persist until
 * explicitly erased. No decay, no garbage collection.
 */

import type { Trace } from "./types.js";

// ============================================================================
// STORE INTERFACE
// ============================================================================

/**
 * Abstract storage interface for traces.
 * Traces are keyed by both ID and trail+key composite.
 * Implementations MUST ensure trail+key uniqueness.
 */
export interface TraceStore {
    /** Get a trace by ID. */
    get(id: string): Trace | undefined;

    /** Get a trace by trail + key composite. */
    getByKey(trail: string, key: string): Trace | undefined;

    /** Store or update a trace. */
    set(id: string, trace: Trace): void;

    /** Delete a trace by ID. Returns true if existed. */
    delete(id: string): boolean;

    /** Delete a trace by trail + key. Returns true if existed. */
    deleteByKey(trail: string, key: string): boolean;

    /** Check if a trace exists by trail + key. */
    has(trail: string, key: string): boolean;

    /** Iterate over all stored traces. */
    values(): IterableIterator<Trace>;

    /** Iterate over all [id, trace] pairs. */
    entries(): IterableIterator<[string, Trace]>;

    /** Find all traces in a given trail. */
    findByTrail(trail: string): Trace[];

    /** Find all traces whose key starts with a prefix. */
    findByPrefix(prefix: string): Trace[];

    /** Number of stored traces. */
    readonly size: number;

    /** Remove all traces. */
    clear(): void;
}

// ============================================================================
// MEMORY TRACE STORE
// ============================================================================

/**
 * In-memory trace store backed by two Maps for dual-key access.
 * Data is lost on process restart. For durable deployments, implement
 * a persistent TraceStore (SQLite, filesystem, etc.).
 */
export class MemoryTraceStore implements TraceStore {
    /** Primary store: id → Trace */
    private byId = new Map<string, Trace>();
    /** Secondary index: "trail\0key" → id */
    private keyIndex = new Map<string, string>();

    private compositeKey(trail: string, key: string): string {
        return `${trail}\0${key}`;
    }

    get(id: string): Trace | undefined {
        return this.byId.get(id);
    }

    getByKey(trail: string, key: string): Trace | undefined {
        const id = this.keyIndex.get(this.compositeKey(trail, key));
        if (!id) return undefined;
        return this.byId.get(id);
    }

    set(id: string, trace: Trace): void {
        // Remove old key index if updating an existing trace
        const existing = this.byId.get(id);
        if (existing) {
            this.keyIndex.delete(this.compositeKey(existing.trail, existing.key));
        }
        this.byId.set(id, trace);
        this.keyIndex.set(this.compositeKey(trace.trail, trace.key), id);
    }

    delete(id: string): boolean {
        const trace = this.byId.get(id);
        if (!trace) return false;
        this.keyIndex.delete(this.compositeKey(trace.trail, trace.key));
        return this.byId.delete(id);
    }

    deleteByKey(trail: string, key: string): boolean {
        const ck = this.compositeKey(trail, key);
        const id = this.keyIndex.get(ck);
        if (!id) return false;
        this.keyIndex.delete(ck);
        return this.byId.delete(id);
    }

    has(trail: string, key: string): boolean {
        return this.keyIndex.has(this.compositeKey(trail, key));
    }

    values(): IterableIterator<Trace> {
        return this.byId.values();
    }

    entries(): IterableIterator<[string, Trace]> {
        return this.byId.entries();
    }

    findByTrail(trail: string): Trace[] {
        const results: Trace[] = [];
        for (const trace of this.byId.values()) {
            if (trace.trail === trail) {
                results.push(trace);
            }
        }
        return results;
    }

    findByPrefix(prefix: string): Trace[] {
        const results: Trace[] = [];
        for (const trace of this.byId.values()) {
            if (trace.key.startsWith(prefix)) {
                results.push(trace);
            }
        }
        return results;
    }

    get size(): number {
        return this.byId.size;
    }

    clear(): void {
        this.byId.clear();
        this.keyIndex.clear();
    }
}

// ============================================================================
// FACTORY
// ============================================================================

export type TraceStoreType = "memory";

/**
 * Create a trace store of the specified type.
 * Currently only "memory" is built-in. Additional stores (SQLite, filesystem)
 * can be added by implementing the TraceStore interface.
 */
export function createTraceStore(type: TraceStoreType = "memory"): TraceStore {
    switch (type) {
        case "memory":
            return new MemoryTraceStore();
        default:
            throw new Error(`Unknown trace store type: ${type}`);
    }
}
