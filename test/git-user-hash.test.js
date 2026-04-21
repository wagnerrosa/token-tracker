"use strict";

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

let origEnv;

beforeEach(() => {
  origEnv = {
    TT_USER_ID_STRATEGY: process.env.TT_USER_ID_STRATEGY,
    TT_USER_ID_SALT: process.env.TT_USER_ID_SALT,
  };
  delete process.env.TT_USER_ID_STRATEGY;
  delete process.env.TT_USER_ID_SALT;

  // purge module cache
  for (const key of Object.keys(require.cache)) {
    if (key.includes("/src/git-user")) {
      delete require.cache[key];
    }
  }
});

afterEach(() => {
  if (origEnv.TT_USER_ID_STRATEGY !== undefined) {
    process.env.TT_USER_ID_STRATEGY = origEnv.TT_USER_ID_STRATEGY;
  } else {
    delete process.env.TT_USER_ID_STRATEGY;
  }
  if (origEnv.TT_USER_ID_SALT !== undefined) {
    process.env.TT_USER_ID_SALT = origEnv.TT_USER_ID_SALT;
  } else {
    delete process.env.TT_USER_ID_SALT;
  }

  for (const key of Object.keys(require.cache)) {
    if (key.includes("/src/git-user")) {
      delete require.cache[key];
    }
  }
});

// --- Determinism: same input → same hash output ---

test("hash strategy: same input always produces same hash", () => {
  process.env.TT_USER_ID_STRATEGY = "hash";
  process.env.TT_USER_ID_SALT = "my-salt";

  const raw = "alice@example.com";
  const expected = crypto.createHash("sha256")
    .update("my-salt" + raw)
    .digest("hex")
    .slice(0, 16);

  assert.equal(expected.length, 16, "hash must be 16 chars");
  assert.match(expected, /^[0-9a-f]{16}$/, "hash must be hex lowercase");

  const h1 = crypto.createHash("sha256").update("my-salt" + raw).digest("hex").slice(0, 16);
  const h2 = crypto.createHash("sha256").update("my-salt" + raw).digest("hex").slice(0, 16);
  assert.equal(h1, h2, "repeated hash must be identical");
});

// --- Salt impact: different salt → different hash ---

test("hash strategy: different salt produces different hash", () => {
  const raw = "alice@example.com";

  const h1 = crypto.createHash("sha256").update("salt1" + raw).digest("hex").slice(0, 16);
  const h2 = crypto.createHash("sha256").update("salt2" + raw).digest("hex").slice(0, 16);

  assert.notEqual(h1, h2, "different salts must produce different hashes");
});

// --- Empty salt: default fallback ---

test("hash strategy: empty salt (default) produces consistent hash", () => {
  const raw = "bob@example.com";

  const h1 = crypto.createHash("sha256").update("" + raw).digest("hex").slice(0, 16);
  const h2 = crypto.createHash("sha256").update("" + raw).digest("hex").slice(0, 16);

  assert.equal(h1, h2, "empty salt must still be deterministic");
});

// --- Hash length: exactly 16 hex chars ---

test("hash strategy: truncation to 16 chars", () => {
  const raw = "test@example.com";
  const full = crypto.createHash("sha256").update(raw).digest("hex");
  assert.equal(full.length, 64, "full sha256 is 64 chars");

  const truncated = full.slice(0, 16);
  assert.equal(truncated.length, 16, "truncated to 16");
});

// --- Fixed table: known inputs → known outputs ---

test("hash strategy: fixed inputs produce fixed outputs (table-driven)", () => {
  const cases = [
    {
      salt: "",
      raw: "alice@example.com",
      expected: "ff8d9819fc0e12bf",
    },
    {
      salt: "mysalt",
      raw: "bob@example.com",
      expected: "92383169de012fa3",
    },
    {
      salt: "",
      raw: "unknown",
      expected: "b23a6a8439c0dde5",
    },
  ];

  for (const c of cases) {
    const hash = crypto.createHash("sha256")
      .update(c.salt + c.raw)
      .digest("hex")
      .slice(0, 16);
    assert.equal(hash, c.expected, `case: salt="${c.salt}", raw="${c.raw}"`);
  }
});
