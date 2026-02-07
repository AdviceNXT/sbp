# SBP + LangChain Integration Demo

This directory contains examples of how to integrate Stigmergic Blackboard Protocol (SBP) with LangChain agents.

## 1. Minimal Comparison

See how easy it is to upgrade a standard LangChain agent to an SBP-enabled agent.

*   **`standard_agent.py`**: A vanilla LangChain agent that reports findings to stdout.
*   **`sbp_agent.py`**: The same agent, but "enhanced" to emit findings to the shared blackboard.

**Key Differences:**
1.  **Import**: `from sbp.client import AsyncSbpClient`
2.  **Initialize**: `sbp = AsyncSbpClient()`
3.  **Emit**: Calls `await sbp.emit(...)` inside the tool.

## 2. Multi-Agent Orchestration

*   **`complex_demo.py`**: A full reactive architecture where:
    1.  A **Researcher Agent** emits findings to `science.space`.
    2.  A **Writer Agent** (running in background) *automatically wakes up* when it smells the 'finding' signal, writes a tweet, and posts it to `social.twitter`.

**Local Mode:**
This demo uses `local=True` which runs an **in-memory blackboard**. You do **NOT** need to run the SBP server separately. This makes it perfect for testing and single-process simulations.

## Setup

1.  **Install Python Dependencies**:
    ```bash
    pip install -r requirements.txt
    ```

2.  **Install SBP Client**:
    ```bash
    pip install -e ../../../packages/client-python
    ```

3.  **Set API Key**:
    ```bash
    cp .env.example .env
    # Edit .env to add your OPENAI_API_KEY
    ```

## Running

```bash
# Run standard agent
python standard_agent.py

# Run SBP-enabled agent
python sbp_agent.py

# Run full multi-agent demo (no server required!)
python complex_demo.py
```
