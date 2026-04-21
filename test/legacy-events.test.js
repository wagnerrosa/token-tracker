"use strict";

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");

let tmpRoot;
let origEnv;

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tt-legacy-"));
  origEnv = { TT_HOME: process.env.TT_HOME };
  process.env.TT_HOME = tmpRoot;

  // purge module caches
  for (const key of Object.keys(require.cache)) {
    if (key.includes("/src/event-log") || key.includes("/src/storage-path")) {
      delete require.cache[key];
    }
  }
});

afterEach(() => {
  if (origEnv.TT_HOME !== undefined) process.env.TT_HOME = origEnv.TT_HOME;
  else delete process.env.TT_HOME;
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

test("read: legacy events without user_id aggregate normally", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const eventsDir = path.join(tmpRoot, "events", "claude");
  await fsp.mkdir(eventsDir, { recursive: true });

  // Write legacy events (no user_id field)
  const legacyEvents = [
    { id: "1", ts: `${today}T10:00:00Z`, source: "claude", model: "claude-3-5-sonnet", input_tokens: 100, output_tokens: 50, dedup_key: "legacy-1" },
    { id: "2", ts: `${today}T11:00:00Z`, source: "claude", model: "claude-3-5-sonnet", input_tokens: 200, output_tokens: 100, dedup_key: "legacy-2" },
  ];
  const lines = legacyEvents.map(e => JSON.stringify(e)).join("\n") + "\n";
  await fsp.writeFile(path.join(eventsDir, `${today}.jsonl`), lines);

  const eventLog = require("../src/event-log");
  const events = await eventLog.read();

  assert.equal(events.length, 2);
  assert.equal(events[0].user_id, undefined);
  assert.equal(events[1].user_id, undefined);
  assert.equal(events[0].input_tokens, 100);
  assert.equal(events[1].input_tokens, 200);
});

test("read: mixed legacy (no user_id) and new (with user_id) events coexist", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const eventsDir = path.join(tmpRoot, "events", "claude");
  await fsp.mkdir(eventsDir, { recursive: true });

  const mixed = [
    { id: "1", ts: `${today}T10:00:00Z`, source: "claude", model: "claude-3-5-sonnet", input_tokens: 100, output_tokens: 50, dedup_key: "legacy-1" },
    { id: "2", ts: `${today}T11:00:00Z`, source: "claude", model: "claude-3-5-sonnet", input_tokens: 50, output_tokens: 25, user_id: "alice@example.com", dedup_key: "new-alice-1" },
  ];
  const lines = mixed.map(e => JSON.stringify(e)).join("\n") + "\n";
  await fsp.writeFile(path.join(eventsDir, `${today}.jsonl`), lines);

  const eventLog = require("../src/event-log");
  const events = await eventLog.read();

  assert.equal(events.length, 2);
  assert.equal(events[0].user_id, undefined);
  assert.equal(events[1].user_id, "alice@example.com");
  assert.equal(events[0].input_tokens, 100);
  assert.equal(events[1].input_tokens, 50);
});

test("read: legacy dedup_key format (no user_id suffix) still works", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const eventsDir = path.join(tmpRoot, "events", "gemini");
  await fsp.mkdir(eventsDir, { recursive: true });

  const legacy = {
    id: "x",
    ts: `${today}T12:00:00Z`,
    source: "gemini",
    model: "gemini-pro",
    input_tokens: 10,
    output_tokens: 5,
    dedup_key: "2024-01-15:gemini:gemini-pro:10:5", // old format, no user_id suffix
  };
  await fsp.writeFile(path.join(eventsDir, `${today}.jsonl`), JSON.stringify(legacy) + "\n");

  const eventLog = require("../src/event-log");
  const events = await eventLog.read();

  assert.equal(events.length, 1);
  assert.equal(events[0].dedup_key, "2024-01-15:gemini:gemini-pro:10:5");
  assert.equal(events[0].user_id, undefined);
});
