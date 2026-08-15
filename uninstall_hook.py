#!/usr/bin/env python3
"""Continuum — Claude Code auto-context uninstaller.

Reverses install_hook.py: removes the UserPromptSubmit and SessionEnd hook
scripts, their settings.json registrations, and the local token/workspace state.
Safe to re-run (idempotent), safe to run even if never installed, and cleans up
installs from older bash-only versions too.

  curl -fsSL https://continuum-mcp.sshogunn.org/uninstall-hook.sh | bash
"""

import json
import shutil
import sys
from pathlib import Path

HOME = Path.home()
STATE_DIR = HOME / ".continuum"
HOOKS_DIR = HOME / ".claude" / "hooks"
SETTINGS_PATH = HOME / ".claude" / "settings.json"

STEMS = ("continuum-context-inject", "continuum-session-capture")
EVENTS = ("UserPromptSubmit", "SessionEnd")


def remove_files():
    for stem in STEMS:
        for path in (HOOKS_DIR / (stem + ".py"), HOOKS_DIR / stem):
            try:
                path.unlink()
            except OSError:
                pass
    shutil.rmtree(STATE_DIR, ignore_errors=True)


def clean_settings():
    try:
        with open(SETTINGS_PATH, encoding="utf-8") as f:
            settings = json.load(f)
    except FileNotFoundError:
        return None
    except ValueError:
        print(
            "error: %s has invalid JSON — skipping settings cleanup" % SETTINGS_PATH,
            file=sys.stderr,
        )
        return None

    hooks = settings.get("hooks", {})
    removed = False

    for event in EVENTS:
        groups = hooks.get(event)
        if not groups:
            continue
        kept = []
        for group in groups:
            original = group.get("hooks", [])
            remaining = [
                entry
                for entry in original
                if not any(stem in str(entry.get("command", "")) for stem in STEMS)
            ]
            if len(remaining) != len(original):
                removed = True
            if remaining or not original:
                group["hooks"] = remaining
                kept.append(group)
        if kept:
            hooks[event] = kept
        else:
            hooks.pop(event, None)

    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2)
        f.write("\n")
    return removed


def main():
    remove_files()
    removed = clean_settings()
    print("")
    if removed is None:
        print("no settings.json to clean up")
    else:
        print("settings.json entries removed" if removed else "no matching settings.json entries found")
    print(
        "Continuum hooks uninstalled: context injection, session capture, local token, "
        "and workspace state removed."
    )
    print("Run /hooks in Claude Code (or restart it) to pick up the change.")


if __name__ == "__main__":
    main()
