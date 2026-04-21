"use strict";

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

// Isolate module cache so each test can reset require caches cleanly.
function freshRequire(modPath) {
  const resolved = require.resolve(modPath);
  delete require.cache[resolved];
  return require(modPath);
}

function initGitRepo(dir) {
  execFileSync("git", ["init", "-q", "-b", "main", dir], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "config", "user.email", "tester@example.com"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "config", "user.name", "Tester"], { stdio: "ignore" });
}

function makeParserStub(name, entries) {
  return {
    name,
    async ingest() { return entries; },
  };
}

let tmpRoot;
let origCwd;
let origEnv;

beforeEach(() => {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tt-int-")));
  origCwd = process.cwd();
  origEnv = {
    TT_HOME: process.env.TT_HOME,
    TT_STORAGE: process.env.TT_STORAGE,
    TT_USER_ID_STRATEGY: process.env.TT_USER_ID_STRATEGY,
  };
  delete process.env.TT_HOME;
  delete process.env.TT_STORAGE;
  delete process.env.TT_USER_ID_STRATEGY;

  // purge cached modules under test so fresh resolves happen per test
  for (const key of Object.keys(require.cache)) {
    if (key.includes("/src/storage-path") ||
        key.includes("/src/event-log") ||
        key.includes("/src/git-user") ||
        key.includes("/src/parsers/") ||
        key.endsWith("/src/parsers/index.js") ||
        key.endsWith("/src/parsers") ||
        key.includes("/src/types/event") ||
        key.includes("/src/services/pricing")) {
      delete require.cache[key];
    }
  }
});

afterEach(() => {
  process.chdir(origCwd);
  for (const k of Object.keys(origEnv)) {
    if (origEnv[k] !== undefined) process.env[k] = origEnv[k];
    else delete process.env[k];
  }
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

test("ingestAll → read round-trip in Git repo storage", async () => {
  initGitRepo(tmpRoot);
  process.chdir(tmpRoot);

  // Stub parsers registry to return synthetic entries with project_path inside repo.
  const parsersPath = require.resolve("../src/parsers");
  const entry = {
    timestamp: new Date().toISOString(),
    source: "claude",
    model: "claude-3-5-sonnet",
    input_tokens: 100,
    output_tokens: 50,
    project_path: tmpRoot,
    project_id: path.basename(tmpRoot),
    session_id: "sess-1",
  };
  require.cache[parsersPath] = {
    id: parsersPath,
    filename: parsersPath,
    loaded: true,
    exports: {
      getAll: () => [makeParserStub("claude", [entry])],
      getByName: (n) => (n === "claude" ? makeParserStub("claude", [entry]) : null),
    },
  };

  const storagePath = freshRequire("../src/storage-path");
  const eventLog = freshRequire("../src/event-log");

  // Sanity: storage mode should be repo inside tmp git dir
  assert.equal(storagePath.getStorageMode(), "repo");
  assert.equal(storagePath.getTTHome(), path.join(tmpRoot, ".token-tracker"));

  await eventLog.ingestAll();

  // Events file exists
  const eventsDir = path.join(tmpRoot, ".token-tracker", "events", "claude");
  const files = await fsp.readdir(eventsDir);
  assert.ok(files.length >= 1, "event file should be created");

  // Read back events
  const events = await eventLog.read();
  assert.equal(events.length, 1);
  const ev = events[0];
  assert.equal(ev.source, "claude");
  assert.equal(ev.input_tokens, 100);
  assert.equal(ev.user_id, "tester@example.com");
  assert.equal(ev.project_path, tmpRoot);

  // Cursor persisted under user partition
  const cursorFile = path.join(tmpRoot, ".token-tracker", "cursors", "claude", "tester@example.com.json");
  assert.ok(fs.existsSync(cursorFile), "user-partitioned cursor should exist");
  const cursor = JSON.parse(fs.readFileSync(cursorFile, "utf8"));
  assert.ok(Array.isArray(cursor.seen_keys_today));
  assert.ok(cursor.seen_keys_today.length >= 1);
});

test("ingestAll: event outside repo → double-write to global storage only", async () => {
  initGitRepo(tmpRoot);
  process.chdir(tmpRoot);

  // Fake HOME so global storage lands in tmp area (avoids polluting real ~).
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "tt-home-"));
  const origHome = process.env.HOME;
  process.env.HOME = fakeHome;

  try {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-outside-"));
    const entry = {
      timestamp: new Date().toISOString(),
      source: "codex",
      model: "gpt-4",
      input_tokens: 200,
      output_tokens: 100,
      project_path: outsideDir,
      project_id: path.basename(outsideDir),
      session_id: "sess-out",
    };

    const parsersPath = require.resolve("../src/parsers");
    require.cache[parsersPath] = {
      id: parsersPath,
      filename: parsersPath,
      loaded: true,
      exports: {
        getAll: () => [makeParserStub("codex", [entry])],
        getByName: () => null,
      },
    };

    const eventLog = freshRequire("../src/event-log");
    await eventLog.ingestAll();

    // Not in repo storage
    const repoEventsDir = path.join(tmpRoot, ".token-tracker", "events");
    assert.equal(fs.existsSync(repoEventsDir), false, "repo storage must NOT contain out-of-scope event");

    // But present in global (fake home)
    const globalEventsDir = path.join(fakeHome, ".token-tracker", "events", "codex");
    assert.ok(fs.existsSync(globalEventsDir), "global storage must contain out-of-scope event");
    const files = await fsp.readdir(globalEventsDir);
    assert.ok(files.length >= 1);

    try { fs.rmSync(outsideDir, { recursive: true, force: true }); } catch { /* ignore */ }
  } finally {
    if (origHome !== undefined) process.env.HOME = origHome;
    else delete process.env.HOME;
    try { fs.rmSync(fakeHome, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test("ingestAll: dedup prevents same event being appended twice", async () => {
  initGitRepo(tmpRoot);
  process.chdir(tmpRoot);

  const entry = {
    timestamp: new Date().toISOString(),
    source: "claude",
    model: "claude-3-5-sonnet",
    input_tokens: 10,
    output_tokens: 20,
    project_path: tmpRoot,
    project_id: path.basename(tmpRoot),
    session_id: "sess-dup",
  };

  const parsersPath = require.resolve("../src/parsers");
  const stub = makeParserStub("claude", [entry]);
  require.cache[parsersPath] = {
    id: parsersPath,
    filename: parsersPath,
    loaded: true,
    exports: { getAll: () => [stub], getByName: () => stub },
  };

  const eventLog = freshRequire("../src/event-log");
  await eventLog.ingestAll();
  await eventLog.ingestAll(); // second run: same entry, should not duplicate

  const events = await eventLog.read();
  assert.equal(events.length, 1, "dedup_key must prevent duplicate append across runs");
});

test("ingestAll: no Git repo → falls back to global storage", async () => {
  // tmpRoot has NO .git init
  process.chdir(tmpRoot);

  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "tt-home-"));
  const origHome = process.env.HOME;
  process.env.HOME = fakeHome;

  try {
    const entry = {
      timestamp: new Date().toISOString(),
      source: "gemini",
      model: "gemini-pro",
      input_tokens: 5,
      output_tokens: 5,
      project_path: tmpRoot,
      project_id: path.basename(tmpRoot),
    };

    const parsersPath = require.resolve("../src/parsers");
    const stub = makeParserStub("gemini", [entry]);
    require.cache[parsersPath] = {
      id: parsersPath,
      filename: parsersPath,
      loaded: true,
      exports: { getAll: () => [stub], getByName: () => stub },
    };

    const storagePath = freshRequire("../src/storage-path");
    const eventLog = freshRequire("../src/event-log");

    assert.equal(storagePath.getStorageMode(), "global");

    await eventLog.ingestAll();

    const globalEventsDir = path.join(fakeHome, ".token-tracker", "events", "gemini");
    assert.ok(fs.existsSync(globalEventsDir));
    const events = await eventLog.read();
    assert.equal(events.length, 1);
  } finally {
    if (origHome !== undefined) process.env.HOME = origHome;
    else delete process.env.HOME;
    try { fs.rmSync(fakeHome, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
