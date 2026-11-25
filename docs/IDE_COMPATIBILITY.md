# IDE & AI Coding Client Compatibility

The Universal AI Agent Infrastructure is designed to power major AI coding environments, IDE plugins, and agent harnesses seamlessly.

---

## Compatible Tools & IDEs

| Client / Tool | Protocol | Base URL | Model Setting |
| :--- | :--- | :--- | :--- |
| **Continue.dev (VS Code / JetBrains)** | OpenAI Compatible | `http://localhost:3000/v1` | `gemini-flash` |
| **Cline / Roo Code (VS Code)** | OpenAI Compatible / MCP | `http://localhost:3000/v1` | `gemini-flash` |
| **Aider** | OpenAI Compatible | `http://localhost:3000/v1` | `gemini-flash` |
| **DeepSeek Harness** | OpenAI Compatible | `http://localhost:3000/v1` | `gemini-flash` |
| **Claude Desktop** | MCP (Model Context Protocol) | `http://localhost:3000/v1/mcp` | N/A (Tool Provider) |

---

## Continue.dev Configuration Example (`config.json`)

```json
{
  "models": [
    {
      "title": "Gemini Universal Agent (Flash)",
      "provider": "openai",
      "model": "gemini-flash",
      "apiBase": "http://localhost:3000/v1",
      "apiKey": "optional-proxy-key"
    }
  ]
}
```

## Aider Configuration Example

```bash
aider --openai-api-base http://localhost:3000/v1 --openai-api-key none --model openai/gemini-flash
```
