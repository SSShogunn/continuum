#!/usr/bin/env python3
"""Background updater for Continuum's Claude Code hooks.

The hooks spawn this detached at most once every CONTINUUM_UPDATE_INTERVAL_HOURS
(default 24) and exit without waiting, so nothing here is ever in the path of a
prompt. It compares the SHA-256 of each installed hook script against the copy
Continuum serves — which redirects to the repo on GitHub — and atomically
replaces the ones that drifted, including itself.

Turn it off with: create the file ~/.continuum/no-auto-update
Run it by hand to force a check now.
"""

import hashlib
import os
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

STATE_DIR = Path.home() / ".continuum"
HOOKS_DIR = Path.home() / ".claude" / "hooks"
STAMP_FILE = STATE_DIR / "update-checked-at"

CONTINUUM_URL = os.environ.get("CONTINUUM_MCP_URL", "https://continuum-mcp.sshogunn.org")
TIMEOUT_SECONDS = 20.0

MANAGED = {
    "continuum-context-inject.py": "continuum_context_inject.py",
    "continuum-session-capture.py": "continuum_session_capture.py",
    "continuum-self-update.py": "continuum_self_update.py",
}


def touch_stamp():
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        STAMP_FILE.write_text(str(int(time.time())), encoding="utf-8")
    except OSError:
        pass


def fetch(name):
    request = urllib.request.Request(
        "%s/%s" % (CONTINUUM_URL.rstrip("/"), name),
        headers={"User-Agent": "continuum-hook-updater"},
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return response.read()


def replace(path, data):
    handle, temp = tempfile.mkstemp(dir=str(path.parent), prefix=".continuum-", suffix=".py")
    try:
        with os.fdopen(handle, "wb") as f:
            f.write(data)
        if os.name == "posix":
            os.chmod(temp, path.stat().st_mode)
        os.replace(temp, str(path))
    except OSError:
        try:
            os.unlink(temp)
        except OSError:
            pass


def main():
    touch_stamp()
    for filename, source in MANAGED.items():
        path = HOOKS_DIR / filename
        if not path.is_file():
            continue
        try:
            latest = fetch(source)
        except Exception:
            continue
        if hashlib.sha256(latest).hexdigest() == hashlib.sha256(path.read_bytes()).hexdigest():
            continue
        try:
            compile(latest, filename, "exec")
        except (SyntaxError, ValueError):
            continue
        replace(path, latest)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
