"use strict";
// Runs the real hook scripts as child processes against a fake Continuum
// server, with HOME pointed at a temp dir.   node --test hooks/test/hooks.test.js

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawnSync, spawn } = require("child_process");

const HOOKS = path.resolve(__dirname, "..");
let server;
let url;
const requests = [];
let contextReply = { context: "CTX" };

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push({ path: req.url, body: body ? JSON.parse(body) : null });
      if (req.url === "/hook/context") return res.end(JSON.stringify(contextReply));
      if (req.url === "/hook/session") return res.end(JSON.stringify({ queued: true }));
      const file = path.join(HOOKS, req.url.slice(1));
      if (req.method === "GET" && fs.existsSync(file)) return res.end(fs.readFileSync(file));
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "continuum-hook-"));
  fs.mkdirSync(path.join(dir, ".continuum"));
  fs.writeFileSync(path.join(dir, ".continuum", "hook-token"), "tok");
  // no updater installed, so the context hook never spawns one
  return dir;
}

function run(script, homeDir, input, extraEnv = {}) {
  // async spawn: the fake server runs on this process's event loop
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HOOKS, script)], {
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir, CONTINUUM_MCP_URL: url, ...extraEnv },
    });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.on("close", (code) => resolve({ code, out }));
    child.stdin.end(typeof input === "string" ? input : JSON.stringify(input));
  });
}

function transcript(dir, entries) {
  const file = path.join(dir, "t.jsonl");
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return file;
}

const say = (role, text, extra = {}) => ({ ...extra, message: { role, content: text } });

test("SessionStart asks for session-start context and answers as SessionStart", async () => {
  requests.length = 0;
  const h = home();
  const { code, out } = await run("continuum_context_inject.js", h, {
    hook_event_name: "SessionStart", session_id: "s1", source: "compact", cwd: "/x",
  });
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(requests[0].body, { session_id: "s1", event: "session_start", source: "compact" });
  assert.strictEqual(JSON.parse(out).hookSpecificOutput.hookEventName, "SessionStart");
});

test("UserPromptSubmit sends the session id with the query", async () => {
  requests.length = 0;
  const h = home();
  fs.writeFileSync(path.join(h, ".continuum", "workspace-map.json"), JSON.stringify({ "/repo": "shop" }));
  const { out } = await run("continuum_context_inject.js", h, {
    hook_event_name: "UserPromptSubmit", session_id: "s1", prompt: "how do we deploy", cwd: "/repo",
  });
  assert.deepStrictEqual(requests[0].body, { session_id: "s1", workspace: "shop", query: "how do we deploy" });
  assert.strictEqual(JSON.parse(out).hookSpecificOutput.additionalContext, "CTX");
});

test("capture is incremental across PreCompact and cleans up at SessionEnd", async () => {
  requests.length = 0;
  const h = home();
  const long = "x".repeat(500);
  const entries = [
    say("user", `we decided to use postgres ${long}`),
    say("user", "injected", { isMeta: true }),
    say("user", "<command-name>/model</command-name>"),
    say("assistant", `ok ${long}`),
  ];
  const file = transcript(h, entries);
  const input = { hook_event_name: "PreCompact", session_id: "s2", transcript_path: file, cwd: "/x" };

  await run("continuum_session_capture.js", h, input);
  assert.strictEqual(requests.length, 1);
  const sent = requests[0].body.transcript;
  assert.match(sent, /decided to use postgres/);
  assert.doesNotMatch(sent, /injected|command-name/);

  await run("continuum_session_capture.js", h, input); // nothing new
  assert.strictEqual(requests.length, 1);

  fs.appendFileSync(file, JSON.stringify(say("user", `also redis for queues ${long}`)) + "\n");
  await run("continuum_session_capture.js", h, { ...input, hook_event_name: "SessionEnd" });
  assert.strictEqual(requests.length, 2);
  assert.match(requests[1].body.transcript, /redis for queues/);
  assert.doesNotMatch(requests[1].body.transcript, /postgres/);
  assert.ok(!fs.existsSync(path.join(h, ".continuum", "capture-state", "s2.json")));
});

test("updater wires the new events into an existing install, once", async () => {
  const h = home();
  const settingsPath = path.join(h, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const cmd = (stem) => `"node" "${h}/.claude/hooks/${stem}.js"`;
  fs.writeFileSync(settingsPath, JSON.stringify({
    hooks: {
      UserPromptSubmit: [{ matcher: "*", hooks: [{ type: "command", command: cmd("continuum-context-inject"), timeout: 5 }] }],
      SessionEnd: [{ matcher: "*", hooks: [{ type: "command", command: cmd("continuum-session-capture"), timeout: 15 }] }],
      Stop: [{ hooks: [{ type: "command", command: "other" }] }],
    },
  }));
  const first = await run("continuum_self_update.js", h, "");
  assert.match(first.out, /SessionStart hook, PreCompact hook/);
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  assert.strictEqual(settings.hooks.SessionStart[0].hooks[0].command, cmd("continuum-context-inject"));
  assert.strictEqual(settings.hooks.PreCompact[0].hooks[0].command, cmd("continuum-session-capture"));
  assert.strictEqual(settings.hooks.Stop[0].hooks[0].command, "other");

  const second = await run("continuum_self_update.js", h, "");
  assert.match(second.out, /Already up to date/);
  assert.strictEqual(JSON.parse(fs.readFileSync(settingsPath, "utf-8")).hooks.SessionStart.length, 1);
});

test("updater leaves a machine without Continuum alone", async () => {
  const h = home();
  const settingsPath = path.join(h, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({ hooks: {} }));
  await run("continuum_self_update.js", h, "");
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(settingsPath, "utf-8")), { hooks: {} });
});

test("installer registers all four events and uninstaller removes them", async () => {
  const h = home();
  const inst = await run("install_hook.js", h, "", { CONTINUUM_TOKEN: "tok" });
  assert.strictEqual(inst.code, 0);
  const settingsPath = path.join(h, ".claude", "settings.json");
  const hooks = JSON.parse(fs.readFileSync(settingsPath, "utf-8")).hooks;
  for (const event of ["UserPromptSubmit", "SessionStart", "SessionEnd", "PreCompact"]) {
    assert.strictEqual(hooks[event].length, 1, event);
  }
  await run("install_hook.js", h, "", { CONTINUUM_TOKEN: "tok" }); // idempotent
  assert.strictEqual(JSON.parse(fs.readFileSync(settingsPath, "utf-8")).hooks.SessionStart.length, 1);

  await run("uninstall_hook.js", h, "");
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(settingsPath, "utf-8")).hooks, {});
});
