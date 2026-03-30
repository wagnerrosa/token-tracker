"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { glob } = require("glob");
const { createUsageEntry } = require("../types");

const DATA_DIR = path.join(os.homedir(), ".gemini", "tmp");

async function parseFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  let session;
  try {
    session = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(session.messages)) return [];

  const sessionModel = session.model || null;
  const sessionId = session.sessionId || null;
  const entries = [];

  for (const msg of session.messages) {
    if (msg.type !== "gemini") continue;
    if (!msg.tokens) continue;

    const tokens = msg.tokens;
    const model = msg.model || sessionModel;

    entries.push(
      createUsageEntry({
        timestamp: msg.timestamp || null,
        source: "gemini",
        provider: "google",
        model,
        input_tokens: tokens.input || 0,
        output_tokens: tokens.output || 0,
        cache_read_tokens: tokens.cached || 0,
        cache_creation_tokens: 0,
        thinking_tokens: tokens.thoughts || 0,
        cost_usd: null,
        message_id: msg.id || null,
        request_id: sessionId,
        project: null,
        dedup_key: msg.id ? `${sessionId}:${msg.id}` : null,
      })
    );
  }

  return entries;
}

async function findFiles(sinceMtimeMs) {
  const pattern = path.join(DATA_DIR, "*/chats/session-*.json");
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
  name: "gemini",
  dataDir: () => DATA_DIR,
  filePattern: "*/chats/session-*.json",
  parseFile,
  parseAll,
  parseRecent,
};
