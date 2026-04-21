"use strict";

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

let tmpRoot;
let origEnv;
let origCwd;

function fresh(modPath) {
  const resolved = require.resolve(modPath);
  delete require.cache[resolved];
  return require(modPath);
}

beforeEach(() => {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tt-registry-")));
  origEnv = { HOME: process.env.HOME, TT_HOME: process.env.TT_HOME, TT_STORAGE: process.env.TT_STORAGE };
  origCwd = process.cwd();
  process.env.HOME = tmpRoot;
  delete process.env.TT_HOME;
  delete process.env.TT_STORAGE;
  for (const key of Object.keys(require.cache)) {
    if (key.includes("/src/storage-path") || key.includes("/src/repo-registry")) {
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

test("registerRepo/listRepos: saves repo and updates last_seen without duplicates", async () => {
  const registry = fresh("../src/repo-registry");
  const repoA = fs.mkdtempSync(path.join(tmpRoot, "repo-a-"));

  await registry.registerRepo(repoA, { now: "2026-04-20" });
  await registry.registerRepo(repoA, { now: "2026-04-21" });

  const repos = await registry.listRepos();
  assert.equal(repos.length, 1);
  assert.equal(repos[0].path, fs.realpathSync(repoA));
  assert.equal(repos[0].last_seen, "2026-04-21");
});

test("pruneStale: removes missing and old entries", async () => {
  const registry = fresh("../src/repo-registry");
  const keepRepo = fs.mkdtempSync(path.join(tmpRoot, "repo-keep-"));
  const oldRepo = fs.mkdtempSync(path.join(tmpRoot, "repo-old-"));
  const missingRepo = path.join(tmpRoot, "repo-missing");

  await registry.saveRegistry({
    repos: [
      { path: fs.realpathSync(keepRepo), last_seen: "2026-04-15" },
      { path: fs.realpathSync(oldRepo), last_seen: "2026-01-01" },
      { path: missingRepo, last_seen: "2026-04-20" },
    ],
  });

  await registry.pruneStale({ maxAgeDays: 30, now: "2026-04-21" });
  const repos = await registry.listRepos();

  assert.equal(repos.length, 1);
  assert.equal(repos[0].path, fs.realpathSync(keepRepo));
});
