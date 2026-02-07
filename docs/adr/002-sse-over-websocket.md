# ADR-002: SSE + HTTP POST over WebSocket

## Status

Accepted

## Context

SBP needs bidirectional communication:
- **Client → Server:** Emit pheromones, register scents, sniff
- **Server → Client:** Deliver trigger notifications

Three transport options were considered:

1. **WebSocket:** Full-duplex, single persistent connection
2. **SSE + HTTP POST:** Server-Sent Events for server→client, standard HTTP POST for client→server
3. **gRPC streaming:** Bidirectional streams over HTTP/2

## Decision

SBP uses **Streamable HTTP with Server-Sent Events (SSE)**, mirroring MCP's transport choice:

- `POST /sbp` for client→server messages (JSON-RPC 2.0)
- `GET /sbp` for server→client triggers (SSE stream)

## Rationale

1. **MCP alignment.** MCP chose this exact transport pattern. Being compatible at the transport level means SBP can reuse MCP client infrastructure and tooling. Agents that already speak MCP only need to learn the SBP methods, not a new wire protocol.

2. **HTTP semantics preserved.** POST requests are standard request/response — they work with every load balancer, CDN, API gateway, and observability tool without modification. WebSocket connections require special handling at every layer.

3. **Simpler reconnection.** SSE has built-in reconnection with `Last-Event-ID`. If the connection drops, the client can resume from where it left off. WebSocket reconnection requires custom application-level logic.

4. **Stateless client operations.** Emit and sniff don't need persistent connections. An agent can emit a pheromone, close the connection, and walk away. Only agents that need trigger delivery maintain an SSE stream.

5. **Firewall / proxy friendliness.** SSE is just HTTP with `Content-Type: text/event-stream`. It passes through corporate firewalls, HTTP proxies, and Cloudflare without issues. WebSocket upgrade requests are often blocked.

## Consequences

- SSE is unidirectional (server→client only), so we need a separate POST channel
- SSE doesn't support binary payloads natively (all data is text/JSON)
- Server must manage SSE connection state (keepalive, cleanup)
- No built-in multiplexing — each SSE stream is one connection
