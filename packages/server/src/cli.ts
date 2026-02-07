#!/usr/bin/env node
/**
 * SBP Server CLI
 * Streamable HTTP with SSE transport
 */

import { SbpServer } from "./server.js";

const args = process.argv.slice(2);

function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];

      if (next && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
SBP Server - Stigmergic Blackboard Protocol

Usage:
  sbp-server [options]

Options:
  --port <number>       Port to listen on (default: 3000)
  --host <string>       Host to bind to (default: localhost)
  --log                 Enable request logging
  --help                Show this help message

Transport:
  Streamable HTTP with SSE (Server-Sent Events)
  - POST /sbp    Client -> Server messages
  - GET /sbp     Server -> Client triggers (SSE stream)

Examples:
  sbp-server
  sbp-server --port 8080
  sbp-server --host 0.0.0.0 --port 3000 --log
`);
}

async function main(): Promise<void> {
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const server = new SbpServer({
    port: options.port ? parseInt(options.port as string, 10) : 3000,
    host: (options.host as string) || "localhost",
    logging: !!options.log,
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n[SBP] Shutting down...");
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    await server.start();
  } catch (err) {
    console.error("[SBP] Failed to start server:", err);
    process.exit(1);
  }
}

main();
