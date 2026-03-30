"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { glob } = require("glob");
const { createUsageEntry } = require("../types");

const DATA_DIR = path.join(os.homedir(), ".local", "share", "opencode", "storage", "message");

async function parseFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!msg.tokens) return [];

  const tokens = msg.tokens;
  const cacheRead = tokens.cache ? tokens.cache.read || 0 : 0;
  const cacheWrite = tokens.cache ? tokens.cache.write || 0 : 0;

  // timestamp: Unix ms → ISO string
  let timestamp = null;
  if (msg.time && msg.time.created) {
    timestamp = new Date(msg.time.created).toISOString();
  }

  const dedupKey = msg.id || null;

  return [
    createUsageEntry({
      timestamp,
      source: "opencode",
      provider: msg.providerID || null,
      model: msg.modelID || null,
      input_tokens: tokens.input || 0,
      output_tokens: tokens.output || 0,
      cache_read_tokens: cacheRead,
      cache_creation_tokens: cacheWrite,
      thinking_tokens: tokens.reasoning || 0,
      cost_usd: msg.cost ?? null,
      message_id: msg.id || null,
      request_id: msg.sessionID || null,
      project: null,
      dedup_key: dedupKey,
    }),
  ];
}

async function findFiles(sinceMtimeMs) {
  const pattern = path.join(DATA_DIR, "**/msg_*.json");
  let files;
  try {
    files = await glob(pattern, { nodir: true });
  } catch {
    return [];
  }

  if (sinceMtimeMs) {
    const filtered = [];
    for (const f of files) {
      try {
        const stat = fs.statSync(f);
        if (stat.mtimeMs >= sinceMtimeMs) filtered.push(f);
      } catch {
        continue;
      }
    }
    return filtered;
  }

  return files;
}

async function parseFiles(files) {
  const seen = new Set();
  const all = [];

  for (const file of files) {
    const entries = await parseFile(file);
    for (const entry of entries) {
      if (entry.dedup_key) {
        if (seen.has(entry.dedup_key)) continue;
        seen.add(entry.dedup_key);
      }
      all.push(entry);
    }
  }

  return all;
}

async function parseAll() {
  const files = await findFiles();
  return parseFiles(files);
}

async function parseRecent(sinceMtimeMs) {
  const files = await findFiles(sinceMtimeMs);
  return parseFiles(files);
}

module.exports = {
  name: "opencode",
  dataDir: () => DATA_DIR,
  filePattern: "**/msg_*.json",
  parseFile,
  parseAll,
  parseRecent,
};
