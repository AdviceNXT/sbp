# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.2.0

### Added
- **Trace Layer** — Durable knowledge records (Traces) alongside ephemeral pheromones
- `INSCRIBE` operation — Create or update a trace (`trail + key` composite uniqueness)
- `READ` operation — Query traces by trail, key, prefix, or tags
- `ERASE` operation — Remove traces by trail, key, age, or tags
- `TraceCondition` — Scent conditions can now reference trace state (`exists`, `not_exists`, `value_eq`, `value_neq`)
- Cross-layer scent evaluation — Composite conditions combining pheromone thresholds AND trace state
- Trace-specific auth — `traceWriteKeys` restricts `INSCRIBE`/`ERASE` to privileged agents
- `TraceStore` interface with `MemoryTraceStore` default implementation
- TypeScript client: `inscribe()`, `read()`, `erase()`, `traceExists()`, `traceNotExists()`, `traceEquals()` helpers
- Python client: Full parity with TypeScript SDK including local-mode trace operations
- Python evaluator: `TraceCondition` evaluation with dot-path nested field access
- 36 new tests (10 trace CRUD, 11 TraceCondition, 15 HTTP integration + auth)
- `TRACE_MAX_VALUE_SIZE` constant (1 MB) to prevent memory exhaustion
- Trace error codes: `-32007` (trace not found), `-32008` (trace value too large)
- OpenAPI schema updates for all trace endpoints and schemas
- Updated `SPECIFICATION.md` with Trace data model (§4.5), operations (§5.6–5.8), and conditions (§7.5)
- Updated `QUICK_REFERENCE.md` with dual-layer architecture diagram and trace examples

### Changed
- Spec version bumped to `0.2.0`
- `inspect()` now includes `traces` in default include list
- Auth hook split: `onRequest` for API key validation, `preHandler` for trace write permissions

## 0.1.0

### Added
- RFC 2119/8174 conformance keywords throughout `SPECIFICATION.md`
- Persistence adapter interface (`PheromoneStore`) with pluggable storage backends
- `MemoryStore` — default in-memory implementation of `PheromoneStore`
- `createStore()` factory function for instantiating stores
- `@advicenxt/sbp-types` package — canonical shared type definitions
- OpenAPI 3.1 specification (`schemas/openapi.yaml`)
- Benchmark suite (`packages/server/benchmarks/bench.ts`)
- Governance RFC process (`docs/rfc-process.md`) and template (`rfcs/0000-template.md`)
- Input validation with Zod schemas for all JSON-RPC methods
- API key authentication middleware
- Token-bucket rate limiting
- `PatternCondition` — sequence-based scent conditions
- UUID v7 for pheromone identifiers
- Integration test suite (22 tests)
- Conformance test suite (35 tests)
- `CODE_OF_CONDUCT.md` (Contributor Covenant v2.1)
- `SECURITY.md` with vulnerability reporting policy
- Docker support (`Dockerfile`, `docker-compose.yml`)
- ADR-001: Decay Model (exponential default rationale)
- ADR-002: SSE Transport (Streamable HTTP choice)
- ADR-003: Stigmergy over Orchestration (architecture rationale)

### Changed
- Blackboard now accepts a `store` option for pluggable persistence
- `sbp.d.ts` fixed to export all public types correctly
- CLI extended with `--host`, `--cors`, `--log` options

### Fixed
- Type declarations missing `PatternCondition` and other types
- Merge strategy `replace` test payload matching

## [0.1.0-draft] — 2026-02-07

### Added
- Initial draft specification
- TypeScript reference implementation (server)
- TypeScript client library
- Python client library
- JSON Schema for pheromone validation
- Example applications (multi-agent, task pipeline, market monitor)
