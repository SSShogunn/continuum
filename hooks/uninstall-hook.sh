#!/usr/bin/env bash
# Continuum — Claude Code auto-context uninstaller (Linux/macOS/WSL/Git Bash).
#
# A bootstrap only: it locates a Python 3.8+, downloads uninstall_hook.py, and
# hands off. Pure local cleanup, no token needed. Windows PowerShell has its own
# bootstrap, uninstall-hook.ps1.
#
# Usage:
#   curl -fsSL https://continuum-mcp.sshogunn.org/uninstall-hook.sh | bash
set -euo pipefail

CONTINUUM_URL="${CONTINUUM_MCP_URL:-https://continuum-mcp.sshogunn.org}"
CONTINUUM_URL="${CONTINUUM_URL%/}"

PYTHON=""
for candidate in python3 python py; do
  if command -v "$candidate" >/dev/null 2>&1 &&
     "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' >/dev/null 2>&1; then
    PYTHON="$candidate"
    break
  fi
done
if [ -z "$PYTHON" ]; then
  echo "No Python 3.8+ found on PATH — delete ~/.continuum and the continuum-* files in" >&2
  echo "~/.claude/hooks by hand, then remove their entries from ~/.claude/settings.json." >&2
  exit 1
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
TARGET="$WORKDIR/uninstall_hook.py"

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$CONTINUUM_URL/uninstall_hook.py" -o "$TARGET"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$TARGET" "$CONTINUUM_URL/uninstall_hook.py"
else
  echo "Neither curl nor wget is available — cannot download the uninstaller." >&2
  exit 1
fi

"$PYTHON" "$TARGET"
