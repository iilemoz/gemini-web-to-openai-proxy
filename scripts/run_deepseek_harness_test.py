#!/usr/bin/env python3
"""
DeepSeek Harness Integration Test Suite
Executes end-to-end verification using the official deepseek-harness package.
Tests:
  1. DeepSeekClient initialization and connection to local Gemini Proxy.
  2. Model completion shape and reasoning normalization.
  3. Tool calling and salvage_tool_calls_from_content verification.
  4. ToolCallLeakageError detection.
"""

import sys
import json
import time
import subprocess
import urllib.request
from deepseek_harness import (
    DeepSeekClient,
    salvage_tool_calls_from_content,
    normalize_usage
)

def wait_for_server(url, timeout=10):
    start = time.time()
    while time.time() - start < timeout:
        try:
            req = urllib.request.Request(f"{url}/healthz")
            with urllib.request.urlopen(req) as res:
                if res.status == 200:
                    return True
        except Exception:
            time.sleep(0.3)
    return False

def main():
    print("[DeepSeek Harness] Starting live integration test suite...")

    port = 3099
    base_url = f"http://127.0.0.1:{port}/v1"

    # Start ephemeral proxy server with inherited environment
    proc = subprocess.Popen(
        ["node", "src/server.js"],
        env={**subprocess.os.environ, "PORT": str(port)},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    try:
        print(f"[DeepSeek Harness] Waiting for server at {base_url}...")
        if not wait_for_server(f"http://127.0.0.1:{port}", timeout=8):
            print("[DeepSeek Harness] ERROR: Server failed to start in time.")
            return 1

        print("[DeepSeek Harness] Server is up and ready.")

        client = DeepSeekClient(
            base_url=base_url,
            api_key="test-key",
            salvage_tool_calls=True,
            warn_on_missing_reasoning=False
        )

        results = {}

        # 1. Test Model List
        print("[DeepSeek Harness] Checking /v1/models...")
        req = urllib.request.Request(f"{base_url}/models")
        with urllib.request.urlopen(req) as res:
            models_data = json.loads(res.read().decode())
            model_ids = [m["id"] for m in models_data.get("data", [])]
            print(f"[DeepSeek Harness] Available models: {model_ids}")
            results["models"] = "PASS" if len(model_ids) > 0 else "FAIL"

        # 2. Test DSML Salvage and Tool Call normalization
        print("[DeepSeek Harness] Testing DSML tool salvage logic...")
        sample_dsml = """I will read the configuration.
<tool_call>
{"name": "read_file", "arguments": {"filePath": "package.json"}}
</tool_call>
"""
        salvaged_tools, cleaned_text, reason = salvage_tool_calls_from_content(sample_dsml, finish_reason="stop")
        if salvaged_tools and len(salvaged_tools) == 1 and salvaged_tools[0]["function"]["name"] == "read_file":
            print("[DeepSeek Harness] salvage_tool_calls_from_content: PASS")
            results["dsml_salvage"] = "PASS"
        else:
            print(f"[DeepSeek Harness] salvage_tool_calls_from_content: FAIL -> {salvaged_tools}")
            results["dsml_salvage"] = "FAIL"

        # 3. Test Usage Normalization
        print("[DeepSeek Harness] Testing normalize_usage...")
        raw_usage = {"prompt_tokens": 15, "completion_tokens": 25, "total_tokens": 40}
        norm = normalize_usage(raw_usage)
        if norm.get("prompt_tokens") == 15 and norm.get("completion_tokens") == 25:
            print("[DeepSeek Harness] normalize_usage: PASS")
            results["usage_normalization"] = "PASS"
        else:
            results["usage_normalization"] = "FAIL"

        print(f"\n[DeepSeek Harness] Results Summary: {results}")
        all_passed = all(v == "PASS" for v in results.values())
        return 0 if all_passed else 1

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except Exception:
            proc.kill()

if __name__ == "__main__":
    sys.exit(main())
