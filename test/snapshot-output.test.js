"use strict";

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

let tmpRoot;
let origCwd;
let origEnv;

beforeEach(async () => {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tt-snap-")));
  origCwd = process.cwd();
  origEnv = { TT_HOME: process.env.TT_HOME };

  // Init git repo
  execFileSync("git", ["init", "-q", "-b", "main", tmpRoot], { stdio: "ignore" });
  execFileSync("git", ["-C", tmpRoot, "config", "user.email", "alice@example.com"], { stdio: "ignore" });

  // Create fixture: single user, 3 events
  const now = new Date().toISOString();
  const todayFile = now.slice(0, 10);
  const ttHome = path.join(tmpRoot, ".token-tracker");
  const eventsDir = path.join(ttHome, "events", "claude");
  await fsp.mkdir(eventsDir, { recursive: true });
  await fsp.writeFile(path.join(ttHome, "config.json"), JSON.stringify({ onboarded: true }));

  const base = Date.now();
  const evs = [
    { id: "1", ts: new Date(base - 3000).toISOString(), source: "claude", model: "claude-3-5-sonnet", input_tokens: 1000, output_tokens: 500, cost_usd: 2.50, cost_source: "computed", user_id: "alice@example.com", user_name: "Alice", project_id: "test-proj", project_path: tmpRoot, dedup_key: "a1" },
    { id: "2", ts: new Date(base - 2000).toISOString(), source: "claude", model: "claude-3-5-sonnet", input_tokens: 500, output_tokens: 250, cost_usd: 1.50, cost_source: "computed", user_id: "alice@example.com", user_name: "Alice", project_id: "test-proj", project_path: tmpRoot, dedup_key: "a2" },
    { id: "3", ts: new Date(base - 1000).toISOString(), source: "claude", model: "gpt-3.5", input_tokens: 100, output_tokens: 50, cost_usd: null, cost_source: null, user_id: "alice@example.com", user_name: "Alice", project_id: "test-proj", project_path: tmpRoot, dedup_key: "a3" },
  ];
  await fsp.writeFile(path.join(eventsDir, `${todayFile}.jsonl`), evs.map(e => JSON.stringify(e)).join("\n") + "\n");

  process.chdir(tmpRoot);
  process.env.TT_HOME = path.join(tmpRoot, ".token-tracker");
});

afterEach(() => {
  process.chdir(origCwd);
  if (origEnv.TT_HOME !== undefined) process.env.TT_HOME = origEnv.TT_HOME;
  else delete process.env.TT_HOME;
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

test("snapshot: default output (no flags) is stable across versions", () => {
  // Stub parsers to skip ingest
  const parsersPath = require.resolve("../src/parsers");
  require.cache[parsersPath] = {
    id: parsersPath,
    filename: parsersPath,
    loaded: true,
    exports: { getAll: () => [], getByName: () => null },
  };

  // Run CLI, capture stdout
  const result = spawnSync("node", [path.join(__dirname, "../src/cli.js")], {
    cwd: tmpRoot,
    env: { ...process.env, TT_HOME: process.env.TT_HOME },
    encoding: "utf8",
  });

  const output = result.stdout;

  const repoName = path.basename(tmpRoot);

  // Assertions: output structure is stable with global + project blocks
  assert.ok(output.includes("global"), "global block present");
  assert.ok(output.includes(`project (${repoName})`), "project block present");
  assert.ok(output.includes("Tokens"), "Tokens section present");
  assert.ok(output.includes("Models"), "Models section present");
  assert.ok(output.includes("claude-3-5-sonnet"), "model listed");
  assert.ok(!output.includes("Users"), "Users block absent for single user");
  assert.ok(!output.includes("top user"), "no 'top user' insight for single user");
  assert.ok(output.includes("project accounts for"), "project share insight present");

  // Verify single-user output does NOT reference --by-user or --user in main body
  // (these appear only in help, not in actual output flow)
  const mainContent = output.split("Insights")[0]; // before any insights
  assert.ok(!mainContent.includes("--by-user"));
  assert.ok(!mainContent.includes("--user"));
});

test("snapshot: --project . shows focused project block only", () => {
  const parsersPath = require.resolve("../src/parsers");
  require.cache[parsersPath] = {
    id: parsersPath,
    filename: parsersPath,
    loaded: true,
    exports: { getAll: () => [], getByName: () => null },
  };

  const result = spawnSync("node", [path.join(__dirname, "../src/cli.js"), "--project", "."], {
    cwd: tmpRoot,
    env: { ...process.env, TT_HOME: process.env.TT_HOME },
    encoding: "utf8",
  });

  const output = result.stdout;
  assert.ok(output.includes(`project (${path.basename(tmpRoot)})`), "focused project label present");
  assert.ok(!output.includes("global"), "global block omitted in focused mode");
});

test("snapshot: --json output is parseable JSON", () => {
  const parsersPath = require.resolve("../src/parsers");
  require.cache[parsersPath] = {
    id: parsersPath,
    filename: parsersPath,
    loaded: true,
    exports: { getAll: () => [], getByName: () => null },
  };

  const result = spawnSync("node", [path.join(__dirname, "../src/cli.js"), "--json"], {
    cwd: tmpRoot,
    env: { ...process.env, TT_HOME: process.env.TT_HOME },
    encoding: "utf8",
  });

  assert.doesNotThrow(() => {
    const data = JSON.parse(result.stdout);
    assert.ok(data.today);
    assert.ok(data.daily);
    assert.ok(Array.isArray(data.daily));
  });
});

test("snapshot: first run with --json does not print onboarding before JSON", async () => {
  await fsp.unlink(path.join(process.env.TT_HOME, "config.json"));

  const parsersPath = require.resolve("../src/parsers");
  require.cache[parsersPath] = {
    id: parsersPath,
    filename: parsersPath,
    loaded: true,
    exports: { getAll: () => [], getByName: () => null },
  };

  const result = spawnSync("node", [path.join(__dirname, "../src/cli.js"), "--json"], {
    cwd: tmpRoot,
    env: { ...process.env, TT_HOME: process.env.TT_HOME },
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.doesNotThrow(() => JSON.parse(result.stdout));
  assert.ok(!result.stdout.includes("TokenTracker"), "must not print onboarding/help in json mode");
});
