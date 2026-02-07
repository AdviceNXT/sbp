#!/usr/bin/env python3
"""
SBP Demo: Multi-Agent Task Pipeline

This demo shows 3 agents coordinating through the blackboard:
1. Producer - Emits tasks
2. Worker - Processes tasks when they appear
3. Monitor - Alerts when task queue backs up

Run:
    # Terminal 1: Start server
    cd packages/server && npm run dev

    # Terminal 2: Run this demo
    python3 demo/pipeline.py
"""

import asyncio
import random
from sbp import AsyncSbpClient, ThresholdCondition, CompositeCondition, TriggerPayload

# Colors for terminal output
class Colors:
    PRODUCER = "\033[94m"  # Blue
    WORKER = "\033[92m"    # Green
    MONITOR = "\033[93m"   # Yellow
    RESET = "\033[0m"
    BOLD = "\033[1m"


async def producer(client: AsyncSbpClient):
    """Produces tasks at random intervals"""
    task_id = 0

    print(f"{Colors.PRODUCER}[Producer] Starting - will emit tasks...{Colors.RESET}")

    while True:
        task_id += 1
        priority = random.uniform(0.3, 1.0)

        result = await client.emit(
            trail="pipeline.tasks",
            type="pending",
            intensity=priority,
            payload={
                "task_id": task_id,
                "name": f"Task-{task_id}",
                "created_by": "producer",
            },
            merge_strategy="new",  # Always create new task
        )

        print(f"{Colors.PRODUCER}[Producer] Created task #{task_id} (priority: {priority:.2f}){Colors.RESET}")

        # Random delay between tasks
        await asyncio.sleep(random.uniform(1, 3))


async def worker(client: AsyncSbpClient):
    """
    Worker agent - triggered when pending tasks exist.
    Demonstrates the "sniff" pattern: sensing environment state.
    """
    print(f"{Colors.WORKER}[Worker] Starting - polling for tasks...{Colors.RESET}")

    while True:
        # Sniff for pending tasks
        result = await client.sniff(
            trails=["pipeline.tasks"],
            types=["pending"],
            min_intensity=0.1,
            limit=1,
        )

        if result.pheromones:
            task = result.pheromones[0]
            task_info = task.payload

            print(f"{Colors.WORKER}[Worker] Processing: {task_info.get('name')} (intensity: {task.current_intensity:.2f}){Colors.RESET}")

            # Simulate work
            await asyncio.sleep(random.uniform(0.5, 1.5))

            # Emit completion signal
            await client.emit(
                trail="pipeline.tasks",
                type="completed",
                intensity=1.0,
                payload={
                    "task_id": task_info.get("task_id"),
                    "processed_by": "worker",
                },
            )

            # "Consume" the pending task by emitting a cancellation
            # (In real system, you'd have a proper claim/complete mechanism)
            await client.emit(
                trail="pipeline.tasks",
                type="pending",
                intensity=0.0,  # Zero intensity = consumed
                payload=task_info,
                merge_strategy="replace",
            )

            print(f"{Colors.WORKER}[Worker] Completed: {task_info.get('name')}{Colors.RESET}")
        else:
            # No tasks, wait a bit
            await asyncio.sleep(0.5)


async def monitor(client: AsyncSbpClient):
    """
    Monitor agent - uses SSE triggers to alert on backlog.
    Demonstrates the "scent" pattern: declarative triggering.
    """
    print(f"{Colors.MONITOR}[Monitor] Starting - watching for backlog...{Colors.RESET}")

    # Register a scent for task backlog (5+ pending tasks)
    await client.register_scent(
        scent_id="backlog-alert",
        condition=ThresholdCondition(
            trail="pipeline.tasks",
            signal_type="pending",
            aggregation="count",
            operator=">=",
            value=5,
        ),
        cooldown_ms=10000,  # Only alert every 10 seconds
    )

    # Handler for when backlog is detected
    async def on_backlog(trigger: TriggerPayload):
        pending_count = len([
            p for p in trigger.context_pheromones
            if p.type == "pending" and p.current_intensity > 0.1
        ])
        print(f"\n{Colors.MONITOR}{Colors.BOLD}⚠️  [Monitor] BACKLOG ALERT! {pending_count} tasks pending!{Colors.RESET}\n")

    # Subscribe to triggers
    await client.subscribe("backlog-alert", on_backlog)

    # Keep running
    while True:
        await asyncio.sleep(1)


async def dashboard(client: AsyncSbpClient):
    """Periodically shows environment state"""
    while True:
        await asyncio.sleep(5)

        result = await client.sniff(
            trails=["pipeline.tasks"],
            min_intensity=0.05,
        )

        pending = sum(1 for p in result.pheromones if p.type == "pending" and p.current_intensity > 0.1)
        completed = sum(1 for p in result.pheromones if p.type == "completed")

        print(f"\n{'='*50}")
        print(f"  Pipeline Status: {pending} pending, {completed} completed")
        print(f"  Total signals: {len(result.pheromones)}")
        for key, agg in result.aggregates.items():
            print(f"    {key}: count={agg.count}, max={agg.max_intensity:.2f}")
        print(f"{'='*50}\n")


async def main():
    print(f"""
{Colors.BOLD}╔════════════════════════════════════════════════════════════╗
║           SBP Demo: Multi-Agent Task Pipeline              ║
╠════════════════════════════════════════════════════════════╣
║  Producer  → Emits tasks with random priority              ║
║  Worker    → Processes tasks (sniff pattern)               ║
║  Monitor   → Alerts on backlog (trigger pattern)           ║
╚════════════════════════════════════════════════════════════╝
{Colors.RESET}
Connecting to SBP server at http://localhost:3000...
Press Ctrl+C to stop.
""")

    # Create clients for each agent
    producer_client = AsyncSbpClient(agent_id="producer")
    worker_client = AsyncSbpClient(agent_id="worker")
    monitor_client = AsyncSbpClient(agent_id="monitor")
    dashboard_client = AsyncSbpClient(agent_id="dashboard")

    await producer_client.connect()
    await worker_client.connect()
    await monitor_client.connect()
    await dashboard_client.connect()

    try:
        # Run all agents concurrently
        await asyncio.gather(
            producer(producer_client),
            worker(worker_client),
            monitor(monitor_client),
            dashboard(dashboard_client),
        )
    except KeyboardInterrupt:
        print("\n\nShutting down...")
    finally:
        await producer_client.close()
        await worker_client.close()
        await monitor_client.close()
        await dashboard_client.close()


if __name__ == "__main__":
    asyncio.run(main())
