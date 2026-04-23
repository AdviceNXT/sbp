/**
 * SBP Server - Public API
 */

export { Blackboard, type BlackboardOptions, type TriggerHandler } from "./blackboard.js";
export { SbpServer, type ServerOptions } from "./server.js";
export { type PheromoneStore, MemoryStore, createStore, type StoreType } from "./store.js";
export { type TraceStore, MemoryTraceStore, createTraceStore, type TraceStoreType } from "./trace-store.js";
export * from "./types.js";
export { computeIntensity, isEvaporated, defaultDecay, timeToEvaporation } from "./decay.js";
export { evaluateCondition, createSnapshot } from "./conditions.js";
export { createAuthHook, createTraceWriteHook, type AuthOptions } from "./auth.js";
export { createRateLimitHook, type RateLimitOptions } from "./rate-limiter.js";
export {
    validateEnvelope,
    validateParams,
    EmitParamsSchema,
    SniffParamsSchema,
    RegisterScentParamsSchema,
    DeregisterScentParamsSchema,
    EvaporateParamsSchema,
    InspectParamsSchema,
    InscribeParamsSchema,
    ReadParamsSchema,
    EraseParamsSchema,
    JsonRpcRequestSchema,
} from "./validation.js";
