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
      key.includes("/src/storage-path") ||
      key.includes("/src/compact")
    ) {
      delete require.cache[key];
    }
  }
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tt-compact-"));
  origEnv = { TT_HOME: process.env.TT_HOME };
  process.env.TT_HOME = tmpRoot;
  purgeModules();
});

afterEach(() => {
  if (origEnv.TT_HOME !== undefined) process.env.TT_HOME = origEnv.TT_HOME;
  else delete process.env.TT_HOME;
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  purgeModules();
});

function sumEvents(evs) {
  return {
    input: evs.reduce((s, e) => s + (e.input_tokens || 0), 0),
    output: evs.reduce((s, e) => s + (e.output_tokens || 0), 0),
    cache_read: evs.reduce((s, e) => s + (e.cache_read_tokens || 0), 0),
    cache_write: evs.reduce((s, e) => s + (e.cache_write_tokens || 0), 0),
    reasoning: evs.reduce((s, e) => s + (e.reasoning_tokens || 0), 0),
    cost: evs.reduce((s, e) => s + (e.cost_usd || 0), 0),
  };
}

function makeEvent(overrides = {}) {
  return {
    id: `ev-${Math.random().toString(36).slice(2, 10)}`,
    ts: "2024-01-10T10:00:00Z",
    source: "claude",
    model: "claude-3-5-sonnet",
    input_tokens: 100,
    output_tokens: 50,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    reasoning_tokens: 0,
    cost_usd: 0.0015,
    user_id: "alice@example.com",
    project_id: "proj1",
    project_path: "/repo/proj1",
    dedup_key: `k-${Math.random().toString(36).slice(2, 10)}`,
    ...overrides,
  };
}

async function writeLayoutB(eventsDir, source, date, events) {
  const dir = path.join(eventsDir, source);
  await fsp.mkdir(dir, { recursive: true });
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await fsp.writeFile(path.join(dir, `${date}.jsonl`), lines);
}

async function writeLayoutA(eventsDir, source, date, userId, events) {
  const dir = path.join(eventsDir, source, date);
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${encodeURIComponent(userId)}.jsonl`);
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await fsp.writeFile(file, lines);
}

// --- Invariant 1: totals preserved after compact (single group) ---

test("compact: totals preserved for single day/source/user/project group", async () => {
  const eventsDir = path.join(tmpRoot, "events");
  const events = [
    makeEvent({ ts: "2024-01-10T10:00:00Z", input_tokens: 100, output_tokens: 50, cost_usd: 0.001 }),
    makeEvent({ ts: "2024-01-10T11:00:00Z", input_tokens: 200, output_tokens: 75, cost_usd: 0.002 }),
    makeEvent({ ts: "2024-01-10T12:00:00Z", input_tokens: 50, output_tokens: 25, cost_usd: 0.0005 }),
  ];
  await writeLayoutB(eventsDir, "claude", "2024-01-10", events);

  const before = sumEvents(events);

  const { compactBefore } = require("../src/compact");
  await compactBefore("2024-01-11", { eventsDir });

  const { read } = require("../src/event-log");
  const after = await read({ source: "claude" });

  const afterSum = sumEvents(after);
  assert.equal(afterSum.input, before.input, "input_tokens preserved");
  assert.equal(afterSum.output, before.output, "output_tokens preserved");
  assert.equal(afterSum.cost.toFixed(8), before.cost.toFixed(8), "cost_usd preserved");
  assert.equal(after.length, 1, "3 events compacted → 1 aggregate");
  assert.equal(after[0].compacted, true);
  assert.equal(after[0].compacted_count, 3);
});

// --- Invariant 2: totals preserved across multiple groups ---

test("compact: totals preserved across multiple users/projects/models", async () => {
  const eventsDir = path.join(tmpRoot, "events");
  const events = [
    makeEvent({ ts: "2024-01-10T10:00:00Z", user_id: "alice", input_tokens: 100, output_tokens: 50, cost_usd: 0.001 }),
    makeEvent({ ts: "2024-01-10T11:00:00Z", user_id: "alice", input_tokens: 200, output_tokens: 75, cost_usd: 0.002 }),
    makeEvent({ ts: "2024-01-10T12:00:00Z", user_id: "bob", input_tokens: 150, output_tokens: 60, cost_usd: 0.0015 }),
    makeEvent({ ts: "2024-01-10T13:00:00Z", user_id: "bob", model: "claude-3-haiku", input_tokens: 30, output_tokens: 10, cost_usd: 0.0001 }),
    makeEvent({ ts: "2024-01-10T14:00:00Z", user_id: "alice", project_id: "proj2", input_tokens: 80, output_tokens: 40, cost_usd: 0.0008 }),
  ];
  await writeLayoutB(eventsDir, "claude", "2024-01-10", events);

  const before = sumEvents(events);

  const { compactBefore } = require("../src/compact");
  const stats = await compactBefore("2024-01-11", { eventsDir });

  const { read } = require("../src/event-log");
  const after = await read({ source: "claude" });
  const afterSum = sumEvents(after);

  assert.equal(afterSum.input, before.input, "input_tokens invariant");
  assert.equal(afterSum.output, before.output, "output_tokens invariant");
  assert.equal(afterSum.cost.toFixed(8), before.cost.toFixed(8), "cost_usd invariant");
  // 4 distinct groups: (alice, proj1, sonnet), (bob, proj1, sonnet), (bob, proj1, haiku), (alice, proj2, sonnet)
  assert.equal(after.length, 4, "4 distinct groups");
  assert.equal(stats.events_read, 5);
});

// --- Invariant 3: totals preserved across multiple dates ---

test("compact: totals preserved across multiple dates before cutoff", async () => {
  const eventsDir = path.join(tmpRoot, "events");
  const d1 = [
    makeEvent({ ts: "2024-01-08T10:00:00Z", input_tokens: 100, output_tokens: 50, cost_usd: 0.001 }),
    makeEvent({ ts: "2024-01-08T11:00:00Z", input_tokens: 50, output_tokens: 25, cost_usd: 0.0005 }),
  ];
  const d2 = [
    makeEvent({ ts: "2024-01-09T10:00:00Z", input_tokens: 200, output_tokens: 100, cost_usd: 0.002 }),
  ];
  await writeLayoutB(eventsDir, "claude", "2024-01-08", d1);
  await writeLayoutB(eventsDir, "claude", "2024-01-09", d2);

  const before = sumEvents([...d1, ...d2]);

  const { compactBefore } = require("../src/compact");
  await compactBefore("2024-01-11", { eventsDir });

  const { read } = require("../src/event-log");
  const after = await read({ source: "claude" });
  const afterSum = sumEvents(after);

  assert.equal(afterSum.input, before.input);
  assert.equal(afterSum.output, before.output);
  assert.equal(afterSum.cost.toFixed(8), before.cost.toFixed(8));
  // 2 date groups, 1 aggregate each = 2 aggregated events
  assert.equal(after.length, 2);
});

// --- Invariant 4: cutoff respected — events on/after `before` untouched ---

test("compact: events on or after cutoff are NOT compacted", async () => {
  const eventsDir = path.join(tmpRoot, "events");
  const old = [
    makeEvent({ ts: "2024-01-08T10:00:00Z", input_tokens: 100, output_tokens: 50, cost_usd: 0.001 }),
    makeEvent({ ts: "2024-01-08T11:00:00Z", input_tokens: 200, output_tokens: 75, cost_usd: 0.002 }),
  ];
  const recent = [
    makeEvent({ ts: "2024-01-11T10:00:00Z", input_tokens: 500, output_tokens: 250, cost_usd: 0.005, dedup_key: "rec1" }),
  ];
  await writeLayoutB(eventsDir, "claude", "2024-01-08", old);
  await writeLayoutB(eventsDir, "claude", "2024-01-11", recent);

  const before = sumEvents([...old, ...recent]);

  const { compactBefore } = require("../src/compact");
  await compactBefore("2024-01-11", { eventsDir });

  const { read } = require("../src/event-log");
  const after = await read({ source: "claude" });
  const afterSum = sumEvents(after);

  // total preserved
  assert.equal(afterSum.input, before.input);
  assert.equal(afterSum.output, before.output);
  assert.equal(afterSum.cost.toFixed(8), before.cost.toFixed(8));

  // recent file untouched → raw event still present
  const rawRecent = after.find((e) => e.dedup_key === "rec1");
  assert.ok(rawRecent, "recent event kept raw (not compacted)");
  assert.notEqual(rawRecent.compacted, true);

  // old compacted
  const compactedOld = after.filter((e) => e.compacted === true);
  assert.equal(compactedOld.length, 1);
});

// --- Invariant 5: layout A input compacts correctly ---

test("compact: layout A events preserve totals", async () => {
  const eventsDir = path.join(tmpRoot, "events");
  const aliceEvs = [
    makeEvent({ ts: "2024-01-08T10:00:00Z", user_id: "alice@example.com", input_tokens: 100, output_tokens: 50, cost_usd: 0.001 }),
    makeEvent({ ts: "2024-01-08T11:00:00Z", user_id: "alice@example.com", input_tokens: 200, output_tokens: 75, cost_usd: 0.002 }),
  ];
  const bobEvs = [
    makeEvent({ ts: "2024-01-08T12:00:00Z", user_id: "bob@example.com", input_tokens: 150, output_tokens: 60, cost_usd: 0.0015 }),
  ];
  await writeLayoutA(eventsDir, "claude", "2024-01-08", "alice@example.com", aliceEvs);
  await writeLayoutA(eventsDir, "claude", "2024-01-08", "bob@example.com", bobEvs);

  const before = sumEvents([...aliceEvs, ...bobEvs]);

  const { compactBefore } = require("../src/compact");
  await compactBefore("2024-01-11", { eventsDir });

  const { read } = require("../src/event-log");
  const after = await read({ source: "claude" });
  const afterSum = sumEvents(after);

  assert.equal(afterSum.input, before.input);
  assert.equal(afterSum.output, before.output);
  assert.equal(afterSum.cost.toFixed(8), before.cost.toFixed(8));
  // 2 user groups
  assert.equal(after.length, 2);
});

// --- Invariant 6: dryRun does NOT modify files or lose data ---

test("compact: dryRun preserves source files and totals", async () => {
  const eventsDir = path.join(tmpRoot, "events");
  const events = [
    makeEvent({ ts: "2024-01-08T10:00:00Z", input_tokens: 100, output_tokens: 50, cost_usd: 0.001 }),
    makeEvent({ ts: "2024-01-08T11:00:00Z", input_tokens: 200, output_tokens: 75, cost_usd: 0.002 }),
  ];
  await writeLayoutB(eventsDir, "claude", "2024-01-08", events);

  const srcFile = path.join(eventsDir, "claude", "2024-01-08.jsonl");
  const sizeBefore = fs.statSync(srcFile).size;

  const { compactBefore } = require("../src/compact");
  const stats = await compactBefore("2024-01-11", { eventsDir, dryRun: true });

  assert.ok(fs.existsSync(srcFile), "source file untouched");
  assert.equal(fs.statSync(srcFile).size, sizeBefore, "size unchanged");
  assert.equal(stats.files_removed, 0);

  const { read } = require("../src/event-log");
  const after = await read({ source: "claude" });
  const afterSum = sumEvents(after);
  const originalSum = sumEvents(events);
  assert.equal(afterSum.input, originalSum.input);
  assert.equal(afterSum.output, originalSum.output);
});

// --- Invariant 7: cache + reasoning tokens preserved ---

test("compact: cache_read/cache_write/reasoning tokens preserved", async () => {
  const eventsDir = path.join(tmpRoot, "events");
  const events = [
    makeEvent({
      ts: "2024-01-08T10:00:00Z",
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: 500,
      cache_write_tokens: 200,
      reasoning_tokens: 300,
      cost_usd: 0.001,
    }),
    makeEvent({
      ts: "2024-01-08T11:00:00Z",
      input_tokens: 50,
      output_tokens: 25,
      cache_read_tokens: 100,
      cache_write_tokens: 50,
      reasoning_tokens: 80,
      cost_usd: 0.0005,
    }),
  ];
  await writeLayoutB(eventsDir, "claude", "2024-01-08", events);

  const before = sumEvents(events);

  const { compactBefore } = require("../src/compact");
  await compactBefore("2024-01-11", { eventsDir });

  const { read } = require("../src/event-log");
  const after = await read({ source: "claude" });
  const afterSum = sumEvents(after);

  assert.equal(afterSum.cache_read, before.cache_read, "cache_read preserved");
  assert.equal(afterSum.cache_write, before.cache_write, "cache_write preserved");
  assert.equal(afterSum.reasoning, before.reasoning, "reasoning preserved");
});

// --- Invariant 8: re-compact is idempotent on totals ---

test("compact: re-compact preserves totals (idempotent)", async () => {
  const eventsDir = path.join(tmpRoot, "events");
  const events = [
    makeEvent({ ts: "2024-01-08T10:00:00Z", input_tokens: 100, output_tokens: 50, cost_usd: 0.001 }),
    makeEvent({ ts: "2024-01-08T11:00:00Z", input_tokens: 200, output_tokens: 75, cost_usd: 0.002 }),
  ];
  await writeLayoutB(eventsDir, "claude", "2024-01-08", events);

  const before = sumEvents(events);

  const { compactBefore } = require("../src/compact");
  await compactBefore("2024-01-11", { eventsDir });
  await compactBefore("2024-01-11", { eventsDir });
  await compactBefore("2024-01-11", { eventsDir });

  const { read } = require("../src/event-log");
  const after = await read({ source: "claude" });
  const afterSum = sumEvents(after);

  assert.equal(afterSum.input, before.input, "input invariant under re-compact");
  assert.equal(afterSum.output, before.output, "output invariant under re-compact");
  assert.equal(afterSum.cost.toFixed(8), before.cost.toFixed(8), "cost invariant under re-compact");
  assert.equal(after.length, 1, "still 1 aggregate after 3 compactions");
});

// --- Invariant 9: re-compact merges new raw events with existing archive ---

test("compact: new raw events merged into existing archive on re-compact", async () => {
  const eventsDir = path.join(tmpRoot, "events");

  // First batch
  const batch1 = [
    makeEvent({ ts: "2024-01-08T10:00:00Z", input_tokens: 100, output_tokens: 50, cost_usd: 0.001, dedup_key: "b1a" }),
  ];
  await writeLayoutB(eventsDir, "claude", "2024-01-08", batch1);

  const { compactBefore } = require("../src/compact");
  await compactBefore("2024-01-11", { eventsDir });

  // Second batch arrives later for same date (different content)
  const batch2 = [
    makeEvent({ ts: "2024-01-08T15:00:00Z", input_tokens: 300, output_tokens: 120, cost_usd: 0.003, dedup_key: "b2a" }),
  ];
  await writeLayoutB(eventsDir, "claude", "2024-01-08", batch2);

  await compactBefore("2024-01-11", { eventsDir });

  const { read } = require("../src/event-log");
  const after = await read({ source: "claude" });
  const afterSum = sumEvents(after);

  assert.equal(afterSum.input, 400, "both batches summed");
  assert.equal(afterSum.output, 170);
  assert.equal(afterSum.cost.toFixed(8), (0.004).toFixed(8));
  assert.equal(after.length, 1, "merged into single aggregate");
  assert.equal(after[0].compacted_count, 2);
});

// --- Invariant 10: project_id + user_id preserved in aggregates ---

test("compact: project_id and user_id preserved in aggregate events", async () => {
  const eventsDir = path.join(tmpRoot, "events");
  const events = [
    makeEvent({ ts: "2024-01-08T10:00:00Z", user_id: "alice@example.com", project_id: "proj1" }),
    makeEvent({ ts: "2024-01-08T11:00:00Z", user_id: "alice@example.com", project_id: "proj1" }),
    makeEvent({ ts: "2024-01-08T12:00:00Z", user_id: "bob@example.com", project_id: "proj2" }),
  ];
  await writeLayoutB(eventsDir, "claude", "2024-01-08", events);

  const { compactBefore } = require("../src/compact");
  await compactBefore("2024-01-11", { eventsDir });

  const { read } = require("../src/event-log");
  const after = await read({ source: "claude" });

  assert.equal(after.length, 2, "2 distinct (user, project) groups");
  const alice = after.find((e) => e.user_id === "alice@example.com");
  const bob = after.find((e) => e.user_id === "bob@example.com");
  assert.ok(alice, "alice aggregate present");
  assert.ok(bob, "bob aggregate present");
  assert.equal(alice.project_id, "proj1");
  assert.equal(bob.project_id, "proj2");
  assert.equal(alice.compacted_count, 2);
  assert.equal(bob.compacted_count, 1);
});
