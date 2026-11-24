# Cursor IDE Integration Guide

This guide describes how to configure the **Cursor IDE** (AI-first code editor) to use Gemini-web-to-openai-proxy as a custom model provider.

---

## 1. Overview

Cursor allows overriding the OpenAI API Base URL. By pointing this override to the local proxy, Cursor Composer, Chat, and Inline Edits can utilize Gemini 2.5 Flash and Pro models seamlessly.

---

## 2. Configuration Steps in Cursor

1. Open **Cursor Settings**:
   - `Ctrl + Shift + J` (Windows / Linux) or `Cmd + Shift + J` (macOS), then navigate to **Cursor Settings** > **Models**.
2. **OpenAI API Key**:
   - Enter any placeholder key, e.g., `sk-cursor-proxy-token`.
3. **Override OpenAI Base URL**:
   - Click **More Settings** / **Override Base URL**.
   - Set URL to: `http://127.0.0.1:3000/v1`
4. **Configure Model Names**:
   - Under the **Model Names** list, click **+ Add Model**.
   - Add:
     - `gemini-2.5-flash`
     - `gemini-2.5-pro`
     - `gpt-4o` (automatically mapped to `gemini-2.5-flash` by the proxy)
     - `deepseek-chat`
5. Click **Verify** / Save.

---

## 3. Usage within Cursor

- **Cursor Chat (`Ctrl + L`)**: Select `gemini-2.5-flash` from the model dropdown. The conversation streams in real time.
- **Cursor Composer (`Ctrl + I`)**: Composer can generate and apply multi-file edits through standard OpenAI chat completions with streaming tokens.

---

## 4. Notes

- If your Cursor installation strips `/v1` from the URL, the proxy's dual route mounting at root `/` ensures requests to `/chat/completions` succeed without errors.
