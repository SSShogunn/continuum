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
CAPTURE_HOOK_PATH="$HOME/.claude/hooks/continuum-session-capture"
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

# Tail of the conversation, used to give short/deictic prompts ("do the same for
# the other one") something to retrieve against. Best-effort: any parse failure
# just yields an empty string and the server falls back to the raw prompt.
RECENT=$(python3 -c '
import json, sys

def text_of(message):
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(
            b.get("text", "") for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        )
    return ""

try:
    data = json.load(sys.stdin)
    path = data.get("transcript_path") or ""
    if not path:
        raise SystemExit
    turns = []
    with open(path) as f:
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
                turns.append(f"{role}: {body[:600]}")
    print("\n".join(turns[-6:])[-2000:])
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
query, workspace, recent = sys.argv[1], sys.argv[2], sys.argv[3]
payload = {"query": query}
if workspace:
    payload["workspace"] = workspace
if recent:
    payload["recent"] = recent
print(json.dumps(payload))
' "$PROMPT" "$WORKSPACE" "$RECENT")" \
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

cat > "$CAPTURE_HOOK_PATH" << 'CAPTURE_SCRIPT_EOF'
#!/usr/bin/env bash
# SessionEnd hook: hand the finished transcript to Continuum, which extracts
# memory candidates for review in the dashboard. Nothing is written to memory
# automatically — the candidates sit in a queue until approved.
#
# Installed by Continuum's install-hook.sh. Exits 0 on any failure.

TOKEN_FILE="$HOME/.continuum/hook-token"
DISABLE_FILE="$HOME/.continuum/hook-disabled"
CAPTURE_DISABLE_FILE="$HOME/.continuum/capture-disabled"
CONTINUUM_URL="${CONTINUUM_MCP_URL:-https://continuum-mcp.sshogunn.org}"

[ -f "$DISABLE_FILE" ] && exit 0
[ -f "$CAPTURE_DISABLE_FILE" ] && exit 0
[ -f "$TOKEN_FILE" ] || exit 0
TOKEN=$(<"$TOKEN_FILE")
[ -n "$TOKEN" ] || exit 0

INPUT=$(cat)

PAYLOAD=$(python3 -c '
import json, sys

def text_of(message):
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(
            b.get("text", "") for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        )
    return ""

try:
    data = json.load(sys.stdin)
    path = data.get("transcript_path") or ""
    if not path:
        raise SystemExit
    turns = []
    with open(path) as f:
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
                turns.append(f"{role}: {body[:4000]}")
    transcript = "\n\n".join(turns)[-40000:]
    if not transcript.strip():
        raise SystemExit
    payload = {"transcript": transcript, "session_id": data.get("session_id") or ""}

    cwd = data.get("cwd") or ""
    if cwd:
        try:
            import os
            with open(os.path.expanduser("~/.continuum/workspace-map.json")) as f:
                workspace = json.load(f).get(cwd, "")
            if workspace:
                payload["workspace"] = workspace
        except Exception:
            pass
    print(json.dumps(payload))
except SystemExit:
    pass
except Exception:
    pass
' <<< "$INPUT")

[ -n "$PAYLOAD" ] || exit 0

curl -s --max-time 10 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "$CONTINUUM_URL/hook/session" >/dev/null 2>&1
exit 0
CAPTURE_SCRIPT_EOF
chmod +x "$CAPTURE_HOOK_PATH"

python3 - "$SETTINGS_PATH" "$HOOK_PATH" "$CAPTURE_HOOK_PATH" << 'PYEOF'
import json
import sys

settings_path, hook_path, capture_path = sys.argv[1], sys.argv[2], sys.argv[3]

try:
    with open(settings_path) as f:
        settings = json.load(f)
except FileNotFoundError:
    settings = {}
except json.JSONDecodeError:
    print(f"error: {settings_path} has invalid JSON — fix it by hand, then re-run", file=sys.stderr)
    sys.exit(1)

hooks = settings.setdefault("hooks", {})


def register(event, command, timeout):
    groups = hooks.setdefault(event, [])
    if any(h.get("command") == command for group in groups for h in group.get("hooks", [])):
        return False
    groups.append({
        "matcher": "*",
        "hooks": [{"type": "command", "command": command, "timeout": timeout}],
    })
    return True


added_context = register("UserPromptSubmit", hook_path, 5)
added_capture = register("SessionEnd", capture_path, 15)

with open(settings_path, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")

print(f"context hook: {'registered' if added_context else 'already registered'}")
print(f"session capture: {'registered' if added_capture else 'already registered'}")
PYEOF

echo ""
echo "Continuum hooks installed:"
echo "  UserPromptSubmit -> auto-context injection"
echo "  SessionEnd       -> session capture (candidates queued for review in the dashboard)"
echo ""
echo "Disable session capture only:  touch ~/.continuum/capture-disabled"
echo "Run /hooks in Claude Code (or restart it) to pick up the change."
