"use strict";

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

let tmpRoot;
let repoA;
let repoB;
let origEnv;
let origCwd;

function fresh(modPath) {
  const resolved = require.resolve(modPath);
  delete require.cache[resolved];
  return require(modPath);
}

function initGitRepo(dir) {
  execFileSync("git", ["init", "-q", "-b", "main", dir], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "config", "user.email", "tester@example.com"], { stdio: "ignore" });
}

async function writeLayoutAEvent(baseDir, source, date, userId, ev) {
  const userFile = encodeURIComponent(userId || "_nouser") + ".jsonl";
  const file = path.join(baseDir, ".token-tracker", "events", source, date, userFile);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(ev) + "\n", "utf8");
}

beforeEach(() => {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tt-xrepo-")));
  repoA = path.join(tmpRoot, "repo-a");
  repoB = path.join(tmpRoot, "repo-b");
  fs.mkdirSync(repoA, { recursive: true });
  fs.mkdirSync(repoB, { recursive: true });
  initGitRepo(repoA);
  initGitRepo(repoB);

  origEnv = { HOME: process.env.HOME, TT_HOME: process.env.TT_HOME, TT_STORAGE: process.env.TT_STORAGE };
  origCwd = process.cwd();

  process.env.HOME = path.join(tmpRoot, "home");
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete process.env.TT_HOME;
  delete process.env.TT_STORAGE;
  process.chdir(repoA);

  for (const key of Object.keys(require.cache)) {
    if (key.includes("/src/storage-path") || key.includes("/src/repo-registry") || key.includes("/src/event-log")) {
      delete require.cache[key];
    }
  }
});

afterEach(() => {
  process.chdir(origCwd);
  if (origEnv.HOME !== undefined) process.env.HOME = origEnv.HOME;
  else delete process.env.HOME;
  if (origEnv.TT_HOME !== undefined) process.env.TT_HOME = origEnv.TT_HOME;
  else delete process.env.TT_HOME;
  if (origEnv.TT_STORAGE !== undefined) process.env.TT_STORAGE = origEnv.TT_STORAGE;
  else delete process.env.TT_STORAGE;
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

test("readAllRepos merges current repo + registry repos + global with dedup by dedup_key", async () => {
  const today = "2026-04-21";
  const source = "claude";
  const user = "alice@example.com";

  const evA = {
    id: "a1",
    ts: "2026-04-21T10:00:00.000Z",
    source,
    model: "claude-3-5-sonnet",
    input_tokens: 100,
    output_tokens: 50,
    cost_usd: 1.25,
    user_id: user,
    project_id: "repo-a",
    project_path: repoA,
    dedup_key: "k-a",
  };

  const evB = {
    id: "b1",
    ts: "2026-04-21T11:00:00.000Z",
    source,
    model: "claude-3-5-sonnet",
    input_tokens: 200,
    output_tokens: 80,
    cost_usd: 2.75,
    user_id: user,
    project_id: "repo-b",
    project_path: repoB,
    dedup_key: "k-b",
  };

  // current repo event
  await writeLayoutAEvent(repoA, source, today, user, evA);
  // registered repo event
  await writeLayoutAEvent(repoB, source, today, user, evB);
  // duplicate in global storage (must be deduped)
  await writeLayoutAEvent(process.env.HOME, source, today, user, evB);

  const registry = fresh("../src/repo-registry");
  await registry.registerRepo(repoB, { now: today });

  const eventLog = fresh("../src/event-log");
  const events = await eventLog.readAllRepos();

  assert.equal(events.length, 2);
  const ids = new Set(events.map((e) => e.project_id));
  assert.ok(ids.has("repo-a"));
  assert.ok(ids.has("repo-b"));
});
