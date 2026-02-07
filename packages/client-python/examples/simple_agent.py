"""
SBP Example: Simple Agent using the Declarative Framework

This example shows how to build an agent using the @agent.when decorator.

Run:
    # Terminal 1: Start the SBP server
    cd packages/server && npm run dev

    # Terminal 2: Run this agent
    cd packages/client-python && python -m examples.simple_agent

    # Terminal 3: Emit test signals
    curl -X POST http://localhost:3000/emit \
      -H "Content-Type: application/json" \
      -d '{"trail": "tasks", "type": "new_task", "intensity": 0.8, "payload": {"name": "Process data"}}'
"""

import asyncio
from sbp import SbpAgent, TriggerPayload, ThresholdCondition, run_agent


# Create the agent
agent = SbpAgent("task-worker", "http://localhost:3000")


# Simple threshold trigger using @when decorator
@agent.when("tasks", "new_task", operator=">=", value=0.5, cooldown_ms=5000)
async def handle_new_task(trigger: TriggerPayload) -> None:
    """Handle new task signals"""
    print(f"\n📋 New task received!")

    for p in trigger.context_pheromones:
        task_name = p.payload.get("name", "Unknown")
        print(f"   Task: {task_name}")
        print(f"   Intensity: {p.current_intensity:.2f}")

    # Emit a "processing" signal
    await agent.emit(
        "tasks",
        "processing",
        intensity=0.7,
        payload={"worker": agent.agent_id},
    )
    print("   ✓ Emitted processing signal")

    # Simulate work
    await asyncio.sleep(2)

    # Emit completion signal
    await agent.emit(
        "tasks",
        "completed",
        intensity=1.0,
        payload={
            "worker": agent.agent_id,
            "original_task": trigger.context_pheromones[0].payload if trigger.context_pheromones else {},
        },
    )
    print("   ✓ Task completed!")


# More complex condition using @on_scent decorator
@agent.on_scent(
    "high-load-detector",
    condition=ThresholdCondition(
        trail="tasks",
        signal_type="new_task",
        aggregation="count",
        operator=">=",
        value=5,
    ),
    cooldown_ms=30000,  # Only trigger once per 30 seconds
    context_trails=["tasks"],
)
async def handle_high_load(trigger: TriggerPayload) -> None:
    """Triggered when task queue is getting backed up"""
    pending_count = len([
        p for p in trigger.context_pheromones
        if p.type == "new_task"
    ])

    print(f"\n⚠️  High load detected! {pending_count} tasks pending")

    # Emit alert
    await agent.emit(
        "system.alerts",
        "high_load",
        intensity=0.9,
        payload={
            "pending_tasks": pending_count,
            "worker": agent.agent_id,
        },
    )


if __name__ == "__main__":
    print("=" * 50)
    print("SBP Task Worker Agent")
    print("=" * 50)
    print()
    print("Listening for task signals...")
    print("Send a task with:")
    print()
    print('  curl -X POST http://localhost:3000/emit \\')
    print('    -H "Content-Type: application/json" \\')
    print("    -d '{\"trail\": \"tasks\", \"type\": \"new_task\", \"intensity\": 0.8}'")
    print()
    print("Press Ctrl+C to stop")
    print()

    run_agent(agent)
