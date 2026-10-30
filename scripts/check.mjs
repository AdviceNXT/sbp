// Lint, types, tests and the OpenAPI file. CI runs this same script. Needs Node
// and uv, and no keys. Python type checking is left out: mypy isn't clean yet.
import { spawnSync } from "node:child_process";

const STEPS = [
  ["server: types, including tests", "npx tsc --noEmit -p tsconfig.eslint.json", "packages/server"],
  ["server: lint", "npx eslint src", "packages/server"],
  ["server: tests, including the demo", "npx vitest run", "packages/server"],
  ["demo: types", "npx tsc -p demo", "."],
  ["types: types", "npx tsc --noEmit", "packages/types"],
  ["client-ts: types", "npx tsc --noEmit", "packages/client-ts"],
  ["client-ts: tests", "npx vitest run", "packages/client-ts"],
  ["client-python: lint", "uv run --extra dev ruff check src tests", "packages/client-python"],
  ["client-python: tests", "uv run --extra dev pytest -q", "packages/client-python"],
  ["contract: OpenAPI", "npx redocly lint schemas/openapi.yaml", "."],
];

for (const [name, command, cwd] of STEPS) {
  console.log(`\n=== ${name}`);
  const { status } = spawnSync(command, { cwd, shell: true, stdio: "inherit" });
  if (status !== 0) {
    console.error(`\nFailed: ${name}`);
    process.exit(status ?? 1);
  }
}

console.log("\nAll checks passed.");
