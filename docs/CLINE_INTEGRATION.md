# Cline (Claude Dev) Integration Guide

This guide details configuring and using **Cline** (formerly Claude Dev) in Visual Studio Code with the Gemini-web-to-openai-proxy backend.

---

## 1. Overview

Cline is an autonomous coding agent extension for VS Code that executes terminal commands, edits files, and creates projects. By pointing Cline to the Gemini proxy using the **OpenAI Compatible** provider, you can power Cline using Google Gemini models without paying for proprietary OpenAI/Anthropic API keys.

---

## 2. Configuration Steps in VS Code

1. Open VS Code.
2. Click the **Cline** robot icon in the Activity Bar.
3. Click the **Settings (gear icon)** at the top of the Cline panel.
4. Set the following fields:
   - **API Provider**: `OpenAI Compatible`
   - **Base URL**: `http://127.0.0.1:3000/v1`
   - **API Key**: `sk-gemini-proxy` (any non-empty string in Guest Mode, or matching `API_KEY` from `.env`)
   - **Model ID**: `gemini-2.5-flash` or `gemini-2.5-pro` (or alias `gpt-4o`)
5. Optional Settings:
   - **Custom instructions**: "You are an autonomous software engineer. Follow standard tool calling and keep responses concise."
6. Click **Done** / Save.

---

## 3. Recommended Settings for Coding Agents

- **Default Model**: `gemini-2.5-flash` (fastest turnaround for iterative terminal and file editing).
- **Complex Architectures**: `gemini-2.5-pro` (large context window, higher reasoning depth).
- **Streaming**: Supported out of the box via SSE chunking.

---

## 4. Verification

1. Start a new Cline chat in VS Code.
2. Send: `Inspect the files in this workspace and tell me the package name.`
3. Cline will call its file listing tools, stream reasoning tokens, and reply with the project name.
