import asyncio
import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

load_dotenv()

from langchain.agents import AgentExecutor, create_openai_functions_agent
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.tools import tool

# 1. Define a tool
@tool
def report_finding(content: str) -> str:
    """Report a finding."""
    print(f"\n[Standard Agent] Reporting finding: {content}")
    return "Finding reported."

async def main():
    if not os.getenv("OPENAI_API_KEY"):
        print("Please set OPENAI_API_KEY")
        return

    # 2. Setup Agent
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
    print("--- Starting Standard Agent ---")
    await executor.ainvoke({"input": "Find a fact about Mars and report it."})

if __name__ == "__main__":
    asyncio.run(main())
