"use strict";

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");

let tmpRoot;
let origEnv;

function purgeModules() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes("/src/event-log") ||
      key.includes("/src/storage-path")
    ) {
      delete require.cache[key];
    }
  }
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tt-layout-"));
  origEnv = {
    TT_HOME: process.env.TT_HOME,
    TT_EVENT_LAYOUT: process.env.TT_EVENT_LAYOUT,
  };
  process.env.TT_HOME = tmpRoot;
  delete process.env.TT_EVENT_LAYOUT;
  purgeModules();
});

afterEach(() => {
  if (origEnv.TT_HOME !== undefined) process.env.TT_HOME = origEnv.TT_HOME;
  else delete process.env.TT_HOME;
  if (origEnv.TT_EVENT_LAYOUT !== undefined) process.env.TT_EVENT_LAYOUT = origEnv.TT_EVENT_LAYOUT;
  else delete process.env.TT_EVENT_LAYOUT;
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  purgeModules();
});

const DATE = "2024-03-15";
const BASE_EVENT = {
  id: "ev1",
  ts: `${DATE}T10:00:00Z`,
  source: "claude",
  model: "claude-3-5-sonnet",
  input_tokens: 100,
  output_tokens: 50,
  dedup_key: "k1",
  user_id: "alice@example.com",
};

// --- Layout A: events/{source}/{date}/{user}.jsonl ---

test("layout A: appendToDir writes to {source}/{date}/{user}.jsonl", async () => {
  const { appendToDir, encodeUserId } = require("../src/event-log");
  const eventsDir = path.join(tmpRoot, "events");
  await appendToDir([BASE_EVENT], eventsDir);

  const expectedFile = path.join(
    eventsDir,
    BASE_EVENT.source,
    DATE,
    `${encodeUserId(BASE_EVENT.user_id)}.jsonl`
  );
  assert.ok(fs.existsSync(expectedFile), `layout A file must exist: ${expectedFile}`);
  const content = fs.readFileSync(expectedFile, "utf8");
  const parsed = JSON.parse(content.trim());
  assert.equal(parsed.id, BASE_EVENT.id);
});

test("layout A: read() finds events in {source}/{date}/{user}.jsonl", async () => {
  const { appendToDir, read } = require("../src/event-log");
  const eventsDir = path.join(tmpRoot, "events");
  await appendToDir([BASE_EVENT], eventsDir);

  const events = await read({ source: "claude" });
  assert.equal(events.length, 1);
  assert.equal(events[0].id, BASE_EVENT.id);
  assert.equal(events[0].user_id, BASE_EVENT.user_id);
});

// --- Layout B: events/{source}/{date}.jsonl ---

test("layout B: appendToDir writes to {source}/{date}.jsonl", async () => {
  process.env.TT_EVENT_LAYOUT = "B";
  purgeModules();
  const { appendToDir } = require("../src/event-log");
  const eventsDir = path.join(tmpRoot, "events");
  await appendToDir([BASE_EVENT], eventsDir);

  const expectedFile = path.join(eventsDir, BASE_EVENT.source, `${DATE}.jsonl`);
  assert.ok(fs.existsSync(expectedFile), `layout B file must exist: ${expectedFile}`);
  const content = fs.readFileSync(expectedFile, "utf8");
  const parsed = JSON.parse(content.trim());
  assert.equal(parsed.id, BASE_EVENT.id);
});

test("layout B: read() finds events in {source}/{date}.jsonl", async () => {
  process.env.TT_EVENT_LAYOUT = "B";
  purgeModules();
  const { appendToDir, read } = require("../src/event-log");
  const eventsDir = path.join(tmpRoot, "events");
  await appendToDir([BASE_EVENT], eventsDir);

  const events = await read({ source: "claude" });
  assert.equal(events.length, 1);
  assert.equal(events[0].id, BASE_EVENT.id);
});

// --- Dual-layout read: A + B simultaneously ---

test("read() finds events in both layouts simultaneously", async () => {
  const eventsDir = path.join(tmpRoot, "events");

  // Write layout B manually
  const layoutBDir = path.join(eventsDir, "claude");
  await fsp.mkdir(layoutBDir, { recursive: true });
  const evB = { ...BASE_EVENT, id: "ev-b", dedup_key: "kb", user_id: "bob@example.com" };
  await fsp.writeFile(path.join(layoutBDir, `${DATE}.jsonl`), JSON.stringify(evB) + "\n");

  // Write layout A manually (different user, same date)
  const layoutADir = path.join(eventsDir, "claude", DATE);
  await fsp.mkdir(layoutADir, { recursive: true });
  const evA = { ...BASE_EVENT, id: "ev-a", dedup_key: "ka", user_id: "alice@example.com" };
  await fsp.writeFile(path.join(layoutADir, "alice%40example.com.jsonl"), JSON.stringify(evA) + "\n");

  const { read } = require("../src/event-log");
  const events = await read({ source: "claude" });
  assert.equal(events.length, 2, "must read from both layout A and B");
  const ids = events.map((e) => e.id).sort();
  assert.deepEqual(ids, ["ev-a", "ev-b"]);
});

// --- User without user_id (nouser bucket) ---

test("layout A: event without user_id goes to _nouser.jsonl", async () => {
  const { appendToDir } = require("../src/event-log");
  const eventsDir = path.join(tmpRoot, "events");
  const evNoUser = { ...BASE_EVENT, id: "ev-nouser", user_id: undefined, dedup_key: "knu" };
  await appendToDir([evNoUser], eventsDir);

  const expectedFile = path.join(eventsDir, "claude", DATE, "_nouser.jsonl");
  assert.ok(fs.existsSync(expectedFile), `_nouser.jsonl must exist`);
});

test("layout A: read() includes _nouser.jsonl events", async () => {
  const { appendToDir, read } = require("../src/event-log");
  const eventsDir = path.join(tmpRoot, "events");
  const evNoUser = { ...BASE_EVENT, id: "ev-nouser", user_id: undefined, dedup_key: "knu" };
  await appendToDir([evNoUser], eventsDir);

  const events = await read({ source: "claude" });
  assert.equal(events.length, 1);
  assert.equal(events[0].id, "ev-nouser");
});

// --- Multiple users, same date, layout A ---

test("layout A: two users same date → two separate files, both read", async () => {
  const { appendToDir, encodeUserId, read } = require("../src/event-log");
  const eventsDir = path.join(tmpRoot, "events");

  const evAlice = { ...BASE_EVENT, id: "ev-alice", user_id: "alice@example.com", dedup_key: "ka" };
  const evBob = { ...BASE_EVENT, id: "ev-bob", user_id: "bob@example.com", dedup_key: "kb" };
  await appendToDir([evAlice, evBob], eventsDir);

  const dir = path.join(eventsDir, "claude", DATE);
  const files = fs.readdirSync(dir);
  assert.ok(files.includes(`${encodeUserId("alice@example.com")}.jsonl`));
  assert.ok(files.includes(`${encodeUserId("bob@example.com")}.jsonl`));

  const events = await read({ source: "claude" });
  assert.equal(events.length, 2);
  const ids = events.map((e) => e.id).sort();
  assert.deepEqual(ids, ["ev-alice", "ev-bob"]);
});

// --- Date filter works on both layouts ---

const DATE2 = "2024-03-16";

test("read() since/until filter works on layout A", async () => {
  const { appendToDir, read } = require("../src/event-log");
  const eventsDir = path.join(tmpRoot, "events");

  const ev1 = { ...BASE_EVENT, id: "ev-d1", ts: `${DATE}T10:00:00Z`, dedup_key: "kd1" };
  const ev2 = { ...BASE_EVENT, id: "ev-d2", ts: `${DATE2}T10:00:00Z`, dedup_key: "kd2" };
  await appendToDir([ev1, ev2], eventsDir);

  const events = await read({ source: "claude", until: `${DATE}T23:59:59Z` });
  assert.equal(events.length, 1);
  assert.equal(events[0].id, "ev-d1");
});

test("read() since/until filter works on layout B", async () => {
  process.env.TT_EVENT_LAYOUT = "B";
  purgeModules();
  const { appendToDir, read } = require("../src/event-log");
  const eventsDir = path.join(tmpRoot, "events");

  const ev1 = { ...BASE_EVENT, id: "ev-d1", ts: `${DATE}T10:00:00Z`, dedup_key: "kd1" };
  const ev2 = { ...BASE_EVENT, id: "ev-d2", ts: `${DATE2}T10:00:00Z`, dedup_key: "kd2" };
  await appendToDir([ev1, ev2], eventsDir);

  const events = await read({ source: "claude", since: `${DATE2}T00:00:00Z` });
  assert.equal(events.length, 1);
  assert.equal(events[0].id, "ev-d2");
});
