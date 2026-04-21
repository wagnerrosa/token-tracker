"use strict";

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { getTTHome, getStorageMode, _resetCache } = require("../src/storage-path");

let origEnv;
let origCwd;

beforeEach(() => {
  origEnv = { TT_HOME: process.env.TT_HOME, TT_STORAGE: process.env.TT_STORAGE };
  origCwd = process.cwd();
  delete process.env.TT_HOME;
  delete process.env.TT_STORAGE;
  _resetCache();
});

afterEach(() => {
  if (origEnv.TT_HOME !== undefined) process.env.TT_HOME = origEnv.TT_HOME;
  else delete process.env.TT_HOME;
  if (origEnv.TT_STORAGE !== undefined) process.env.TT_STORAGE = origEnv.TT_STORAGE;
  else delete process.env.TT_STORAGE;
  process.chdir(origCwd);
  _resetCache();
});

// Table-driven cases
const cases = [
  {
    name: "TT_HOME env → mode=env, home=custom path",
    setup() { process.env.TT_HOME = "/custom/tt"; },
    expectedMode: "env",
    expectedHome: "/custom/tt",
  },
  {
    name: "TT_STORAGE=global → mode=global, home=~/.token-tracker",
    setup() { process.env.TT_STORAGE = "global"; },
    expectedMode: "global",
    expectedHome: path.join(os.homedir(), ".token-tracker"),
  },
  {
    name: "TT_HOME takes precedence over TT_STORAGE=global",
    setup() {
      process.env.TT_HOME = "/explicit/tt";
      process.env.TT_STORAGE = "global";
    },
    expectedMode: "env",
    expectedHome: "/explicit/tt",
  },
];

for (const c of cases) {
  test(c.name, () => {
    c.setup();
    assert.equal(getStorageMode(), c.expectedMode);
    assert.equal(getTTHome(), c.expectedHome);
  });
}

test("inside git repo → mode=repo, home=<gitRoot>/.token-tracker", () => {
  // token-tracker itself is a git repo — cwd already inside one
  process.chdir(path.join(__dirname, ".."));
  const gitRoot = path.join(__dirname, "..");
  assert.equal(getStorageMode(), "repo");
  assert.equal(getTTHome(), path.join(gitRoot, ".token-tracker"));
});

test("outside any git repo → mode=global, home=~/.token-tracker", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-test-"));
  process.chdir(tmpDir);
  assert.equal(getStorageMode(), "global");
  assert.equal(getTTHome(), path.join(os.homedir(), ".token-tracker"));
  fs.rmdirSync(tmpDir);
});

test("cache: resolve() called once, result stable across calls", () => {
  process.env.TT_HOME = "/cached/tt";
  const a = getTTHome();
  process.env.TT_HOME = "/changed/tt"; // change after first call
  const b = getTTHome();
  assert.equal(a, b, "cache must return same result");
});

test("_resetCache() clears cache", () => {
  process.env.TT_HOME = "/first/tt";
  assert.equal(getTTHome(), "/first/tt");
  _resetCache();
  process.env.TT_HOME = "/second/tt";
  assert.equal(getTTHome(), "/second/tt");
});
