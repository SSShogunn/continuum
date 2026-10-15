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
const auth = { pendingPolls: 1, deviceOutcome: "approve", refreshReply: null };

function parseBody(req, body) {
  if (!body) return null;
  if ((req.headers["content-type"] || "").includes("x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(body));
  }
  return JSON.parse(body);
}

function tokenReply(form) {
  if (form.grant_type === "refresh_token") {
    return auth.refreshReply || [200, { access_token: `acc-${form.refresh_token}`, refresh_token: `${form.refresh_token}+`, expires_in: 3600 }];
  }
  if (auth.pendingPolls > 0) {
    auth.pendingPolls -= 1;
    return [400, { error: "authorization_pending" }];
  }
  if (auth.deviceOutcome === "deny") return [400, { error: "access_denied" }];
  return [200, { access_token: "acc-0", refresh_token: "ref-0", expires_in: 3600 }];
}

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = parseBody(req, body);
      requests.push({ path: req.url, body: parsed, authorization: req.headers.authorization });
      if (req.url === "/.well-known/oauth-authorization-server") {
        return res.end(JSON.stringify({ device_authorization_endpoint: `${url}/oauth/device_authorization`, token_endpoint: `${url}/oauth/token`, revocation_endpoint: `${url}/oauth/revoke` }));
      }
      if (req.url === "/oauth/revoke") return res.end("");
      if (req.url === "/oauth/device_authorization") {
        return res.end(JSON.stringify({ device_code: "dev", user_code: "BCDF-GHJK", verification_uri: `${url}/device`, expires_in: 60, interval: 0 }));
      }
      if (req.url === "/oauth/token") {
        const [status, reply] = tokenReply(parsed);
        res.statusCode = status;
        return res.end(JSON.stringify(reply));
      }
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
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir, CONTINUUM_MCP_URL: url, CONTINUUM_NO_BROWSER: "1", ...extraEnv },
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

const tokenFile = (h) => path.join(h, ".continuum", "hook-token");
const readCreds = (h) => JSON.parse(fs.readFileSync(tokenFile(h), "utf-8"));
const prompt = { hook_event_name: "UserPromptSubmit", session_id: "s1", prompt: "hi", cwd: "/x" };

test("installer signs in with a device login and reuses the session on re-run", async () => {
  requests.length = 0;
  Object.assign(auth, { pendingPolls: 1, deviceOutcome: "approve", refreshReply: null });
  const h = home();
  fs.rmSync(tokenFile(h));
  const inst = await run("install_hook.js", h, "", { CONTINUUM_TOKEN: "" });
  assert.strictEqual(inst.code, 0);
  const creds = readCreds(h);
  assert.strictEqual(creds.access_token, "acc-0");
  assert.strictEqual(creds.refresh_token, "ref-0");
  assert.strictEqual(creds.token_endpoint, `${url}/oauth/token`);
  assert.ok(requests.some((r) => r.path === "/oauth/device_authorization" && r.body.device_name));

  requests.length = 0;
  await run("install_hook.js", h, "", { CONTINUUM_TOKEN: "" });
  assert.ok(!requests.some((r) => r.path === "/oauth/device_authorization"));
  assert.strictEqual(readCreds(h).refresh_token, "ref-0+");
});

test("installer fails when the login is denied", async () => {
  Object.assign(auth, { pendingPolls: 0, deviceOutcome: "deny", refreshReply: null });
  const h = home();
  fs.rmSync(tokenFile(h));
  const inst = await run("install_hook.js", h, "", { CONTINUUM_TOKEN: "" });
  assert.strictEqual(inst.code, 1);
  assert.ok(!fs.existsSync(tokenFile(h)));
});

test("hooks refresh an expiring access token and send the new one", async () => {
  requests.length = 0;
  Object.assign(auth, { refreshReply: null });
  const h = home();
  fs.writeFileSync(tokenFile(h), JSON.stringify({ access_token: "old", refresh_token: "r1", expires_at: Date.now() + 1000, token_endpoint: `${url}/oauth/token` }));
  const { out } = await run("continuum_context_inject.js", h, prompt);
  assert.strictEqual(JSON.parse(out).hookSpecificOutput.additionalContext, "CTX");
  assert.strictEqual(requests.find((r) => r.path === "/hook/context").authorization, "Bearer acc-r1");
  const creds = readCreds(h);
  assert.strictEqual(creds.refresh_token, "r1+");
  assert.ok(creds.expires_at > Date.now() + 3000 * 1000);
  assert.ok(!fs.existsSync(tokenFile(h) + ".lock"));

  requests.length = 0;
  await run("continuum_context_inject.js", h, prompt);
  assert.ok(!requests.some((r) => r.path === "/oauth/token"));
});

test("a revoked session stops the hooks until the installer runs again", async () => {
  requests.length = 0;
  Object.assign(auth, { refreshReply: [400, { error: "invalid_grant" }] });
  const h = home();
  fs.writeFileSync(tokenFile(h), JSON.stringify({ access_token: "old", refresh_token: "r1", expires_at: Date.now() - 1000, token_endpoint: `${url}/oauth/token` }));
  const { code, out } = await run("continuum_context_inject.js", h, prompt);
  assert.strictEqual(code, 0);
  assert.strictEqual(out, "");
  assert.strictEqual(readCreds(h).invalid, true);
  requests.length = 0;
  await run("continuum_session_capture.js", h, { hook_event_name: "SessionEnd", session_id: "s9", transcript_path: transcript(h, [say("user", "x".repeat(800))]) });
  assert.strictEqual(requests.length, 0);
  auth.refreshReply = null;
});

test("a hook skips refreshing while another holds the lock", async () => {
  requests.length = 0;
  const h = home();
  fs.writeFileSync(tokenFile(h), JSON.stringify({ access_token: "still-valid", refresh_token: "r1", expires_at: Date.now() + 30 * 1000, token_endpoint: `${url}/oauth/token` }));
  fs.writeFileSync(tokenFile(h) + ".lock", "");
  await run("continuum_context_inject.js", h, prompt);
  assert.ok(!requests.some((r) => r.path === "/oauth/token"));
  assert.strictEqual(requests.find((r) => r.path === "/hook/context").authorization, "Bearer still-valid");
});

test("both hooks carry the same token refresh code", () => {
  const block = (name) => {
    const src = fs.readFileSync(path.join(HOOKS, name), "utf-8");
    const start = src.indexOf("const REFRESH_MARGIN_MS");
    const end = src.indexOf("\n}\n", src.indexOf("async function accessToken"));
    return src.slice(start, end);
  };
  const inject = block("continuum_context_inject.js");
  assert.ok(inject.length > 500);
  assert.strictEqual(block("continuum_session_capture.js"), inject);
});

test("uninstaller revokes the device session before deleting it", async () => {
  requests.length = 0;
  const h = home();
  fs.writeFileSync(tokenFile(h), JSON.stringify({ access_token: "acc", refresh_token: "ref", expires_at: Date.now() + 3600 * 1000, token_endpoint: `${url}/oauth/token` }));
  const { code, out } = await run("uninstall_hook.js", h, "");
  assert.strictEqual(code, 0);
  const revoked = requests.filter((r) => r.path === "/oauth/revoke").map((r) => r.body.token);
  assert.deepStrictEqual(revoked, ["ref", "acc"]);
  assert.match(out, /signed out on the server/);
  assert.ok(!fs.existsSync(path.join(h, ".continuum")));
});

test("uninstaller still cleans up when the server is unreachable", async () => {
  const h = home();
  const { code, out } = await run("uninstall_hook.js", h, "", { CONTINUUM_MCP_URL: "http://127.0.0.1:1" });
  assert.strictEqual(code, 0);
  assert.match(out, /Couldn't reach Continuum/);
  assert.ok(!fs.existsSync(path.join(h, ".continuum")));
});
