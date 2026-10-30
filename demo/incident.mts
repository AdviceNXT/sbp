/**
 * One command, one story: `npm run demo`.
 *
 * Three monitors watch a service and never talk to each other, or to the
 * responder. The responder sleeps until weak signals add up, unless a durable
 * maintenance record says the noise is expected.
 *
 * It runs a real server on a local port and connects through the real SDK and
 * SSE. It exits non-zero if the story doesn't happen as told.
 */

import { createServer, type AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { and, exponentialDecay, SbpClient, threshold, traceNotExists } from "../packages/client-ts/src/index.js";
import { SbpServer } from "../packages/server/src/server.js";

const TRAIL = "service.errors";
const TYPE = "error_rate";
const HALF_LIFE_MS = 800;
const WAKE_AT = 1.5;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

function check(claim: string, holds: boolean): void {
  if (!holds) {
    throw new Error(`The demo's claim is false: ${claim}`);
  }
}

const port = await freePort();
const url = `http://127.0.0.1:${port}`;
const server = new SbpServer({ port, host: "127.0.0.1", evaluationInterval: 20 });
const log = console.log;
console.log = () => {};
await server.start();
console.log = log;

const monitors = ["monitor-a", "monitor-b", "monitor-c"].map((agentId) => new SbpClient({ url, agentId }));
const responder = new SbpClient({ url, agentId: "responder" });
const operator = new SbpClient({ url, agentId: "operator" });

async function report(monitor: SbpClient, intensity: number): Promise<void> {
  await monitor.emit(TRAIL, TYPE, intensity, {
    decay: exponentialDecay(HALF_LIFE_MS),
    mergeStrategy: "new",
  });
}

async function pressure(): Promise<number> {
  const { aggregates } = await responder.sniff({ trails: [TRAIL] });
  return aggregates[`${TRAIL}/${TYPE}`]?.sum_intensity ?? 0;
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await sleep(10);
  }
}

function step(text: string): void {
  log(`\n${text}`);
}

let wakes = 0;

try {
  step(`A responder registers one rule and goes to sleep:`);
  log(`  wake when total error signal >= ${WAKE_AT}, and no maintenance record exists`);
  log(`  signals lose half their strength every ${HALF_LIFE_MS} ms`);

  await responder.registerScent(
    "incident",
    and(
      threshold(TRAIL, TYPE, ">=", WAKE_AT, "sum"),
      traceNotExists("ops", "maintenance")
    ),
    { triggerMode: "edge_rising" }
  );
  await responder.subscribe("incident", async () => {
    wakes += 1;
    log(`  >>> the responder wakes, with total signal ${(await pressure()).toFixed(2)}`);
  });
  await sleep(100);

  step("1. One monitor sees a blip. It's weak, and nobody reinforces it.");
  await report(monitors[0], 0.6);
  const blip = await pressure();
  log(`  total signal ${blip.toFixed(2)}`);
  await sleep(HALF_LIFE_MS * 3);
  const faded = await pressure();
  log(`  a moment later ${faded.toFixed(2)}: it faded by itself, and nothing had to clean it up`);
  check("a blip starts below the wake line", blip > 0 && blip < WAKE_AT);
  check("an unreinforced blip fades", faded < blip / 4);
  check("a lone blip wakes nobody", wakes === 0);

  step("2. An operator records planned maintenance. All three monitors now report errors.");
  await operator.inscribe("ops", "maintenance", { until: "tonight" });
  await Promise.all(monitors.map((monitor) => report(monitor, 0.7)));
  const held = await pressure();
  log(`  total signal ${held.toFixed(2)}: over the line, but the maintenance record holds it back`);
  check("signals add up past the wake line", held >= WAKE_AT);
  await sleep(100);
  check("maintenance holds the responder back", wakes === 0);
  await sleep(HALF_LIFE_MS * 3);

  step("3. Maintenance ends. The errors keep coming from all three monitors.");
  await operator.erase({ trail: "ops", keys: ["maintenance"] });
  await Promise.all(monitors.map((monitor) => report(monitor, 0.7)));
  await waitFor(() => wakes > 0, 5000);
  check("the responder wakes after maintenance", wakes === 1);
  await sleep(200);
  check("the responder wakes only once", wakes === 1);

  step("Done: one wake, from three agents that don't know each other exist.");
} finally {
  await Promise.all([responder.close(), operator.close(), ...monitors.map((m) => m.close())]);
  console.log = () => {};
  await server.stop();
  console.log = log;
}
