"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { entryToEvent } = require("../src/types/event");

const BASE = {
  timestamp: "2024-01-15T10:00:00.000Z",
  source: "claude",
  model: "claude-3-5-sonnet",
  input_tokens: 100,
  output_tokens: 50,
};

// Table: [description, entry, expectedKeySuffix, expectUserIdInKey]
const cases = [
  {
    name: "no user_id → legacy key (ts:src:model:in:out)",
    entry: { ...BASE },
    check(event) {
      const expected = `${BASE.timestamp}:claude:claude-3-5-sonnet:100:50`;
      assert.equal(event.dedup_key, expected);
      assert.equal(event.user_id, null);
    },
  },
  {
    name: "with user_id → key appends :user_id",
    entry: { ...BASE, user_id: "alice@example.com" },
    check(event) {
      const expected = `${BASE.timestamp}:claude:claude-3-5-sonnet:100:50:alice@example.com`;
      assert.equal(event.dedup_key, expected);
      assert.equal(event.user_id, "alice@example.com");
    },
  },
  {
    name: "explicit dedup_key without user_id → preserved as-is",
    entry: { ...BASE, dedup_key: "custom-key-abc" },
    check(event) {
      assert.equal(event.dedup_key, "custom-key-abc");
    },
  },
  {
    name: "explicit dedup_key with user_id → appends user_id",
    entry: { ...BASE, dedup_key: "custom-key-abc", user_id: "bob@example.com" },
    check(event) {
      assert.equal(event.dedup_key, "custom-key-abc:bob@example.com");
    },
  },
  {
    name: "same entry different user_id → different dedup_key",
    entry: null, // handled inline
    check: null,
  },
  {
    name: "zero tokens no model → key uses empty string for model, zeros for tokens",
    entry: { timestamp: BASE.timestamp, source: "gemini" },
    check(event) {
      const expected = `${BASE.timestamp}:gemini::0:0`;
      assert.equal(event.dedup_key, expected);
    },
  },
  {
    name: "legacy event (no user_id) key == new event key without user_id",
    entry: { ...BASE },
    check(event) {
      const eventWithUser = entryToEvent({ ...BASE, user_id: "x@y.com" });
      assert.notEqual(event.dedup_key, eventWithUser.dedup_key);
      assert.ok(eventWithUser.dedup_key.endsWith(":x@y.com"));
    },
  },
];

for (const c of cases) {
  if (c.check === null) continue; // inline test below
  test(c.name, () => {
    const event = entryToEvent(c.entry);
    c.check(event);
  });
}

test("same entry different user_id → different dedup_key (collision prevention)", () => {
  const alice = entryToEvent({ ...BASE, user_id: "alice@example.com" });
  const bob = entryToEvent({ ...BASE, user_id: "bob@example.com" });
  assert.notEqual(alice.dedup_key, bob.dedup_key);
  assert.ok(alice.dedup_key.endsWith(":alice@example.com"));
  assert.ok(bob.dedup_key.endsWith(":bob@example.com"));
});
