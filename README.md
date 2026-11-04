# Stigmergic Blackboard Protocol (SBP)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/AdviceNXT/sbp/actions/workflows/ci.yml/badge.svg)](https://github.com/AdviceNXT/sbp/actions/workflows/ci.yml)

Agents coordinating the way ants do: by leaving signals in a shared environment, not by messaging each other.

**This is a reference implementation and a technical showcase.** It's a tested, runnable example of the idea, and it isn't meant for production. See [what it doesn't do](#what-it-doesnt-do).

## See it work

Needs Node 22 or later.

```bash
git clone https://github.com/AdviceNXT/sbp.git && cd sbp
npm ci
npm run demo
```

Three monitors watch a service. A responder sleeps until their signals add up. None of them knows the others exist.

```text
1. One monitor sees a blip. It's weak, and nobody reinforces it.
  total signal 0.60
  a moment later 0.07: it faded by itself, and nothing had to clean it up

2. An operator records planned maintenance. All three monitors now report errors.
  total signal 2.16: over the line, but the maintenance record holds it back

3. Maintenance ends. The errors keep coming from all three monitors.
  >>> the responder wakes, with total signal 2.22

Done: one wake, from three agents that don't know each other exist.
```

The exact numbers vary a little, because signals decay in real time. That runs a real server on a local port, and connects through the real SDK and SSE ([`demo/incident.mts`](demo/incident.mts)). A test holds the demo to this outcome.

## The idea

| Part | What it is |
| --- | --- |
| **Pheromones** | Signals with an intensity from 0 to 1. By default they decay over time, so unreinforced signals fade away. You can also choose a stepped decay, or none. |
| **Traces** | Records addressed by `trail + key`, which stay until erased. |
| **Trails** | Shared namespaces, such as `service.errors`. |
| **Scents** | Rules like "wake me when the total signal is at least 1.5 and no maintenance record exists". |

There are eight operations: `emit`, `sniff`, `register_scent`, `deregister_scent` and `evaporate` for signals and rules, `inscribe`, `read` and `erase` for traces. The server delivers triggers to agents over SSE. [SPECIFICATION.md](SPECIFICATION.md) has the protocol, and [QUICK_REFERENCE.md](QUICK_REFERENCE.md) a summary.

## Use the packages

```bash
npm install @advicenxt/sbp-server @advicenxt/sbp-client
pip install sbp-client
```

```python
from sbp import SbpClient

with SbpClient() as client:
    client.emit("signals", "event", 0.8, payload={"source": "sensor-1"})
    client.inscribe("config", "risk-tolerance", {"level": "moderate"})

    for p in client.sniff(trails=["signals"]).pheromones:
        print(p.trail, p.type, round(p.current_intensity, 2))
```

Start a server first with `npx sbp-server`. The Python SDK also has a local mode with no server: `SbpClient(local=True)`.

## What it doesn't do

- **Nothing survives a restart.** Pheromones, traces and scents all live in memory, so traces last only as long as the process.
- **Triggers are best-effort.** One can be lost, for example while a subscriber is disconnected. Anything that must not be missed has to keep its own record and reconcile with `sniff` and `read`.
- **Several subscribers to one scent aren't reliable.** The server keeps one trigger callback per scent. Both SDKs subscribe before opening their stream, and in that order a later session cuts off an earlier one. Sessions that open their stream first share triggers, until any one of them unsubscribes or disconnects, which can stop the rest. A `subscribe` with no session ID is ignored, and Python's local mode keeps only the last subscriber.
- **Single node.** There's no clustering or replication.
- **The SDKs can't send an API key,** so they can't connect to a server that requires one.
- **Limits aren't complete.** A client that can write can use up the server's memory, so trust every client you give access to. See [SECURITY.md](SECURITY.md).
- **Parts of the spec aren't implemented.** The server accepts `hysteresis` and `max_execution_ms` but ignores them, counts emissions for the `intensity_delta` metric, and ignores `min_intensity` in pattern conditions.
- **The SDKs don't match each other or the spec.** The TypeScript SDK has no `evaporate`, or pattern or step-decay types. The Python SDK has no pattern conditions, and its local mode can't `evaporate` or `inspect`.

Decaying signals are a real technique, as in route-flap damping and EWMA control charts. Whether they make LLM agents coordinate better is still an open question.

## Develop

```bash
npm ci
npm run check   # lint, types, tests, OpenAPI; needs Node and uv. Python types (mypy) aren't clean yet
npm run dev     # the server, on port 3000
```

## Layout

```text
SPECIFICATION.md, schemas/, rfcs/   the protocol
packages/server/                    TypeScript reference server
packages/types/                     shared TypeScript types
packages/client-ts/                 TypeScript SDK
packages/client-python/             Python SDK
demo/                               the demo above, and a curl walkthrough
examples/                           a single-file Python reference
```

## License

Specification: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Code: [MIT](LICENSE).
