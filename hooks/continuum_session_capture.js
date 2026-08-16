#!/usr/bin/env node
"use strict";

// SessionEnd hook: hand the finished transcript to Continuum, which extracts
// memory candidates for review in the dashboard. Nothing is written to memory
// automatically — the candidates sit in a queue until approved.
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

const CONTINUUM_URL = process.env.CONTINUUM_MCP_URL || "https://continuum-mcp.sshogunn.org";
const TIMEOUT_MS = 10000;
const TURN_CHARS = 4000;
const TRANSCRIPT_CHARS = 40000;

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

function transcriptText(transcriptPath) {
  const raw = fs.readFileSync(transcriptPath, "utf-8");
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
    if (body) turns.push(`${role}: ${body.slice(0, TURN_CHARS)}`);
  }
  return turns.join("\n\n").slice(-TRANSCRIPT_CHARS);
}

function workspaceFor(cwd) {
  if (!cwd) return "";
  try {
    return JSON.parse(fs.readFileSync(WORKSPACE_MAP, "utf-8"))[cwd] || "";
  } catch {
    return "";
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
  const transcriptPath = data.transcript_path || "";
  if (!transcriptPath) return;
  const transcript = transcriptText(transcriptPath);
  if (!transcript.trim()) return;

  const payload = { transcript, session_id: data.session_id || "" };
  const workspace = workspaceFor(data.cwd || "");
  if (workspace) payload.workspace = workspace;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    await fetch(`${CONTINUUM_URL.replace(/\/$/, "")}/hook/session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  try {
    await main();
  } catch {
    // exits 0 regardless
  }
  process.exit(0);
})();
