#!/usr/bin/env python3
"""Continuum — Claude Code auto-context installer.

Wires up a UserPromptSubmit hook that injects relevant Continuum memory into
every message automatically, without relying on the model deciding to call
memory_search, plus a SessionEnd hook that queues memory candidates for review.
Safe to re-run (idempotent) — re-running just refreshes the token and hook
scripts, and won't duplicate the settings.json entry.

This is the real installer for every platform; `install-hook.sh` is a thin
bootstrap that finds a Python and hands off to here. Usually you want that
instead:

  curl -fsSL https://continuum-mcp.sshogunn.org/install-hook.sh | CONTINUUM_TOKEN=<token> bash

<token> comes from the dashboard's Connections page ("Generate token"). If
CONTINUUM_TOKEN isn't set, this prompts for it interactively.
"""

import getpass
import json
import os
import stat
import sys
import urllib.request
from pathlib import Path

CONTINUUM_URL = os.environ.get("CONTINUUM_MCP_URL", "https://continuum-mcp.sshogunn.org").rstrip("/")

HOME = Path.home()
STATE_DIR = HOME / ".continuum"
CLAUDE_DIR = HOME / ".claude"
HOOKS_DIR = CLAUDE_DIR / "hooks"
SETTINGS_PATH = CLAUDE_DIR / "settings.json"
TOKEN_PATH = STATE_DIR / "hook-token"

HOOKS = [
    ("UserPromptSubmit", "continuum-context-inject", "continuum_context_inject.py", 5),
    ("SessionEnd", "continuum-session-capture", "continuum_session_capture.py", 15),
]


def interpreter():
    if sys.prefix != sys.base_prefix:
        base = getattr(sys, "_base_executable", "")
        if base and Path(base).is_file():
            return base
    return sys.executable


def fail(message):
    print("error: " + message, file=sys.stderr)
    sys.exit(1)


def read_token():
    token = (os.environ.get("CONTINUUM_TOKEN") or "").strip()
    if token:
        return token
    if not sys.stdin.isatty():
        fail(
            "No CONTINUUM_TOKEN provided and no terminal to prompt on. Re-run with:\n"
            "  curl -fsSL %s/install-hook.sh | CONTINUUM_TOKEN=<token> bash" % CONTINUUM_URL
        )
    token = getpass.getpass("Paste your Continuum token (from the dashboard's Connections page): ").strip()
    if not token:
        fail("No token provided — aborting.")
    return token


def download(name):
    url = "%s/%s" % (CONTINUUM_URL, name)
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            return response.read()
    except Exception as exc:
        fail("could not download %s (%s)" % (url, exc))


def write_private(path, data):
    path.write_bytes(data)
    if os.name == "posix":
        path.chmod(stat.S_IRUSR | stat.S_IWUSR)


def load_settings():
    try:
        with open(SETTINGS_PATH, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}
    except ValueError:
        fail("%s has invalid JSON — fix it by hand, then re-run" % SETTINGS_PATH)


def register(hooks, event, stem, command, timeout):
    groups = hooks.setdefault(event, [])
    for group in groups:
        for entry in group.get("hooks", []):
            if stem in str(entry.get("command", "")):
                if entry.get("command") == command and entry.get("timeout") == timeout:
                    return "already registered"
                entry["command"] = command
                entry["timeout"] = timeout
                entry["type"] = "command"
                return "updated"
    groups.append({
        "matcher": "*",
        "hooks": [{"type": "command", "command": command, "timeout": timeout}],
    })
    return "registered"


def main():
    if sys.version_info < (3, 8):
        fail("Python 3.8+ required, got %s" % sys.version.split()[0])

    token = read_token()
    sources = {name: download(name) for _, _, name, _ in HOOKS}

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    HOOKS_DIR.mkdir(parents=True, exist_ok=True)
    write_private(TOKEN_PATH, token.encode("utf-8"))

    settings = load_settings()
    hooks = settings.setdefault("hooks", {})
    results = []

    python = interpreter()

    for event, stem, name, timeout in HOOKS:
        hook_path = HOOKS_DIR / (stem + ".py")
        hook_path.write_bytes(sources[name])
        if os.name == "posix":
            hook_path.chmod(hook_path.stat().st_mode | stat.S_IXUSR)
        command = '"%s" "%s"' % (python, hook_path)
        results.append((event, register(hooks, event, stem, command, timeout)))
        legacy = HOOKS_DIR / stem
        if legacy.exists():
            legacy.unlink()

    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2)
        f.write("\n")

    labels = {
        "UserPromptSubmit": "auto-context injection",
        "SessionEnd": "session capture (candidates queued for review in the dashboard)",
    }
    print("")
    print("Continuum hooks installed, running under %s:" % python)
    for event, result in results:
        print("  %-16s -> %s [%s]" % (event, labels[event], result))
    print("")
    print("Disable session capture only:  create the file %s" % (STATE_DIR / "capture-disabled"))
    print("Run /hooks in Claude Code (or restart it) to pick up the change.")


if __name__ == "__main__":
    main()
