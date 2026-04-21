"use strict";

const { execFileSync } = require("child_process");

let _cache = null;

function runGit(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function resolve() {
  if (_cache) return _cache;

  const strategy = process.env.TT_USER_ID_STRATEGY || "email";

  let user_id = null;
  let user_name = null;

  const email = runGit(["config", "user.email"]);
  const name = runGit(["config", "user.name"]);

  user_name = name || null;

  if (strategy === "email") {
    user_id = email || name || "unknown";
  } else if (strategy === "name") {
    user_id = name || email || "unknown";
  } else if (strategy === "hash") {
    const crypto = require("crypto");
    const raw = email || name || "unknown";
    const salt = process.env.TT_USER_ID_SALT || "";
    user_id = crypto.createHash("sha256").update(salt + raw).digest("hex").slice(0, 16);
  } else {
    user_id = email || name || "unknown";
  }

  _cache = { user_id, user_name };
  return _cache;
}

function getUserId() {
  return resolve().user_id;
}

function getUserName() {
  return resolve().user_name;
}

// for testing only
function _resetCache() {
  _cache = null;
}

module.exports = { getUserId, getUserName, _resetCache };
