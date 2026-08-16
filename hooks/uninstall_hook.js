#!/usr/bin/env node
"use strict";

// Continuum — Claude Code auto-context uninstaller.
//
// Reverses install_hook.js: removes the UserPromptSubmit and SessionEnd hook
// scripts (including any leftover files from the older Python-based install),
// their settings.json registrations, and the local token/workspace state.
// Safe to re-run (idempotent), safe to run even if never installed.
//
//   Linux/macOS   curl -fsSL https://continuum-mcp.sshogunn.org/uninstall_hook.js | node
//   Windows       irm https://continuum-mcp.sshogunn.org/uninstall_hook.js | node -

const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = os.homedir();
const STATE_DIR = path.join(HOME, ".continuum");
const HOOKS_DIR = path.join(HOME, ".claude", "hooks");
const SETTINGS_PATH = path.join(HOME, ".claude", "settings.json");

const STEMS = ["continuum-context-inject", "continuum-session-capture", "continuum-self-update"];
const EVENTS = ["UserPromptSubmit", "SessionEnd"];

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

function main() {
  removeFiles();
  cleanSettings();
  console.log("");
  console.log("Continuum has been removed, along with your saved token on this machine.");
  console.log("Your memories are untouched — sign in to the dashboard anytime.");
  console.log("Restart Claude Code to finish.");
}

main();
