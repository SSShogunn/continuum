#!/usr/bin/env node
"use strict";

// Background updater for Continuum's Claude Code hooks.
//
// The hooks spawn this detached at most once every CONTINUUM_UPDATE_INTERVAL_HOURS
// (default 24) and exit without waiting, so nothing here is ever in the path of a
// prompt. It compares the SHA-256 of each installed hook script against the copy
// Continuum serves — which redirects to a GitHub release — and atomically
// replaces the ones that drifted, including itself.
//
// Turn it off with: create the file ~/.continuum/no-auto-update
// Run it by hand to force a check now.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const vm = require("vm");

const STATE_DIR = path.join(os.homedir(), ".continuum");
const HOOKS_DIR = path.join(os.homedir(), ".claude", "hooks");
const STAMP_FILE = path.join(STATE_DIR, "update-checked-at");

const CONTINUUM_URL = process.env.CONTINUUM_MCP_URL || "https://continuum-mcp.sshogunn.org";
const TIMEOUT_MS = 20000;

const MANAGED = {
  "continuum-context-inject.js": "continuum_context_inject.js",
  "continuum-session-capture.js": "continuum_session_capture.js",
  "continuum-self-update.js": "continuum_self_update.js",
};

function touchStamp() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STAMP_FILE, String(Date.now()), "utf-8");
  } catch {
    // best effort
  }
}

async function fetchScript(name) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${CONTINUUM_URL.replace(/\/$/, "")}/${name}`, {
      headers: { "User-Agent": "continuum-hook-updater" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function replace(filePath, data) {
  const temp = path.join(path.dirname(filePath), `.continuum-${crypto.randomBytes(6).toString("hex")}.js`);
  try {
    fs.writeFileSync(temp, data);
    fs.renameSync(temp, filePath);
  } catch {
    try {
      fs.unlinkSync(temp);
    } catch {
      // nothing more to do
    }
  }
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function main() {
  touchStamp();
  for (const [filename, source] of Object.entries(MANAGED)) {
    const filePath = path.join(HOOKS_DIR, filename);
    if (!fs.existsSync(filePath)) continue;
    let latest;
    try {
      latest = await fetchScript(source);
    } catch {
      continue;
    }
    if (sha256(latest) === sha256(fs.readFileSync(filePath))) continue;
    try {
      new vm.Script(latest.toString("utf-8"), { filename });
    } catch {
      continue;
    }
    replace(filePath, latest);
  }
}

(async () => {
  try {
    await main();
  } catch {
    // best effort, never surfaces
  }
  process.exit(0);
})();
