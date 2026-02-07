# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
