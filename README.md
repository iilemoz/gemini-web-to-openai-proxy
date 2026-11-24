# Gemini Web to OpenAI API Proxy 🚀

[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-339933?style=flat&logo=node.js)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI%20Compatible-412991?logo=openai)](https://platform.openai.com/docs/api-reference)
[![Author](https://img.shields.io/badge/Author-Lemo-orange.svg)](#author--credits)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/)

> **Created by Lemo**  
> A high-performance, lightweight, pure HTTP OpenAI-compatible reverse proxy that bridges **Google Gemini Web** to standard OpenAI API endpoints (`/v1/chat/completions` and `/v1/models`).

---

## 🌟 Key Features

- **⚡ 100% Pure HTTP (No Headless Browser)**: Operates entirely via direct, high-speed HTTP network requests without Puppeteer, Playwright, or Selenium. No heavy browser overhead, no display server dependencies, and no CAPTCHA interruptions.
- **👥 Dual Operational Modes**:
  - **Guest Mode (Default)**: Ready out-of-the-box! Requires zero credentials or cookies. Perfect for instant usage and testing.
  - **Account Mode**: Pass your Google Gemini cookie (`__Secure-1PSID`) via `.env` or Bearer token to unlock your account's quotas, custom settings, and advanced models.
- **🌊 Complete Streaming (SSE) & Non-Streaming**: Seamlessly works with all standard OpenAI clients, official Python/Node SDKs, LangChain, LlamaIndex, Continue, and coding extensions.
- **🧠 Deep Reasoning Support**: Real-time reasoning stream (`reasoning_content`) support with `gemini-thinking` and `gemini-2.5-thinking`.
- **🛠️ Autonomous Function Calling (Tools)**: Full support for OpenAI function definitions (`tools` & `tool_choice`), automatically executed and parsed into OpenAI-standard `tool_calls` responses.
- **🧹 Artifact Cleaning**: Intelligently strips out web TTS audio widgets, internal Google metadata, and media tokens for clean, pristine markdown output.

---

## 📋 Supported Models

| Model ID | Description | Best For |
| :--- | :--- | :--- |
| `gemini-flash` | Google Gemini 2.5 Flash / Gemini 3 Flash | Fast everyday tasks, coding, general chat |
| `gemini-2.5-flash` | Google Gemini 2.5 Flash Flagship Speed Alias | High throughput, quick responses |
| `gemini-pro` | Google Gemini 2.5 Pro / Gemini 3 Pro | Complex problem solving, multi-step coding |
| `gemini-2.5-pro` | Google Gemini 2.5 Pro Alias | In-depth analysis and architecture |
| `gemini-thinking` | Google Gemini Thinking Model | Deep mathematical, logical, and code reasoning |
| `gemini-2.5-thinking` | Google Gemini 2.5 Thinking | Advanced reasoning with thoughts stream |
| `gemini-lite` | Google Gemini Lite | Lightweight tasks and minimal latency |

---

## 🏗️ Architecture & Project Structure

```text
Arena/
├── src/
│   ├── config/              # Server configuration and model catalog
│   │   └── index.js
│   ├── controllers/         # Express API controllers (/v1/chat/completions, /v1/models)
│   │   ├── chatController.js
│   │   └── modelsController.js
│   ├── providers/           # Provider abstraction layer
│   │   ├── BaseProvider.js
│   │   ├── gemini/
│   │   │   ├── GeminiEngine.js  # Core engine (Guest & Account Mode, streaming, tool handling)
│   │   │   └── index.js
│   │   └── index.js         # Provider registry
│   ├── routes/              # Express API route definitions
│   │   └── v1.js
│   ├── utils/               # SSE formatting, DSML tool parser, logging
│   │   ├── dsmlParser.js
│   │   ├── logger.js
│   │   └── sse.js
│   ├── app.js               # Express application setup & middleware
│   └── server.js            # Main server entrypoint
├── .env.example             # Example environment file
├── .gitignore
├── package.json
└── README.md
```

---

## 🚀 Quick Start

### 1. Prerequisites
- [Node.js](https://nodejs.org/) v18.0.0 or higher.
- [npm](https://www.npmjs.com/) installed.

### 2. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/iilemoz/gemini-web-to-openai-proxy.git
cd gemini-web-to-openai-proxy
npm install
```

### 3. Environment Configuration
Copy the sample environment file:
```bash
cp .env.example .env
```

Open `.env` in your text editor:
```env
PORT=3000
HOST=0.0.0.0
DEFAULT_MODEL=gemini-flash

# Optional: Add your Google Gemini cookie for Account Mode (leave blank for Guest Mode)
GEMINI_SECURE_1PSID=
GEMINI_SECURE_1PSIDTS=

# Optional: Set a secret key to protect your proxy endpoint
PROXY_API_KEY=
```

### 4. Run the Server
- **Production Mode:**
  ```bash
  npm start
  ```
- **Development Mode (Auto-reload on file changes):**
  ```bash
  npm run dev
  ```

The server will start listening at `http://127.0.0.1:3000`.

---

## ⚙️ Guest Mode vs Account Mode

- **Guest Mode (Default)**:
  - If `GEMINI_SECURE_1PSID` is left empty in `.env`, the proxy operates automatically in anonymous Guest Mode.
  - Requires no setup or account.
- **Account Mode**:
  - Log in to [gemini.google.com](https://gemini.google.com).
  - Open Browser DevTools (`F12`) -> **Application** -> **Cookies** -> `https://gemini.google.com`.
  - Copy the value of `__Secure-1PSID` (and optionally `__Secure-1PSIDTS`).
  - Paste into your `.env` file or pass as `Authorization: Bearer <__Secure-1PSID>` in your HTTP requests.

---

## 📡 Usage Examples

### 1. List Available Models
```bash
curl http://localhost:3000/v1/models
```

### 2. Chat Completion (Non-Streaming)
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-flash",
    "messages": [
      {"role": "user", "content": "Explain quantum computing in one sentence."}
    ],
    "stream": false
  }'
```

### 3. Chat Completion (Streaming)
```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-flash",
    "messages": [
      {"role": "user", "content": "Write a 3-line poem about space."}
    ],
    "stream": true
  }'
```

---

## 🐍 Python OpenAI SDK Integration

Use the official `openai` Python SDK with this proxy:

```python
from openai import OpenAI

# Point client to your local proxy
client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="sk-dummy"  # or your PROXY_API_KEY if configured
)

response = client.chat.completions.create(
    model="gemini-flash",
    messages=[
        {"role": "system", "content": "You are a helpful coding assistant."},
        {"role": "user", "content": "Write a Python function to check for prime numbers."}
    ],
    stream=True
)

for chunk in response:
    content = chunk.choices[0].delta.content or ""
    print(content, end="", flush=True)
print()
```

---

## 🟨 Node.js OpenAI SDK Integration

```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://127.0.0.1:3000/v1',
  apiKey: 'sk-dummy'
});

async function main() {
  const stream = await openai.chat.completions.create({
    model: 'gemini-thinking',
    messages: [{ role: 'user', content: 'What is 25 * 48? Think step by step.' }],
    stream: true,
  });

  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content || '');
  }
  console.log();
}

main();
```

---

## 🛠️ Function / Tool Calling

The proxy translates standard OpenAI tool definitions into executable instructions and packages the result into the OpenAI `tool_calls` format:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-flash",
    "messages": [
      {"role": "user", "content": "Write a python file named calc.py with an add function"}
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "write_file",
          "description": "Writes code to disk",
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
    ],
    "tool_choice": "auto"
  }'
```

---

## 👤 Author & Credits

- **Creator & Maintainer:** **Lemo**
- **Project:** Gemini Web to OpenAI API Proxy

Feel free to open issues, submit pull requests, or star ⭐ the repository if you find this project helpful!

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
