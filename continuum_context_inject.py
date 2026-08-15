#!/usr/bin/env python3
"""UserPromptSubmit hook: auto-inject relevant Continuum memory into every
message, without relying on the model deciding to call memory_search.

Installed by Continuum's install-hook script. Pure stdlib and no shell, so the
same file runs unchanged on Linux, macOS and Windows. Never blocks the prompt:
any failure, timeout, or missing token exits 0 silently and the message
proceeds with no injected context.
"""

import json
import os
import sys
import urllib.request
from pathlib import Path

STATE_DIR = Path.home() / ".continuum"
TOKEN_FILE = STATE_DIR / "hook-token"
DISABLE_FILE = STATE_DIR / "hook-disabled"
WORKSPACE_MAP = STATE_DIR / "workspace-map.json"

CONTINUUM_URL = os.environ.get("CONTINUUM_MCP_URL", "https://continuum-mcp.sshogunn.org")
TIMEOUT_SECONDS = 3.0
RECENT_TURNS = 6
RECENT_TURN_CHARS = 600
RECENT_TOTAL_CHARS = 2000


def text_of(message):
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        )
    return ""


def recent_turns(transcript_path):
    if not transcript_path:
        return ""
    turns = []
    try:
        with open(transcript_path, encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                message = entry.get("message")
                if not isinstance(message, dict):
                    continue
                role = message.get("role")
                if role not in ("user", "assistant"):
                    continue
                body = text_of(message).strip()
                if body:
                    turns.append("%s: %s" % (role, body[:RECENT_TURN_CHARS]))
    except OSError:
        return ""
    return "\n".join(turns[-RECENT_TURNS:])[-RECENT_TOTAL_CHARS:]


def workspace_for(cwd):
    if not cwd:
        return ""
    try:
        with open(WORKSPACE_MAP, encoding="utf-8") as f:
            return json.load(f).get(cwd, "") or ""
    except (OSError, ValueError):
        return ""


def post_context(token, payload):
    request = urllib.request.Request(
        CONTINUUM_URL.rstrip("/") + "/hook/context",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


def main():
    if DISABLE_FILE.exists():
        return
    try:
        token = TOKEN_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return
    if not token:
        return

    data = json.load(sys.stdin)
    prompt = data.get("prompt") or ""
    if not prompt:
        return

    payload = {"query": prompt}
    workspace = workspace_for(data.get("cwd") or "")
    if workspace:
        payload["workspace"] = workspace
    recent = recent_turns(data.get("transcript_path") or "")
    if recent:
        payload["recent"] = recent

    context = post_context(token, payload).get("context")
    if context:
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",
                "additionalContext": context,
            }
        }))


if __name__ == "__main__":
    for stream in (sys.stdin, sys.stdout):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
