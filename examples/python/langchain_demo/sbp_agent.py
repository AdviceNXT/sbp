import asyncio
import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

load_dotenv()

from langchain.agents import AgentExecutor, create_openai_functions_agent
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.tools import tool

# +++ SBP Import
from sbp.client import AsyncSbpClient

async def main():
    if not os.getenv("OPENAI_API_KEY"):
        print("Please set OPENAI_API_KEY")
        return

    # +++ Initialize SBP Client (Local Mode)
    # Use local=True for in-memory blackboard (no server needed)
    sbp = AsyncSbpClient(local=True)
    await sbp.connect()

    # 1. Define a tool (Enhanced with SBP)
    @tool
    async def report_finding(content: str) -> str:
        """Report a finding."""
        print(f"\n[SBP Agent] Reporting finding: {content}")

        # +++ Emit to Blackboard
        await sbp.emit(
            trail="research.space",
            type="finding",
            intensity=0.8,
            payload={"content": content}
        )
        return "Finding reported to blackboard."

    # 2. Setup Agent (Identical)
    llm = ChatOpenAI(temperature=0)
    tools = [report_finding]

    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are a researcher."),
        ("user", "{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad"),
    ])

    agent = create_openai_functions_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=agent, tools=tools)

    # 3. Run Agent
    print("--- Starting SBP Agent ---")
    try:
        await executor.ainvoke({"input": "Find a fact about Mars and report it."})
    finally:
        # +++ Cleanup
        await sbp.close()

if __name__ == "__main__":
    asyncio.run(main())
