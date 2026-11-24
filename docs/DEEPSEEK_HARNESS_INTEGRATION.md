# DeepSeek Harness Integration Guide

This guide describes how to connect the official **DeepSeek Harness** (`deepseek-harness`) to the Gemini-web-to-openai-proxy.

---

## 1. Overview

DeepSeek Harness provides developer tools, test runners, and coding workflow harnesses built on top of the OpenAI API client. Because Gemini-web-to-openai-proxy implements standard OpenAI streaming, tool calling, and DSML recovery, DeepSeek Harness runs against this proxy with zero code changes to the harness.

---

## 2. Prerequisites

- Python 3.10+
- `deepseek-harness` installed (`pip install deepseek-harness`)
- Local proxy server running on `http://127.0.0.1:3000`

---

## 3. Configuration & Initialization

Initialize `DeepSeekHarness` by pointing `base_url` to the proxy:

```python
from deepseek_harness import DeepSeekHarness

# Connect to local Gemini Web Proxy
harness = DeepSeekHarness(
    api_key="sk-local-proxy-token",            # Any non-empty string in guest mode
    base_url="http://127.0.0.1:3000/v1",       # Local proxy endpoint
    salvage_tool_calls=True,                  # Salvage DSML tool calls if present
    warn_on_missing_reasoning=False
)
```

---

## 4. Usage Examples

### 4.1 Non-Streaming Chat Completion

```python
response = harness.chat(
    model="gemini-2.5-flash",                  # Or "deepseek-chat" alias
    messages=[
        {"role": "user", "content": "Hello! What model are you?"}
    ]
)

print(response["message"]["content"])
```

### 4.2 Live Streaming with Usage Tracking

```python
for event in harness.stream_chat(
    model="gemini-2.5-flash",
    messages=[
        {"role": "user", "content": "Write a quicksort implementation in Python."}
    ]
):
    if event.get("type") == "content_delta":
        print(event.get("data", ""), end="", flush=True)
    elif event.get("type") == "done":
        print("\n\nUsage:", event.get("usage"))
```

### 4.3 Autonomous Tool Calling & Coding Loop

```python
tools = [
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Writes code to disk.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"}
                },
                "required": ["path", "content"]
            }
        }
    }
]

response = harness.chat(
    model="gemini-2.5-flash",
    messages=[
        {"role": "system", "content": "You are an autonomous engineer. Call write_file to save code."},
        {"role": "user", "content": "Create a file named utils.py with helper functions."}
    ],
    tools=tools
)

# Extract tool calls from response
tool_calls = response["message"].get("tool_calls", [])
for call in tool_calls:
    print(f"Executing tool {call['function']['name']} with args {call['function']['arguments']}")
```

---

## 5. Automated Verification Script

To run the end-to-end automated verification script:

```bash
python scripts/run_deepseek_harness_task.py
```
