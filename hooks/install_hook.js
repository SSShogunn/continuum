#!/usr/bin/env node
"use strict";

// Continuum — Claude Code auto-context installer.
//
// Wires up a UserPromptSubmit hook that injects relevant Continuum memory into
// every message automatically, without relying on the model deciding to call
// memory_search, plus a SessionEnd hook that queues memory candidates for review.
// Safe to re-run (idempotent) — re-running just refreshes the token and hook
// scripts, and won't duplicate the settings.json entry. Also cleans up an
// older Python-based install if one is present, so the two don't run side by side.
//
//   Linux/macOS   curl -fsSL https://continuum-mcp.sshogunn.org/install_hook.js | CONTINUUM_TOKEN=<token> node
//   Windows       $env:CONTINUUM_TOKEN="<token>"; irm https://continuum-mcp.sshogunn.org/install_hook.js | node -
//
// <token> comes from the dashboard's Connections page ("Generate token"). Node
// 18+ is required (for built-in fetch) — that's the only dependency now that
// there's no separate Python runtime to find.
//
// Piping a script straight into `node`'s stdin means stdin is spent carrying
// the script itself, so there's no terminal left free to prompt for a missing
// token here (unlike running this file directly, where it still works) — the
// token must be passed inline as shown above.

const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

const CONTINUUM_URL = (process.env.CONTINUUM_MCP_URL || "https://continuum-mcp.sshogunn.org").replace(/\/$/, "");

const HOME = os.homedir();
const STATE_DIR = path.join(HOME, ".continuum");
const CLAUDE_DIR = path.join(HOME, ".claude");
const HOOKS_DIR = path.join(CLAUDE_DIR, "hooks");
const SETTINGS_PATH = path.join(CLAUDE_DIR, "settings.json");
const TOKEN_PATH = path.join(STATE_DIR, "hook-token");

const HOOKS = [
  ["UserPromptSubmit", "continuum-context-inject", "continuum_context_inject.js", 5],
  ["SessionEnd", "continuum-session-capture", "continuum_session_capture.js", 15],
];
const UPDATER = ["continuum-self-update", "continuum_self_update.js"];

// Progress reporting. The script arrives on stdin, but stderr is still the
// terminal, so that's where the spinner goes — it keeps stdout clean for the
// summary and stays out of the way when the install is piped somewhere.
const TOTAL_STEPS = 4;
const FANCY =
  Boolean(process.stderr.isTTY) &&
  process.env.TERM !== "dumb" &&
  !process.env.NO_COLOR &&
  !process.env.CONTINUUM_QUIET &&
  (process.platform !== "win32" || Boolean(process.env.WT_SESSION));
const FRAMES = FANCY ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] : ["-"];
const OK = FANCY ? "✓" : "ok";
const BAD = FANCY ? "✗" : "!!";

const progress = { index: 0, label: "", timer: null, frame: 0 };

function paint(symbol) {
  process.stderr.write(`\r\u001b[2K  ${symbol} [${progress.index}/${TOTAL_STEPS}] ${progress.label}`);
}

function startStep(label) {
  progress.index += 1;
  progress.label = label;
  // Without a terminal to redraw, the step is announced once it finishes —
  // one line per step instead of a start/finish pair cluttering the log.
  if (!FANCY) return;
  progress.frame = 0;
  paint(FRAMES[0]);
  progress.timer = setInterval(() => {
    progress.frame = (progress.frame + 1) % FRAMES.length;
    paint(FRAMES[progress.frame]);
  }, 80);
  if (progress.timer.unref) progress.timer.unref();
}

function setLabel(label) {
  progress.label = label;
  if (FANCY) paint(FRAMES[progress.frame]);
}

function stopStep(symbol, detail) {
  if (progress.timer) {
    clearInterval(progress.timer);
    progress.timer = null;
  }
  if (!progress.label) return;
  const suffix = detail ? ` — ${detail}` : "";
  if (FANCY) paint(symbol);
  else process.stderr.write(`  ${symbol} [${progress.index}/${TOTAL_STEPS}] ${progress.label}`);
  process.stderr.write(suffix + "\n");
  progress.label = "";
}

function endStep(detail) {
  stopStep(OK, detail);
}

let failed = false;

function fail(message) {
  const err = new Error(message);
  err.continuumHandled = true;
  // Downloads run in parallel, so a dead endpoint fails all of them at once —
  // report the first and let the rest unwind quietly.
  if (failed) throw err;
  failed = true;
  stopStep(BAD);
  process.stderr.write("error: " + message + "\n");
  throw err;
}

function checkNode() {
  if (typeof fetch === "undefined") {
    fail(
      "Continuum's Claude Code hooks need Node 18 or newer (for built-in fetch), and the " +
        "running Node doesn't have it. Install a current Node from https://nodejs.org/ " +
        "or 'nvm install --lts', then re-run this command."
    );
  }
}

async function readToken() {
  const token = (process.env.CONTINUUM_TOKEN || "").trim();
  if (token) return token;
  if (!process.stdin.isTTY) {
    const retry =
      process.platform === "win32"
        ? `  $env:CONTINUUM_TOKEN="<token>"; irm ${CONTINUUM_URL}/install_hook.js | node -`
        : `  curl -fsSL ${CONTINUUM_URL}/install_hook.js | CONTINUUM_TOKEN=<token> node`;
    fail("No CONTINUUM_TOKEN provided and no terminal to prompt on. Re-run with:\n" + retry);
  }
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question("Paste your Continuum token (from the dashboard's Connections page): ", (answer) => {
      rl.close();
      const trimmed = answer.trim();
      if (!trimmed) {
        process.stderr.write("error: No token provided — aborting.\n");
        const err = new Error("no token");
        err.continuumHandled = true;
        reject(err);
        return;
      }
      resolve(trimmed);
    });
  });
}

async function download(name) {
  const url = `${CONTINUUM_URL}/${name}`;
  let response;
  try {
    response = await fetch(url, { headers: { "User-Agent": "continuum-hook-installer" } });
  } catch (exc) {
    fail(`could not download ${url} (${exc.message || exc})`);
  }
  if (!response.ok) fail(`could not download ${url} (HTTP ${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

function writePrivate(filePath, data) {
  fs.writeFileSync(filePath, data);
  if (process.platform !== "win32") fs.chmodSync(filePath, 0o600);
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
  } catch (exc) {
    if (exc.code === "ENOENT") return {};
    fail(`${SETTINGS_PATH} has invalid JSON — fix it by hand, then re-run`);
  }
}

function register(hooks, event, stem, command, timeout) {
  const groups = hooks[event] || (hooks[event] = []);
  for (const group of groups) {
    for (const entry of group.hooks || []) {
      if (String(entry.command || "").includes(stem)) {
        if (entry.command === command && entry.timeout === timeout) return "already registered";
        entry.command = command;
        entry.timeout = timeout;
        entry.type = "command";
        return "updated";
      }
    }
  }
  groups.push({ matcher: "*", hooks: [{ type: "command", command, timeout }] });
  return "registered";
}

function removeLegacy(stem) {
  for (const ext of [".py", ""]) {
    const legacy = path.join(HOOKS_DIR, stem + ext);
    try {
      fs.unlinkSync(legacy);
    } catch {
      // wasn't there — fine
    }
  }
}

async function main() {
  startStep("checking Node");
  checkNode();
  endStep(process.version);

  const token = await readToken();

  const names = HOOKS.map(([, , name]) => name).concat([UPDATER[1]]);
  startStep(`downloading hook scripts (0/${names.length})`);
  let done = 0;
  const sources = {};
  await Promise.all(
    names.map(async (name) => {
      sources[name] = await download(name);
      done += 1;
      setLabel(`downloading hook scripts (${done}/${names.length})`);
    })
  );
  const bytes = names.reduce((total, name) => total + sources[name].length, 0);
  endStep(`${Math.round(bytes / 1024)} KB`);

  startStep("writing hooks and token");
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(HOOKS_DIR, { recursive: true });
  writePrivate(TOKEN_PATH, token);

  const settings = loadSettings();
  const hooks = settings.hooks || (settings.hooks = {});
  const results = [];
  const node = process.execPath;

  for (const [event, stem, name, timeout] of HOOKS) {
    const hookPath = path.join(HOOKS_DIR, stem + ".js");
    fs.writeFileSync(hookPath, sources[name]);
    const command = `"${node}" "${hookPath}"`;
    results.push([event, register(hooks, event, stem, command, timeout)]);
    removeLegacy(stem);
  }

  const updaterPath = path.join(HOOKS_DIR, UPDATER[0] + ".js");
  fs.writeFileSync(updaterPath, sources[UPDATER[1]]);
  removeLegacy(UPDATER[0]);
  endStep(HOOKS_DIR);

  startStep("registering hooks in settings.json");
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
  endStep(results.map(([, result]) => result).join(", "));

  const labels = {
    UserPromptSubmit: "auto-context injection",
    SessionEnd: "session capture (candidates queued for review in the dashboard)",
  };
  console.log("");
  console.log(`Continuum hooks installed, running under ${node}:`);
  for (const [event, result] of results) {
    console.log(`  ${event.padEnd(16)} -> ${labels[event]} [${result}]`);
  }
  console.log("");
  console.log("The hooks keep themselves current: once a day the context hook spawns");
  console.log(`${updaterPath} in the background, which replaces any hook`);
  console.log("whose SHA-256 no longer matches the published copy.");
  console.log("");
  console.log(`Disable session capture only:  create the file ${path.join(STATE_DIR, "capture-disabled")}`);
  console.log(`Disable auto-update:           create the file ${path.join(STATE_DIR, "no-auto-update")}`);
  console.log("Run /hooks in Claude Code (or restart it) to pick up the change.");
}

main().catch((exc) => {
  if (!exc || !exc.continuumHandled) {
    process.stderr.write("error: " + (exc && exc.message ? exc.message : String(exc)) + "\n");
  }
  process.exitCode = 1;
});
