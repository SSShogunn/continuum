#!/usr/bin/env bash
# Continuum — Claude Code auto-context uninstaller.
#
# Reverses install-hook.sh: removes the UserPromptSubmit and SessionEnd hook
# scripts, their settings.json registrations, and the local token/workspace
# state. Safe to re-run (idempotent) and safe to run even if never installed.
#
# Usage:
#   curl -fsSL https://continuum-mcp.sshogunn.org/uninstall-hook.sh | bash
set -euo pipefail

HOOK_PATH="$HOME/.claude/hooks/continuum-context-inject"
CAPTURE_HOOK_PATH="$HOME/.claude/hooks/continuum-session-capture"
SETTINGS_PATH="$HOME/.claude/settings.json"

rm -f "$HOOK_PATH" "$CAPTURE_HOOK_PATH"
rm -rf "$HOME/.continuum"

if [ -f "$SETTINGS_PATH" ]; then
  python3 - "$SETTINGS_PATH" "$HOOK_PATH" "$CAPTURE_HOOK_PATH" << 'PYEOF'
import json
import sys

settings_path, hook_path, capture_path = sys.argv[1], sys.argv[2], sys.argv[3]
targets = {hook_path, capture_path}

try:
    with open(settings_path) as f:
        settings = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    print(f"error: {settings_path} missing or invalid JSON — skipping settings cleanup", file=sys.stderr)
    sys.exit(0)

hooks = settings.get("hooks", {})
removed = False

for event in ("UserPromptSubmit", "SessionEnd"):
    groups = hooks.get(event)
    if not groups:
        continue
    kept = []
    for group in groups:
        original = group.get("hooks", [])
        remaining = [h for h in original if h.get("command") not in targets]
        if len(remaining) != len(original):
            removed = True
        if remaining or not original:
            group["hooks"] = remaining
            kept.append(group)
    hooks[event] = kept

with open(settings_path, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")

print("settings.json entries removed" if removed else "no matching settings.json entries found")
PYEOF
fi

echo ""
echo "Continuum hooks uninstalled: context injection, session capture, local token, and workspace state removed."
echo "Run /hooks in Claude Code (or restart it) to pick up the change."
