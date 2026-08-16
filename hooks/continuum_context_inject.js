#!/usr/bin/env node
"use strict";

// UserPromptSubmit hook: auto-inject relevant Continuum memory into every
// message, without relying on the model deciding to call memory_search.
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

async function postContext(token, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${CONTINUUM_URL.replace(/\/$/, "")}/hook/context`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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
  let token;
  try {
    token = fs.readFileSync(TOKEN_FILE, "utf-8").trim();
  } catch {
    return;
  }
  if (!token) return;

  let data;
  try {
    data = JSON.parse(await readStdin());
  } catch {
    return;
  }
  const prompt = data.prompt || "";
  if (!prompt) return;

  const payload = { query: prompt };
  const workspace = workspaceFor(data.cwd || "");
  if (workspace) payload.workspace = workspace;
  const recent = recentTurns(data.transcript_path || "");
  if (recent) payload.recent = recent;

  const result = await postContext(token, payload);
  const context = result && result.context;
  if (context) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
      }) + "\n"
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
