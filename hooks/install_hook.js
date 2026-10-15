#!/usr/bin/env node
"use strict";

// Continuum — Claude Code auto-context installer.
//
// Wires up a UserPromptSubmit hook that injects relevant Continuum memory into
// every message automatically, without relying on the model deciding to call
// memory_search (plus SessionStart, where the same script delivers standing
// rules once per session), and SessionEnd + PreCompact hooks that capture
// durable facts from the transcript into memory.
// Safe to re-run (idempotent) — re-running just refreshes the sign-in and hook
// scripts, and won't duplicate the settings.json entry. Also cleans up an
// older Python-based install if one is present, so the two don't run side by side.
//
//   Linux/macOS   curl -fsSL https://continuum-mcp.sshogunn.org/install_hook.js | node
//   Windows       irm https://continuum-mcp.sshogunn.org/install_hook.js | node -
//
// Sign-in shows a code to approve on the dashboard's /device page; CONTINUUM_TOKEN=<token>
// still works for headless installs. Node 18+ is required (for built-in fetch) — that's
// the only dependency now that there's no separate Python runtime to find.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const CONTINUUM_URL = (process.env.CONTINUUM_MCP_URL || "https://continuum-mcp.sshogunn.org").replace(/\/$/, "");

const HOME = os.homedir();
const STATE_DIR = path.join(HOME, ".continuum");
const CLAUDE_DIR = path.join(HOME, ".claude");
const HOOKS_DIR = path.join(CLAUDE_DIR, "hooks");
const COMMANDS_DIR = path.join(CLAUDE_DIR, "commands");
const SETTINGS_PATH = path.join(CLAUDE_DIR, "settings.json");
const TOKEN_PATH = path.join(STATE_DIR, "hook-token");

const UPDATE_COMMAND = `---
description: Force-check for and apply Continuum hook updates now
---
Run \`node ~/.claude/hooks/continuum-self-update.js\` with the Bash tool and report its output
verbatim — it prints either "Already up to date." or which files it just updated.
`;

// [event, installed stem, published file, timeout]. One script can serve
// several events; it branches on hook_event_name.
const HOOKS = [
  ["UserPromptSubmit", "continuum-context-inject", "continuum_context_inject.js", 5],
  ["SessionStart", "continuum-context-inject", "continuum_context_inject.js", 5],
  ["SessionEnd", "continuum-session-capture", "continuum_session_capture.js", 15],
  ["PreCompact", "continuum-session-capture", "continuum_session_capture.js", 15],
];
const UPDATER = ["continuum-self-update", "continuum_self_update.js"];

// Progress reporting. The script arrives on stdin, but stderr is still the
// terminal, so that's where the spinner goes — it keeps stdout clean for the
// summary and stays out of the way when the install is piped somewhere.
const TOTAL_STEPS = 5;
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
      "Continuum needs Node 18 or newer. Install it from https://nodejs.org/ " +
        "(or run 'nvm install --lts'), then try again."
    );
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function postForm(url, fields) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "continuum-hook-installer" },
    body: new URLSearchParams(fields),
  });
  let body = {};
  try {
    body = await response.json();
  } catch {}
  return { ok: response.ok, status: response.status, body };
}

function credsFrom(body, tokenEndpoint, previous = {}) {
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token || previous.refresh_token,
    expires_at: Date.now() + (body.expires_in || 3600) * 1000,
    token_endpoint: tokenEndpoint,
  };
}

async function reuseSession() {
  let creds;
  try {
    creds = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  } catch {
    return null;
  }
  if (!creds || creds.invalid || !creds.refresh_token || !creds.token_endpoint) return null;
  try {
    const { ok, body } = await postForm(creds.token_endpoint, {
      grant_type: "refresh_token",
      refresh_token: creds.refresh_token,
    });
    return ok && body.access_token ? credsFrom(body, creds.token_endpoint, creds) : null;
  } catch {
    return null;
  }
}

function openBrowser(url) {
  if (process.env.CONTINUUM_NO_BROWSER) return;
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return;
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url.replace(/&/g, "^&")]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {}
}

async function deviceLogin() {
  let metadata;
  try {
    const response = await fetch(`${CONTINUUM_URL}/.well-known/oauth-authorization-server`);
    metadata = await response.json();
  } catch (exc) {
    fail(`could not reach ${CONTINUUM_URL} (${exc.message || exc})`);
  }
  const deviceEndpoint = metadata && metadata.device_authorization_endpoint;
  const tokenEndpoint = metadata && metadata.token_endpoint;
  if (!deviceEndpoint || !tokenEndpoint) fail("this Continuum server doesn't support device login yet");

  const start = await postForm(deviceEndpoint, { device_name: `${os.hostname()} (${process.platform})` });
  if (!start.ok || !start.body.device_code) fail(`could not start sign-in (HTTP ${start.status})`);
  const { device_code, user_code, verification_uri, verification_uri_complete } = start.body;

  process.stderr.write(`\n      Open ${verification_uri} and confirm this code:\n\n          ${user_code}\n\n`);
  openBrowser(verification_uri_complete || verification_uri);
  setLabel("signing in — waiting for approval in the browser");

  let interval = (start.body.interval ?? 5) * 1000;
  const deadline = Date.now() + (start.body.expires_in || 600) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    let poll;
    try {
      poll = await postForm(tokenEndpoint, {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code,
      });
    } catch {
      continue;
    }
    if (poll.ok && poll.body.access_token) return credsFrom(poll.body, tokenEndpoint);
    const error = poll.body.error;
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      interval += 5000;
      continue;
    }
    if (error === "access_denied") fail("sign-in was denied in the dashboard");
    if (error === "expired_token") break;
    fail(`sign-in failed (${error || `HTTP ${poll.status}`})`);
  }
  fail("the code expired before it was approved — run the installer again");
}

async function signIn() {
  startStep("signing in");
  const token = (process.env.CONTINUUM_TOKEN || "").trim();
  if (token) {
    endStep("using CONTINUUM_TOKEN");
    return token;
  }
  const reused = await reuseSession();
  if (reused) {
    endStep("already signed in");
    return reused;
  }
  const creds = await deviceLogin();
  setLabel("signing in");
  endStep("approved");
  return creds;
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

  const creds = await signIn();

  const names = [...new Set(HOOKS.map(([, , name]) => name))].concat([UPDATER[1]]);
  startStep(`downloading (0/${names.length})`);
  let done = 0;
  const sources = {};
  await Promise.all(
    names.map(async (name) => {
      sources[name] = await download(name);
      done += 1;
      setLabel(`downloading (${done}/${names.length})`);
    })
  );
  const bytes = names.reduce((total, name) => total + sources[name].length, 0);
  endStep(`${Math.round(bytes / 1024)} KB`);

  startStep("installing");
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(HOOKS_DIR, { recursive: true });
  writePrivate(TOKEN_PATH, typeof creds === "string" ? creds : JSON.stringify(creds));

  const settings = loadSettings();
  const hooks = settings.hooks || (settings.hooks = {});
  const node = process.execPath;

  for (const [event, stem, name, timeout] of HOOKS) {
    const hookPath = path.join(HOOKS_DIR, stem + ".js");
    fs.writeFileSync(hookPath, sources[name]);
    const command = `"${node}" "${hookPath}"`;
    register(hooks, event, stem, command, timeout);
    removeLegacy(stem);
  }

  const updaterPath = path.join(HOOKS_DIR, UPDATER[0] + ".js");
  fs.writeFileSync(updaterPath, sources[UPDATER[1]]);
  removeLegacy(UPDATER[0]);

  fs.mkdirSync(COMMANDS_DIR, { recursive: true });
  fs.writeFileSync(path.join(COMMANDS_DIR, "continuum-update.md"), UPDATE_COMMAND);
  endStep();

  startStep("enabling in Claude Code");
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
  endStep();

  console.log("");
  console.log("Continuum is set up.");
  console.log("");
  console.log("  Auto-context     relevant memory added to every message");
  console.log("  Session capture  durable facts saved directly at the end of each session");
  console.log("");
  console.log("Updates install themselves in the background — run /continuum-update to force a check now.");
  console.log("Restart Claude Code to finish. You can turn these off in the dashboard.");
}

main().catch((exc) => {
  if (!exc || !exc.continuumHandled) {
    process.stderr.write("error: " + (exc && exc.message ? exc.message : String(exc)) + "\n");
  }
  process.exitCode = 1;
});
