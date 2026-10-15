#!/usr/bin/env node
"use strict";

// Continuum — Claude Code auto-context uninstaller.
//
// Reverses install_hook.js: removes the UserPromptSubmit/SessionStart and SessionEnd/PreCompact hook
// scripts (including any leftover files from the older Python-based install),
// their settings.json registrations, and the local token/workspace state.
// Safe to re-run (idempotent), safe to run even if never installed.
//
//   Linux/macOS   curl -fsSL https://continuum-mcp.sshogunn.org/uninstall_hook.js | node
//   Windows       irm https://continuum-mcp.sshogunn.org/uninstall_hook.js | node -

const fs = require("fs");
const os = require("os");
const path = require("path");

const CONTINUUM_URL = (process.env.CONTINUUM_MCP_URL || "https://continuum-mcp.sshogunn.org").replace(/\/$/, "");
const TIMEOUT_MS = 5000;

const HOME = os.homedir();
const STATE_DIR = path.join(HOME, ".continuum");
const HOOKS_DIR = path.join(HOME, ".claude", "hooks");
const COMMAND_PATH = path.join(HOME, ".claude", "commands", "continuum-update.md");
const SETTINGS_PATH = path.join(HOME, ".claude", "settings.json");

const STEMS = ["continuum-context-inject", "continuum-session-capture", "continuum-self-update"];
const EVENTS = ["UserPromptSubmit", "SessionStart", "SessionEnd", "PreCompact"];

function savedTokens() {
  let raw;
  try {
    raw = fs.readFileSync(path.join(STATE_DIR, "hook-token"), "utf-8").trim();
  } catch {
    return [];
  }
  if (!raw) return [];
  if (!raw.startsWith("{")) return [raw];
  try {
    const creds = JSON.parse(raw);
    return [creds.refresh_token, creds.access_token].filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function signOut() {
  const tokens = savedTokens();
  if (!tokens.length) return null;
  try {
    const metadata = await (await fetchWithTimeout(`${CONTINUUM_URL}/.well-known/oauth-authorization-server`)).json();
    if (!metadata.revocation_endpoint) return false;
    for (const token of tokens) {
      const response = await fetchWithTimeout(metadata.revocation_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
      if (!response.ok) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function removeFiles() {
  for (const stem of STEMS) {
    for (const ext of [".js", ".py", ""]) {
      try {
        fs.unlinkSync(path.join(HOOKS_DIR, stem + ext));
      } catch {
        // wasn't there — fine
      }
    }
  }
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
  try {
    fs.unlinkSync(COMMAND_PATH);
  } catch {
    // wasn't there — fine
  }
}

function cleanSettings() {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
  } catch (exc) {
    if (exc.code === "ENOENT") return null;
    process.stderr.write(`error: ${SETTINGS_PATH} has invalid JSON — skipping settings cleanup\n`);
    return null;
  }

  const hooks = settings.hooks || {};
  let removed = false;

  for (const event of EVENTS) {
    const groups = hooks[event];
    if (!groups) continue;
    const kept = [];
    for (const group of groups) {
      const original = group.hooks || [];
      const remaining = original.filter(
        (entry) => !STEMS.some((stem) => String(entry.command || "").includes(stem))
      );
      if (remaining.length !== original.length) removed = true;
      if (remaining.length || !original.length) {
        group.hooks = remaining;
        kept.push(group);
      }
    }
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }

  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
  return removed;
}

async function main() {
  const signedOut = await signOut();
  removeFiles();
  cleanSettings();
  console.log("");
  console.log("Continuum has been removed, along with your saved token on this machine.");
  if (signedOut === true) console.log("This device is signed out on the server too.");
  if (signedOut === false) {
    console.log("Couldn't reach Continuum to sign this device out — remove it under Connections in the dashboard.");
  }
  console.log("Your memories are untouched — sign in to the dashboard anytime.");
  console.log("Restart Claude Code to finish.");
}

main();
