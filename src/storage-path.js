"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

let _cache = null;

function findGitRoot(dir) {
  let current = dir;
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolve() {
  if (_cache) return _cache;

  if (process.env.TT_HOME) {
    _cache = { mode: "env", home: process.env.TT_HOME };
    return _cache;
  }

  if (process.env.TT_STORAGE === "global") {
    _cache = { mode: "global", home: path.join(os.homedir(), ".token-tracker") };
    return _cache;
  }

  const gitRoot = findGitRoot(process.cwd());
  if (gitRoot) {
    _cache = { mode: "repo", home: path.join(gitRoot, ".token-tracker") };
    return _cache;
  }

  _cache = { mode: "global", home: path.join(os.homedir(), ".token-tracker") };
  return _cache;
}

function getTTHome() {
  return resolve().home;
}

function getStorageMode() {
  return resolve().mode;
}

function getEventsDir() {
  return path.join(getTTHome(), "events");
}

function getCursorsDir() {
  return path.join(getTTHome(), "cursors");
}

// for testing only
function _resetCache() {
  _cache = null;
}

module.exports = { getTTHome, getStorageMode, getEventsDir, getCursorsDir, _resetCache };
