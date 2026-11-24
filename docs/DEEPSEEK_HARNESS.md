# DeepSeek Harness Integration Guide

This guide details configuring and using the Universal AI Agent Infrastructure with [DeepSeek-ai/deepseek-harness](https://github.com/DeepSeek-ai/deepseek-harness) for benchmark evaluation and autonomous software engineering.

---

## 1. Overview

The DeepSeek Harness evaluates LLMs on real-world coding benchmarks (such as SWE-bench, HumanEval, and custom agent task suites). It expects an OpenAI-compliant API endpoint supporting:
- Chat completions (`POST /v1/chat/completions`)
- Streaming and non-streaming responses
- Structured function / tool calling
- High context window capacity
- Standard error formats and rate-limit retry headers (`429 Retry-After`)

---

## 2. Configuration for DeepSeek Harness

### Environment Variables
Configure your DeepSeek Harness evaluation environment to point to this proxy:

```bash
export OPENAI_BASE_URL="http://localhost:3000/v1"
export OPENAI_API_KEY="your-proxy-api-key-or-any-string"
export MODEL_NAME="gemini-flash" # or gemini-pro / deepseek-chat
```

### Config File Example (`config.yaml` or harness settings)
```yaml
evaluation:
  benchmark: "swe-bench-lite"
  concurrency: 4
  timeout: 300

model:
  provider: "openai"
  model_name: "gemini-flash"
  api_base: "http://localhost:3000/v1"
  api_key: "proxy-secret-key"
  temperature: 0.0
  max_tokens: 4096
  retry:
    max_retries: 5
    backoff_factor: 2
```

---

## 3. Tool Calling Verification

DeepSeek Harness passes standard OpenAI function definitions in the `tools` array:

```json
{
  "model": "gemini-flash",
  "messages": [
    { "role": "user", "content": "Find all occurrences of 'handleAuth' in src/" }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "search_code",
        "description": "Search code across files",
        "parameters": {
          "type": "object",
          "properties": {
            "pattern": { "type": "string" }
          },
          "required": ["pattern"]
        }
      }
    }
  ]
}
```

The proxy formats instructions into the model prompt and parses tool invocations into standard OpenAI tool calls:
```json
{
  "id": "chatcmpl-xxx",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "tool_calls": [
          {
            "id": "call_12345",
            "type": "function",
            "function": {
              "name": "search_code",
              "arguments": "{\"pattern\":\"handleAuth\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ]
}
```

---

## 4. Rate Limiting and Resilience

When DeepSeek Harness issues concurrent tasks:
- Built-in token-bucket rate limiting protects against quota limits.
- Returns `HTTP 429 Too Many Requests` with `Retry-After: <seconds>` headers.
- The harness automatically honors the backoff and retries without dropping benchmarks.
