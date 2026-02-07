import asyncio
import os
from dotenv import load_dotenv

from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_openai_functions_agent
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.tools import tool

from sbp.client import AsyncSbpClient
from sbp.agent import SbpAgent
from sbp.types import TriggerPayload

load_dotenv()

async def main():
    if not os.getenv("OPENAI_API_KEY"):
        print("Please set OPENAI_API_KEY in .env file")
        return

    # 1. Setup SBP Client (Local Mode)
    # local=True uses an in-memory blackboard, no server required!
    sbp = AsyncSbpClient(local=True, agent_id="shared-client")
    await sbp.connect()

    # 2. Define SBP Tools (Simple Decorators)

    @tool
    async def emit_signal(trail: str, type: str, content: str) -> str:
        """Emit a signal to the blackboard."""
        await sbp.emit(trail, type, intensity=0.8, payload={"content": content})
        return f"Emitted '{type}' to '{trail}'"

    @tool
    async def sniff_signals(trail: str) -> str:
        """Check for signals on a trail."""
        result = await sbp.sniff(trails=[trail], limit=5)
        if not result.pheromones:
            return "No signals found."

        # Format for the LLM
        return "\n".join(
            f"- [{p.type}] {p.payload.get('content')}"
            for p in result.pheromones
        )

    tools = [emit_signal, sniff_signals]

    # 3. Helper to create agents
    def make_agent(name: str, instruction: str):
        llm = ChatOpenAI(temperature=0)
        prompt = ChatPromptTemplate.from_messages([
            ("system", f"You are {name}. {instruction}"),
            ("user", "{input}"),
            MessagesPlaceholder("agent_scratchpad"),
        ])
        agent = create_openai_functions_agent(llm, tools, prompt)
        return AgentExecutor(agent=agent, tools=tools)

    # 4. Create Agents
    researcher = make_agent("Researcher", "Find facts and emit them to 'science.space' as 'finding'.")
    writer = make_agent("Writer", "Write tweets about findings and emit them to 'social.twitter' as 'draft'.")

    # 5. Make Writer Reactive (The "Magic" Part)
    # We wrap the writer in an SBP Agent to listen for triggers
    writer_sbp = SbpAgent(agent_id="writer-agent", local=True)

    @writer_sbp.when(trail="science.space", signal_type="finding", value=0.5)
    async def on_finding(trigger: TriggerPayload):
        print(f"\n[Writer] 🔔 Waking up! Found new research data...")

        # Get content from the signal that woke us up
        content = trigger.context_pheromones[0].payload.get("content")

        # Delegate to the LangChain agent
        await writer.ainvoke({
            "input": f"Write a tweet about this finding: {content}"
        })

    # 6. Run Simulation
    print("--- Starting Multi-Agent System ---")
    writer_task = asyncio.create_task(writer_sbp.run()) # Start listener in background
    await asyncio.sleep(1)

    try:
        print("\n[Researcher] 🔎 Finding data...")
        await researcher.ainvoke({
            "input": "Research Mars and share a finding."
        })

        print("\n[System] ⏳ Waiting for Writer to react (stigmergy)...")
        await asyncio.sleep(5)

        print("\n[System] 🔍 Verifying results...")
        # Check if the tweet was posted
        result = await sbp.sniff(trails=["social.twitter"], types=["draft"])
        if result.pheromones:
            print(f"✅ SUCCESS! Found tweet: {result.pheromones[0].payload}")
        else:
            print("❌ No tweet found.")

    finally:
        writer_sbp.stop()
        await writer_task
        await sbp.close()

if __name__ == "__main__":
    asyncio.run(main())
