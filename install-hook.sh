#!/usr/bin/env bash
# Continuum — Claude Code auto-context installer (Linux/macOS/WSL/Git Bash).
#
# A bootstrap only: it locates a Python 3.8+, downloads install_hook.py, and
# hands off. The installed hooks are Python too, so the same ones run on every
# platform.
#
# Usage:
#   curl -fsSL https://continuum-mcp.sshogunn.org/install-hook.sh | CONTINUUM_TOKEN=<token> bash
#
# <token> comes from the dashboard's Connections page ("Generate token"). If
# CONTINUUM_TOKEN isn't set, this prompts for it interactively.
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
  echo "Continuum's Claude Code hooks need Python 3.8 or newer, and none was found on PATH." >&2
  echo "Install it (e.g. 'brew install python' / 'apt install python3'), then re-run this command." >&2
  exit 1
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
TARGET="$WORKDIR/install_hook.py"

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$CONTINUUM_URL/install_hook.py" -o "$TARGET"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$TARGET" "$CONTINUUM_URL/install_hook.py"
else
  echo "Neither curl nor wget is available — cannot download the installer." >&2
  exit 1
fi

export CONTINUUM_MCP_URL="$CONTINUUM_URL"
if [ -z "${CONTINUUM_TOKEN:-}" ] && (exec 3< /dev/tty) 2>/dev/null; then
  "$PYTHON" "$TARGET" < /dev/tty
else
  "$PYTHON" "$TARGET"
fi
