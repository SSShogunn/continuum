#!/usr/bin/env python3
"""SessionEnd hook: hand the finished transcript to Continuum, which extracts
memory candidates for review in the dashboard. Nothing is written to memory
automatically — the candidates sit in a queue until approved.

Installed by Continuum's install-hook script. Pure stdlib and no shell, so the
same file runs unchanged on Linux, macOS and Windows. Exits 0 on any failure.
"""

import json
import os
import sys
import urllib.request
from pathlib import Path

STATE_DIR = Path.home() / ".continuum"
TOKEN_FILE = STATE_DIR / "hook-token"
DISABLE_FILE = STATE_DIR / "hook-disabled"
CAPTURE_DISABLE_FILE = STATE_DIR / "capture-disabled"
WORKSPACE_MAP = STATE_DIR / "workspace-map.json"

CONTINUUM_URL = os.environ.get("CONTINUUM_MCP_URL", "https://continuum-mcp.sshogunn.org")
TIMEOUT_SECONDS = 10.0
TURN_CHARS = 4000
TRANSCRIPT_CHARS = 40000


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


def transcript_text(transcript_path):
    turns = []
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
                turns.append("%s: %s" % (role, body[:TURN_CHARS]))
    return "\n\n".join(turns)[-TRANSCRIPT_CHARS:]


def workspace_for(cwd):
    if not cwd:
        return ""
    try:
        with open(WORKSPACE_MAP, encoding="utf-8") as f:
            return json.load(f).get(cwd, "") or ""
    except (OSError, ValueError):
        return ""


def main():
    if DISABLE_FILE.exists() or CAPTURE_DISABLE_FILE.exists():
        return
    try:
        token = TOKEN_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return
    if not token:
        return

    data = json.load(sys.stdin)
    transcript_path = data.get("transcript_path") or ""
    if not transcript_path:
        return
    transcript = transcript_text(transcript_path)
    if not transcript.strip():
        return

    payload = {"transcript": transcript, "session_id": data.get("session_id") or ""}
    workspace = workspace_for(data.get("cwd") or "")
    if workspace:
        payload["workspace"] = workspace

    request = urllib.request.Request(
        CONTINUUM_URL.rstrip("/") + "/hook/session",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        response.read()


if __name__ == "__main__":
    try:
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
