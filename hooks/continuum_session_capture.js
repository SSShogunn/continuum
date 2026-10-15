#!/usr/bin/env node
"use strict";

// SessionEnd + PreCompact hook: hand the transcript to Continuum, which
// extracts and saves durable facts as memory entries directly.
//
// Incremental: each call sends only the turns added since this session's last
// successful capture (offset kept in ~/.continuum/capture-state/). A long
// session is captured in pieces at each compaction instead of only its last
// 40k chars at the end, and nothing is sent twice.
//
// Installed by Continuum's install-hook script. Pure Node core modules and no
// dependencies, so the same file runs unchanged on Linux, macOS and Windows.
// Exits 0 on any failure.

const fs = require("fs");
const os = require("os");
const path = require("path");

const STATE_DIR = path.join(os.homedir(), ".continuum");
const TOKEN_FILE = path.join(STATE_DIR, "hook-token");
const DISABLE_FILE = path.join(STATE_DIR, "hook-disabled");
const CAPTURE_DISABLE_FILE = path.join(STATE_DIR, "capture-disabled");
const WORKSPACE_MAP = path.join(STATE_DIR, "workspace-map.json");
const CAPTURE_STATE_DIR = path.join(STATE_DIR, "capture-state");

const CONTINUUM_URL = process.env.CONTINUUM_MCP_URL || "https://continuum-mcp.sshogunn.org";
// Stamped to the release commit SHA at release time — see continuum_context_inject.js.
const HOOK_VERSION = "__HOOK_VERSION__";
const TIMEOUT_MS = 10000;
const TURN_CHARS = 4000;
const TRANSCRIPT_CHARS = 40000;
// Below this, the new part of a transcript is a follow-up or two — not worth
// an LLM extraction pass. The offset isn't advanced, so it rides along next time.
const MIN_NEW_CHARS = 400;
const STATE_MAX_AGE_MS = 14 * 24 * 3600 * 1000;

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

// Returns the turns after line `fromLine` and the transcript's line count.
// Injected text (isMeta, <command-...>/<system-reminder> wrappers) is not
// conversation and would only feed the extractor its own memories back.
function transcriptSince(transcriptPath, fromLine) {
  // Only newline-terminated lines count: the last split element is "" or a
  // line Claude Code is still writing, which the next capture will pick up.
  const lines = fs.readFileSync(transcriptPath, "utf-8").split("\n").slice(0, -1);
  const start = fromLine <= lines.length ? fromLine : 0; // rotated/cleared: start over
  const turns = [];
  for (const line of lines.slice(start)) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.isMeta) continue;
    const message = entry.message;
    if (!message || typeof message !== "object") continue;
    const role = message.role;
    if (role !== "user" && role !== "assistant") continue;
    const body = textOf(message).trim();
    if (body && !body.startsWith("<")) turns.push(`${role}: ${body.slice(0, TURN_CHARS)}`);
  }
  return { text: turns.join("\n\n").slice(-TRANSCRIPT_CHARS), lineCount: lines.length };
}

function statePath(sessionId) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9_-]/g, "") || "unknown";
  return path.join(CAPTURE_STATE_DIR, safe + ".json");
}

function capturedLines(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(statePath(sessionId), "utf-8")).lines || 0;
  } catch {
    return 0;
  }
}

function saveCapturedLines(sessionId, lines) {
  try {
    fs.mkdirSync(CAPTURE_STATE_DIR, { recursive: true });
    fs.writeFileSync(statePath(sessionId), JSON.stringify({ lines }), "utf-8");
  } catch {
    // an offset we fail to save only means the next capture overlaps
  }
}

// Sessions that never fired SessionEnd (crash, killed terminal) leave state behind.
function pruneState() {
  try {
    for (const name of fs.readdirSync(CAPTURE_STATE_DIR)) {
      const file = path.join(CAPTURE_STATE_DIR, name);
      if (Date.now() - fs.statSync(file).mtimeMs > STATE_MAX_AGE_MS) fs.unlinkSync(file);
    }
  } catch {
    // best effort
  }
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
  if (fs.existsSync(DISABLE_FILE) || fs.existsSync(CAPTURE_DISABLE_FILE)) return;
  if (!readCreds()) return;

  let data;
  try {
    data = JSON.parse(await readStdin());
  } catch {
    return;
  }
  const transcriptPath = data.transcript_path || "";
  if (!transcriptPath) return;
  const sessionId = data.session_id || "";
  const isEnd = data.hook_event_name !== "PreCompact";
  const { text, lineCount } = transcriptSince(transcriptPath, sessionId ? capturedLines(sessionId) : 0);
  if (text.trim().length < MIN_NEW_CHARS) {
    if (isEnd && sessionId) fs.rmSync(statePath(sessionId), { force: true });
    return;
  }

  const payload = { transcript: text, session_id: sessionId };
  const workspace = workspaceFor(data.cwd || "");
  if (workspace) payload.workspace = workspace;

  const token = await accessToken();
  if (!token) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${CONTINUUM_URL.replace(/\/$/, "")}/hook/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Continuum-Hook-Version": HOOK_VERSION,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (response.ok && sessionId) {
      if (isEnd) fs.rmSync(statePath(sessionId), { force: true });
      else saveCapturedLines(sessionId, lineCount);
    }
  } finally {
    clearTimeout(timer);
  }
  pruneState();
}

(async () => {
  try {
    await main();
  } catch {
    // exits 0 regardless
  }
  process.exit(0);
})();
