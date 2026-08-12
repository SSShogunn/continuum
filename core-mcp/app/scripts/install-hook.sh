#!/usr/bin/env bash
# Continuum — Claude Code auto-context installer.
#
# Wires up a UserPromptSubmit hook that injects relevant Continuum memory into
# every message automatically, without relying on the model deciding to call
# memory_search. Safe to re-run (idempotent) — re-running just refreshes the
# token and hook script, and won't duplicate the settings.json entry.
#
# Usage:
#   curl -fsSL https://continuum-mcp.sshogunn.org/install-hook.sh | CONTINUUM_TOKEN=<token> bash
#
# <token> comes from the dashboard's Settings > API Tokens tab ("Generate
# token"). If CONTINUUM_TOKEN isn't set, this prompts for it interactively.
set -euo pipefail

CONTINUUM_URL="${CONTINUUM_MCP_URL:-https://continuum-mcp.sshogunn.org}"
HOOK_PATH="$HOME/.claude/hooks/continuum-context-inject"
SETTINGS_PATH="$HOME/.claude/settings.json"

TOKEN="${CONTINUUM_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  if [ -t 0 ]; then
    read -r -s -p "Paste your Continuum token (from Settings > API Tokens): " TOKEN
    echo
  elif [ -r /dev/tty ]; then
    read -r -s -p "Paste your Continuum token (from Settings > API Tokens): " TOKEN < /dev/tty
    echo
  else
    echo "No CONTINUUM_TOKEN provided and no terminal to prompt on. Re-run with:" >&2
    echo "  curl -fsSL $CONTINUUM_URL/install-hook.sh | CONTINUUM_TOKEN=<token> bash" >&2
    exit 1
  fi
fi
[ -n "$TOKEN" ] || { echo "No token provided — aborting." >&2; exit 1; }

mkdir -p "$HOME/.continuum" "$HOME/.claude/hooks"
umask 077
printf '%s' "$TOKEN" > "$HOME/.continuum/hook-token"
chmod 600 "$HOME/.continuum/hook-token"

cat > "$HOOK_PATH" << 'HOOK_SCRIPT_EOF'
#!/usr/bin/env bash
# UserPromptSubmit hook: auto-inject relevant Continuum memory into every
# message, without relying on the model deciding to call memory_search.
#
# Installed by Continuum's install-hook.sh. Never blocks the prompt: any
# failure, timeout, or missing token exits 0 silently and the message
# proceeds with no injected context.

TOKEN_FILE="$HOME/.continuum/hook-token"
DISABLE_FILE="$HOME/.continuum/hook-disabled"
CONTINUUM_URL="${CONTINUUM_MCP_URL:-https://continuum-mcp.sshogunn.org}"

[ -f "$DISABLE_FILE" ] && exit 0
[ -f "$TOKEN_FILE" ] || exit 0
TOKEN=$(<"$TOKEN_FILE")
[ -n "$TOKEN" ] || exit 0

INPUT=$(cat)
PROMPT=$(python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get("prompt", ""))
except Exception:
    pass
' <<< "$INPUT")
[ -n "$PROMPT" ] || exit 0

CWD=$(python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get("cwd", ""))
except Exception:
    pass
' <<< "$INPUT")

# Deliberately no project-detection here — the model decides which workspace a
# project belongs to (see rule 7 in core-mcp/app/server.py's _INSTRUCTIONS) and
# records that choice in this map, keyed by cwd. The hook just reads it back.
# Empty/missing entry means the server falls back to "default", same as before.
WORKSPACE_MAP="$HOME/.continuum/workspace-map.json"
WORKSPACE=""
if [ -n "$CWD" ] && [ -f "$WORKSPACE_MAP" ]; then
  WORKSPACE=$(python3 -c '
import json, sys
try:
    with open(sys.argv[1]) as f:
        m = json.load(f)
    print(m.get(sys.argv[2], ""))
except Exception:
    pass
' "$WORKSPACE_MAP" "$CWD")
fi

RESPONSE=$(curl -s --max-time 3 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c '
import json, sys
query, workspace = sys.argv[1], sys.argv[2]
payload = {"query": query}
if workspace:
    payload["workspace"] = workspace
print(json.dumps(payload))
' "$PROMPT" "$WORKSPACE")" \
  "$CONTINUUM_URL/hook/context" 2>/dev/null)
[ -n "$RESPONSE" ] || exit 0

python3 -c '
import json, sys
try:
    context = json.load(sys.stdin).get("context")
except Exception:
    sys.exit(0)
if context:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": context,
        }
    }))
' <<< "$RESPONSE"
exit 0
HOOK_SCRIPT_EOF
chmod +x "$HOOK_PATH"

python3 - "$SETTINGS_PATH" "$HOOK_PATH" << 'PYEOF'
import json
import sys

settings_path, hook_path = sys.argv[1], sys.argv[2]

try:
    with open(settings_path) as f:
        settings = json.load(f)
except FileNotFoundError:
    settings = {}
except json.JSONDecodeError:
    print(f"error: {settings_path} has invalid JSON — fix it by hand, then re-run", file=sys.stderr)
    sys.exit(1)

hooks = settings.setdefault("hooks", {})
prompt_hooks = hooks.setdefault("UserPromptSubmit", [])

already_installed = any(
    h.get("command") == hook_path
    for group in prompt_hooks
    for h in group.get("hooks", [])
)
if not already_installed:
    prompt_hooks.append({
        "matcher": "*",
        "hooks": [{"type": "command", "command": hook_path, "timeout": 5}],
    })

with open(settings_path, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")

print("registered" if not already_installed else "already registered")
PYEOF

echo ""
echo "Continuum auto-context hook installed."
echo "Run /hooks in Claude Code (or restart it) to pick up the change."
