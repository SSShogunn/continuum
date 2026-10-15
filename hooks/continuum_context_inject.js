#!/usr/bin/env node
"use strict";

// UserPromptSubmit hook: auto-inject relevant Continuum memory into every
// message, without relying on the model deciding to call memory_search.
// Also registered for SessionStart (startup, resume, clear, compact), where it
// delivers the standing rules once per session instead of on every prompt; the
// session id sent with each call lets the server skip anything this session
// has already been shown.
//
// Installed by Continuum's install-hook script. Pure Node core modules and no
// dependencies, so the same file runs unchanged on Linux, macOS and Windows.
// Never blocks the prompt: any failure, timeout, or missing token exits 0
// silently and the message proceeds with no injected context.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const STATE_DIR = path.join(os.homedir(), ".continuum");
const TOKEN_FILE = path.join(STATE_DIR, "hook-token");
const DISABLE_FILE = path.join(STATE_DIR, "hook-disabled");
const WORKSPACE_MAP = path.join(STATE_DIR, "workspace-map.json");
const UPDATE_STAMP = path.join(STATE_DIR, "update-checked-at");
const UPDATE_DISABLE_FILE = path.join(STATE_DIR, "no-auto-update");
const UPDATER = path.join(os.homedir(), ".claude", "hooks", "continuum-self-update.js");

const CONTINUUM_URL = process.env.CONTINUUM_MCP_URL || "https://continuum-mcp.sshogunn.org";
// Stamped to the actual release commit SHA at release time (see
// .github/workflows/release-hooks.yml) — the committed placeholder here is
// never sent as-is, since a hook running straight from a git checkout rather
// than an installed release is a dev scenario, not one core-mcp needs to track.
const HOOK_VERSION = "__HOOK_VERSION__";
const TIMEOUT_MS = 3000;
const RECENT_TURNS = 6;
const RECENT_TURN_CHARS = 600;
const RECENT_TOTAL_CHARS = 2000;

function spawnUpdate() {
  if (fs.existsSync(UPDATE_DISABLE_FILE) || !fs.existsSync(UPDATER)) return;
  const hours = parseFloat(process.env.CONTINUUM_UPDATE_INTERVAL_HOURS || "24") || 24;
  try {
    if (Date.now() - fs.statSync(UPDATE_STAMP).mtimeMs < hours * 3600 * 1000) return;
  } catch {
    // no stamp yet — proceed
  }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(UPDATE_STAMP, String(Date.now()), "utf-8");

  const child = spawn(process.execPath, [UPDATER], { detached: true, stdio: "ignore" });
  child.unref();
}

function textOf(message) {
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block && typeof block === "object" && block.type === "text")
      .map((block) => block.text || "")
      .join(" ");
  }
  return "";
}

function recentTurns(transcriptPath) {
  if (!transcriptPath) return "";
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, "utf-8");
  } catch {
    return "";
  }
  const turns = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const message = entry.message;
    if (!message || typeof message !== "object") continue;
    const role = message.role;
    if (role !== "user" && role !== "assistant") continue;
    const body = textOf(message).trim();
    if (body) turns.push(`${role}: ${body.slice(0, RECENT_TURN_CHARS)}`);
  }
  return turns.slice(-RECENT_TURNS).join("\n").slice(-RECENT_TOTAL_CHARS);
}

function workspaceFor(cwd) {
  if (!cwd) return "";
  try {
    return JSON.parse(fs.readFileSync(WORKSPACE_MAP, "utf-8"))[cwd] || "";
  } catch {
    return "";
  }
}

const REFRESH_MARGIN_MS = 2 * 60 * 1000;
const REFRESH_TIMEOUT_MS = 1500;
const LOCK_STALE_MS = 10 * 1000;

function readCreds() {
  let raw;
  try {
    raw = fs.readFileSync(TOKEN_FILE, "utf-8").trim();
  } catch {
    return null;
  }
  if (!raw) return null;
  if (!raw.startsWith("{")) return { access_token: raw };
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCreds(creds) {
  const temp = `${TOKEN_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(creds), { mode: 0o600 });
  fs.renameSync(temp, TOKEN_FILE);
}

function isFresh(creds) {
  return !creds.expires_at || creds.expires_at - Date.now() > REFRESH_MARGIN_MS;
}

function usable(creds) {
  return creds.access_token && (!creds.expires_at || creds.expires_at > Date.now()) ? creds.access_token : null;
}

function takeLock(lock) {
  try {
    fs.closeSync(fs.openSync(lock, "wx"));
    return true;
  } catch {
    try {
      if (Date.now() - fs.statSync(lock).mtimeMs < LOCK_STALE_MS) return false;
      fs.unlinkSync(lock);
      fs.closeSync(fs.openSync(lock, "wx"));
      return true;
    } catch {
      return false;
    }
  }
}

async function accessToken() {
  let creds = readCreds();
  if (!creds || creds.invalid) return null;
  if (isFresh(creds) || !creds.refresh_token || !creds.token_endpoint) return usable(creds);

  const lock = `${TOKEN_FILE}.lock`;
  if (!takeLock(lock)) return usable(creds);
  try {
    creds = readCreds() || creds;
    if (isFresh(creds)) return usable(creds);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(creds.token_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: creds.refresh_token }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const body = await response.json();
    if (response.ok && body.access_token) {
      creds = {
        ...creds,
        access_token: body.access_token,
        refresh_token: body.refresh_token || creds.refresh_token,
        expires_at: Date.now() + (body.expires_in || 3600) * 1000,
      };
      writeCreds(creds);
    } else if (body.error === "invalid_grant") {
      writeCreds({ ...creds, invalid: true });
      return null;
    }
    return usable(creds);
  } catch {
    return usable(creds);
  } finally {
    try {
      fs.unlinkSync(lock);
    } catch {}
  }
}

async function postContext(token, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${CONTINUUM_URL.replace(/\/$/, "")}/hook/context`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Continuum-Hook-Version": HOOK_VERSION,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function main() {
  if (fs.existsSync(DISABLE_FILE)) return;
  if (!readCreds()) return;

  let data;
  try {
    data = JSON.parse(await readStdin());
  } catch {
    return;
  }
  const event = data.hook_event_name === "SessionStart" ? "SessionStart" : "UserPromptSubmit";
  const payload = {};
  if (data.session_id) payload.session_id = data.session_id;
  const workspace = workspaceFor(data.cwd || "");
  if (workspace) payload.workspace = workspace;

  if (event === "SessionStart") {
    payload.event = "session_start";
    if (data.source) payload.source = data.source;
  } else {
    const prompt = data.prompt || "";
    if (!prompt) return;
    payload.query = prompt;
    const recent = recentTurns(data.transcript_path || "");
    if (recent) payload.recent = recent;
  }

  const token = await accessToken();
  if (!token) return;
  const result = await postContext(token, payload);
  const context = result && result.context;
  if (context) {
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }) + "\n"
    );
  }
}

(async () => {
  try {
    await main();
  } catch {
    // never block the prompt
  }
  try {
    spawnUpdate();
  } catch {
    // best effort
  }
  process.exit(0);
})();
