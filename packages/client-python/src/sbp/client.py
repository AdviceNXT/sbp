"""
SBP Client - HTTP and SSE clients (following MCP transport patterns)
"""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any, Callable, Awaitable, Optional

import httpx

from sbp.types import (
    DecayModel,
    EmitResult,
    SniffParams,
    SniffResult,
    RegisterScentParams,
    RegisterScentResult,
    DeregisterScentResult,
    EvaporateParams,
    EvaporateResult,
    InspectResult,
    TriggerPayload,
    JsonRpcRequest,
    JsonRpcResponse,
    ScentCondition,
    EmitParams,
    DeregisterScentParams,
    InspectParams
)
from sbp.blackboard import LocalBlackboard, get_shared_blackboard


class SbpError(Exception):
    """SBP protocol error"""

    def __init__(self, code: int, message: str, data: Any = None):
        super().__init__(message)
        self.code = code
        self.data = data


class AsyncSbpClient:
    """
    Async SBP client using Streamable HTTP with SSE.

    Uses:
    - HTTP POST for client->server messages (emit, sniff, register_scent)
    - SSE (GET) for server->client messages (triggers)
    """

    def __init__(
        self,
        url: str = "http://localhost:3000",
        agent_id: str | None = None,
        timeout: float = 30.0,
        local: bool = False,
    ):
        self.url = url.rstrip("/")
        self.agent_id = agent_id or f"agent-{uuid.uuid4().hex[:8]}"
        self.timeout = timeout
        self.local = local
        self._http: httpx.AsyncClient | None = None
        self._session_id: str | None = None
        self._sse_task: asyncio.Task[None] | None = None
        self._sse_handlers: dict[str, Callable[[TriggerPayload], Awaitable[None]]] = {}
        self._sse_running = False
        self._last_event_id: str | None = None

        # Local mode
        self._local_blackboard: Optional[LocalBlackboard] = None
        if local:
            self._local_blackboard = get_shared_blackboard()

    async def __aenter__(self) -> "AsyncSbpClient":
        await self.connect()
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    async def connect(self) -> None:
        """Initialize connection"""
        if self.local and self._local_blackboard:
            await self._local_blackboard.start()
            return

        self._http = httpx.AsyncClient(
            base_url=self.url,
            timeout=self.timeout,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                "Sbp-Protocol-Version": "0.1",
                "Sbp-Agent-Id": self.agent_id,
            },
        )

    async def close(self) -> None:
        """Close all connections"""
        if self.local and self._local_blackboard:
            await self._local_blackboard.stop()
            return

        self._sse_running = False

        if self._sse_task:
            self._sse_task.cancel()
            try:
                await self._sse_task
            except asyncio.CancelledError:
                pass

        if self._http:
            await self._http.aclose()

    def _get_headers(self) -> dict[str, str]:
        """Get headers including session ID if available"""
        headers: dict[str, str] = {}
        if self._session_id:
            headers["Sbp-Session-Id"] = self._session_id
        return headers

    async def _rpc(self, method: str, params: dict[str, Any]) -> Any:
        """Make a JSON-RPC call"""
        if self.local and self._local_blackboard:
            # Route directly to local blackboard methods
            if method == "sbp/emit":
                return self._local_blackboard.emit(EmitParams(**params)).model_dump()
            elif method == "sbp/sniff":
                return self._local_blackboard.sniff(SniffParams(**params)).model_dump()
            elif method == "sbp/register_scent":
                return self._local_blackboard.register_scent(RegisterScentParams(**params)).model_dump()
            elif method == "sbp/deregister_scent":
                return self._local_blackboard.deregister_scent(params["scent_id"]).model_dump()
            elif method == "sbp/evaporate":
                return self._local_blackboard.evaporate(EvaporateParams(**params)).model_dump()
            elif method == "sbp/inspect":
                return self._local_blackboard.inspect(InspectParams(**params)).model_dump()
            elif method == "sbp/subscribe":
                # Handled by subscribe() wrapper
                return {"subscribed": params["scent_id"]}
            elif method == "sbp/unsubscribe":
                # Handled by unsubscribe() wrapper
                return {"unsubscribed": params["scent_id"]}
            else:
                raise SbpError(-32601, f"Method not found: {method}")

        # HTTP/Remote mode
        if not self._http:
            await self.connect()

        request = JsonRpcRequest(
            id=str(uuid.uuid4()),
            method=method,
            params=params,
        )

        response = await self._http.post(  # type: ignore
            "/sbp",
            json=request.model_dump(),
            headers=self._get_headers(),
        )
        response.raise_for_status()

        # Capture session ID from response
        if "sbp-session-id" in response.headers:
            self._session_id = response.headers["sbp-session-id"]

        result = JsonRpcResponse.model_validate(response.json())

        if result.error:
            raise SbpError(result.error.code, result.error.message, result.error.data)

        return result.result

    # ==========================================================================
    # EMIT
    # ==========================================================================

    async def emit(
        self,
        trail: str,
        type: str,
        intensity: float,
        *,
        decay: DecayModel | None = None,
        payload: dict[str, Any] | None = None,
        tags: list[str] | None = None,
        merge_strategy: str = "reinforce",
    ) -> EmitResult:
        """Emit a pheromone to the blackboard"""
        params: dict[str, Any] = {
            "trail": trail,
            "type": type,
            "intensity": intensity,
            "merge_strategy": merge_strategy,
            "source_agent": self.agent_id,
        }

        if decay:
            params["decay"] = decay.model_dump()
        if payload:
            params["payload"] = payload
        if tags:
            params["tags"] = tags

        result = await self._rpc("sbp/emit", params)
        return EmitResult.model_validate(result)

    # ==========================================================================
    # SNIFF
    # ==========================================================================

    async def sniff(
        self,
        trails: list[str] | None = None,
        types: list[str] | None = None,
        *,
        min_intensity: float = 0,
        limit: int = 100,
        include_evaporated: bool = False,
    ) -> SniffResult:
        """Sniff the current environment state"""
        params = SniffParams(
            trails=trails,
            types=types,
            min_intensity=min_intensity,
            limit=limit,
            include_evaporated=include_evaporated,
        )

        result = await self._rpc("sbp/sniff", params.model_dump(exclude_none=True))
        return SniffResult.model_validate(result)

    # ==========================================================================
    # REGISTER_SCENT
    # ==========================================================================

    async def register_scent(
        self,
        scent_id: str,
        condition: ScentCondition,
        *,
        agent_endpoint: str | None = None,
        cooldown_ms: int = 0,
        activation_payload: dict[str, Any] | None = None,
        trigger_mode: str = "level",
        context_trails: list[str] | None = None,
    ) -> RegisterScentResult:
        """Register a scent (trigger condition)"""
        # For SSE-based triggers, endpoint is informational only
        endpoint = agent_endpoint or f"sse://{self.agent_id}"

        params = RegisterScentParams(
            scent_id=scent_id,
            agent_endpoint=endpoint,
            condition=condition,
            cooldown_ms=cooldown_ms,
            activation_payload=activation_payload or {},
            trigger_mode=trigger_mode,  # type: ignore
            context_trails=context_trails,
        )

        result = await self._rpc("sbp/register_scent", params.model_dump(exclude_none=True))
        return RegisterScentResult.model_validate(result)

    # ==========================================================================
    # DEREGISTER_SCENT
    # ==========================================================================

    async def deregister_scent(self, scent_id: str) -> DeregisterScentResult:
        """Deregister a scent"""
        result = await self._rpc("sbp/deregister_scent", {"scent_id": scent_id})
        return DeregisterScentResult.model_validate(result)

    # ==========================================================================
    # EVAPORATE
    # ==========================================================================

    async def evaporate(
        self,
        trail: str | None = None,
        types: list[str] | None = None,
        *,
        older_than_ms: int | None = None,
        below_intensity: float | None = None,
    ) -> EvaporateResult:
        """Force evaporation of pheromones"""
        params = EvaporateParams(
            trail=trail,
            types=types,
            older_than_ms=older_than_ms,
            below_intensity=below_intensity,
        )

        result = await self._rpc("sbp/evaporate", params.model_dump(exclude_none=True))
        return EvaporateResult.model_validate(result)

    # ==========================================================================
    # INSPECT
    # ==========================================================================

    async def inspect(
        self, include: list[str] | None = None
    ) -> InspectResult:
        """Inspect blackboard state"""
        params = {"include": include or ["trails", "scents", "stats"]}
        result = await self._rpc("sbp/inspect", params)
        return InspectResult.model_validate(result)

    # ==========================================================================
    # SSE SUBSCRIPTIONS
    # ==========================================================================

    async def subscribe(
        self,
        scent_id: str,
        handler: Callable[[TriggerPayload], Awaitable[None]],
    ) -> None:
        """Subscribe to triggers for a scent"""
        self._sse_handlers[scent_id] = handler

        if self.local and self._local_blackboard:
            # Register handler directly
            self._local_blackboard.subscribe(scent_id, handler)
            return

        # Tell server we want this scent's triggers
        await self._rpc("sbp/subscribe", {"scent_id": scent_id})

        # Start SSE listener if not already running
        if not self._sse_running:
            self._sse_running = True
            self._sse_task = asyncio.create_task(self._sse_listen())

    async def unsubscribe(self, scent_id: str) -> None:
        """Unsubscribe from a scent's triggers"""
        if scent_id in self._sse_handlers:
            del self._sse_handlers[scent_id]

        if self.local and self._local_blackboard:
            self._local_blackboard.unsubscribe(scent_id)
            return

        await self._rpc("sbp/unsubscribe", {"scent_id": scent_id})

    async def _sse_listen(self) -> None:
        """Listen for SSE events from the server"""
        if not self._http:
            return

        while self._sse_running:
            try:
                headers = {
                    "Accept": "text/event-stream",
                    **self._get_headers(),
                }
                if self._last_event_id:
                    headers["Last-Event-ID"] = self._last_event_id

                async with self._http.stream("GET", "/sbp", headers=headers) as response:
                    if response.status_code != 200:
                        await asyncio.sleep(1)
                        continue

                    # Capture session ID
                    if "sbp-session-id" in response.headers:
                        self._session_id = response.headers["sbp-session-id"]

                    # Parse SSE stream
                    event_type = ""
                    event_id = ""
                    event_data = ""

                    async for line in response.aiter_lines():
                        if not self._sse_running:
                            break

                        line = line.strip()

                        if line.startswith("event:"):
                            event_type = line[6:].strip()
                        elif line.startswith("id:"):
                            event_id = line[3:].strip()
                            self._last_event_id = event_id
                        elif line.startswith("data:"):
                            event_data = line[5:].strip()
                        elif line == "" and event_data:
                            # End of event, process it
                            await self._handle_sse_event(event_type, event_data)
                            event_type = ""
                            event_id = ""
                            event_data = ""
                        elif line.startswith(":"):
                            # Comment (keepalive), ignore
                            pass

            except httpx.ReadTimeout:
                # Reconnect on timeout
                continue
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[SBP] SSE error: {e}")
                await asyncio.sleep(1)

    async def _handle_sse_event(self, event_type: str, data: str) -> None:
        """Handle an SSE event"""
        try:
            if event_type == "message":
                msg = json.loads(data)
                if msg.get("method") == "sbp/trigger":
                    payload = TriggerPayload.model_validate(msg["params"])
                    handler = self._sse_handlers.get(payload.scent_id)
                    if handler:
                        await handler(payload)
            elif event_type == "connected":
                # Connection established
                pass
        except Exception as e:
            print(f"[SBP] SSE event handling error: {e}")


class SbpClient:
    """Synchronous SBP client wrapper"""

    def __init__(
        self,
        url: str = "http://localhost:3000",
        agent_id: str | None = None,
        timeout: float = 30.0,
        local: bool = False,
    ):
        self._async_client = AsyncSbpClient(url, agent_id, timeout, local)
        self._loop: asyncio.AbstractEventLoop | None = None

    def _get_loop(self) -> asyncio.AbstractEventLoop:
        if self._loop is None or self._loop.is_closed():
            try:
                self._loop = asyncio.get_event_loop()
            except RuntimeError:
                self._loop = asyncio.new_event_loop()
                asyncio.set_event_loop(self._loop)
        return self._loop

    def _run(self, coro: Awaitable[Any]) -> Any:
        return self._get_loop().run_until_complete(coro)

    def connect(self) -> None:
        self._run(self._async_client.connect())

    def close(self) -> None:
        self._run(self._async_client.close())

    def emit(
        self,
        trail: str,
        type: str,
        intensity: float,
        *,
        decay: DecayModel | None = None,
        payload: dict[str, Any] | None = None,
        tags: list[str] | None = None,
        merge_strategy: str = "reinforce",
    ) -> EmitResult:
        return self._run(
            self._async_client.emit(
                trail, type, intensity,
                decay=decay, payload=payload, tags=tags, merge_strategy=merge_strategy
            )
        )

    def sniff(
        self,
        trails: list[str] | None = None,
        types: list[str] | None = None,
        *,
        min_intensity: float = 0,
        limit: int = 100,
    ) -> SniffResult:
        return self._run(
            self._async_client.sniff(trails, types, min_intensity=min_intensity, limit=limit)
        )

    def register_scent(
        self,
        scent_id: str,
        condition: ScentCondition,
        *,
        agent_endpoint: str | None = None,
        cooldown_ms: int = 0,
        activation_payload: dict[str, Any] | None = None,
    ) -> RegisterScentResult:
        return self._run(
            self._async_client.register_scent(
                scent_id, condition,
                agent_endpoint=agent_endpoint,
                cooldown_ms=cooldown_ms,
                activation_payload=activation_payload,
            )
        )

    def deregister_scent(self, scent_id: str) -> DeregisterScentResult:
        return self._run(self._async_client.deregister_scent(scent_id))

    def evaporate(
        self,
        trail: str | None = None,
        types: list[str] | None = None,
        *,
        older_than_ms: int | None = None,
        below_intensity: float | None = None,
    ) -> EvaporateResult:
        return self._run(
            self._async_client.evaporate(
                trail, types,
                older_than_ms=older_than_ms,
                below_intensity=below_intensity,
            )
        )

    def inspect(self, include: list[str] | None = None) -> InspectResult:
        return self._run(self._async_client.inspect(include))

    def __enter__(self) -> "SbpClient":
        self.connect()
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()
