"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { byUser, aggregate } = require("../src/aggregate");

function mkEv(overrides) {
  return {
    id: Math.random().toString(36).slice(2),
    ts: overrides.ts || "2024-01-15T10:00:00.000Z",
    source: "claude",
    model: "claude-3-5-sonnet",
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cost_usd: 0,
    cost_source: "computed",
    ...overrides,
  };
}

const events = [
  mkEv({ user_id: "alice@x.com", input_tokens: 100, output_tokens: 50,  cost_usd: 1.00 }),
  mkEv({ user_id: "alice@x.com", input_tokens: 200, output_tokens: 100, cost_usd: 2.50 }),
  mkEv({ user_id: "bob@x.com",   input_tokens: 300, output_tokens: 150, cost_usd: 3.00 }),
  mkEv({ user_id: "bob@x.com",   input_tokens: 50,  output_tokens: 25,  cost_usd: 0.50 }),
  mkEv({ user_id: null,          input_tokens: 80,  output_tokens: 40,  cost_usd: 0.80 }),
];

test("byUser: sum of user costs == total period cost", () => {
  const users = byUser(events);
  const userTotal = users.reduce((s, u) => s + u.total_cost_usd, 0);
  const periodTotal = events.reduce((s, e) => s + e.cost_usd, 0);
  assert.ok(
    Math.abs(userTotal - periodTotal) < 1e-9,
    `user sum ${userTotal} != period total ${periodTotal}`
  );
});

test("byUser: sum of user input_tokens == total input_tokens", () => {
  const users = byUser(events);
  const userIn = users.reduce((s, u) => s + u.total_input_tokens, 0);
  const totalIn = events.reduce((s, e) => s + e.input_tokens, 0);
  assert.equal(userIn, totalIn);
});

test("byUser: sum of user output_tokens == total output_tokens", () => {
  const users = byUser(events);
  const userOut = users.reduce((s, u) => s + u.total_output_tokens, 0);
  const totalOut = events.reduce((s, e) => s + e.output_tokens, 0);
  assert.equal(userOut, totalOut);
});

test("byUser: count per user == events per user", () => {
  const users = byUser(events);
  const alice = users.find((u) => u.user_id === "alice@x.com");
  const bob   = users.find((u) => u.user_id === "bob@x.com");
  const unk   = users.find((u) => u.user_id === null);
  assert.equal(alice.count, 2);
  assert.equal(bob.count, 2);
  assert.equal(unk.count, 1);
});

test("byUser with since/until: sum still == filtered total", () => {
  const since = "2024-01-15T00:00:00Z";
  const until = "2024-01-15T23:59:59Z";
  const filtered = events.filter((e) => e.ts >= since && e.ts <= until);
  const users = byUser(events, { since, until });
  const userTotal = users.reduce((s, u) => s + u.total_cost_usd, 0);
  const filteredTotal = filtered.reduce((s, e) => s + e.cost_usd, 0);
  assert.ok(Math.abs(userTotal - filteredTotal) < 1e-9);
});

test("byUser + aggregate: both sum to same total cost", () => {
  const users = byUser(events);
  const periods = aggregate(events, { granularity: "daily" });
  const userTotal = users.reduce((s, u) => s + u.total_cost_usd, 0);
  const periodTotal = periods.reduce((s, p) => s + p.total_cost_usd, 0);
  assert.ok(Math.abs(userTotal - periodTotal) < 1e-9);
});

test("byUser: null user_id groups under 'unknown' key, user_id field stays null", () => {
  const users = byUser(events);
  const unk = users.find((u) => u.user_id === null);
  assert.ok(unk, "unknown user bucket must exist");
  assert.equal(unk.total_cost_usd, 0.80);
});

test("byUser: sorted by total_cost_usd desc", () => {
  const users = byUser(events);
  for (let i = 1; i < users.length; i++) {
    assert.ok(users[i - 1].total_cost_usd >= users[i].total_cost_usd);
  }
});
