"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");
const { glob } = require("glob");
const { createUsageEntry } = require("../types");

const DATA_DIR = path.join(os.homedir(), ".codex", "sessions");

async function parseFile(filePath) {
  const entries = [];

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  let currentModel = null;
  let sessionId = null;
  let prevTotals = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 };

  for await (const line of rl) {
    if (!line.trim()) continue;

    let data;
    try {
      data = JSON.parse(line);
    } catch {
      continue;
    }

    const payload = data.payload;
    if (!payload) continue;

    // session_meta → capture session_id
    if (data.type === "session_meta") {
      if (payload.id) sessionId = payload.id;
      continue;
    }

    // turn_context → capture model
    if (data.type === "turn_context") {
      if (payload.model) currentModel = payload.model;
      continue;
    }

    // event_msg with type "token_count" → compute delta
    if (data.type !== "event_msg") continue;
    if (payload.type !== "token_count") continue;

    const info = payload.info;
    if (!info) continue;

    const total = info.total_token_usage;
    if (!total) continue;

    const last = info.last_token_usage || null;

    let deltaInput, deltaOutput, deltaCached;

    if (last) {
      deltaInput = last.input_tokens || 0;
      deltaOutput = last.output_tokens || 0;
      deltaCached = last.cached_input_tokens || 0;
    } else {
      deltaInput = Math.max(0, (total.input_tokens || 0) - prevTotals.input_tokens);
      deltaOutput = Math.max(0, (total.output_tokens || 0) - prevTotals.output_tokens);
      deltaCached = Math.max(0, (total.cached_input_tokens || 0) - prevTotals.cached_input_tokens);
    }

    prevTotals = {
      input_tokens: total.input_tokens || 0,
      output_tokens: total.output_tokens || 0,
      cached_input_tokens: total.cached_input_tokens || 0,
    };

    // Skip zero-delta events
    if (deltaInput === 0 && deltaOutput === 0 && deltaCached === 0) continue;

    // Normalize: input_tokens = non-cached only
    const nonCachedInput = Math.max(0, deltaInput - deltaCached);

    const dedupKey = sessionId && data.timestamp
      ? `${sessionId}:${data.timestamp}`
      : null;

    entries.push(
      createUsageEntry({
        timestamp: data.timestamp || null,
        source: "codex",
        provider: "openai",
        model: currentModel,
        input_tokens: nonCachedInput,
        output_tokens: deltaOutput,
        cache_read_tokens: deltaCached,
        cache_creation_tokens: 0,
        thinking_tokens: 0,
        cost_usd: null,
        message_id: sessionId,
        request_id: null,
        project: null,
        dedup_key: dedupKey,
      })
    );
  }

  return entries;
}

async function findFiles(sinceMtimeMs) {
  const pattern = path.join(DATA_DIR, "**", "*.jsonl");
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
  name: "codex",
  dataDir: () => DATA_DIR,
  filePattern: "**/*.jsonl",
  parseFile,
  parseAll,
  parseRecent,
};
