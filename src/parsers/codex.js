"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");
const { glob } = require("glob");
const { createUsageEntry } = require("../types");
const { toProjectFields } = require("../types/event");

const DATA_DIR = path.join(os.homedir(), ".codex", "sessions");

async function parseFile(filePath, prevTotalsBySession = {}) {
  const entries = [];

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  let currentModel = null;
  let sessionId = null;
  let sessionCwd = null;

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

    if (data.type === "session_meta") {
      if (payload.id) sessionId = payload.id;
      if (payload.cwd) sessionCwd = payload.cwd;
      continue;
    }

    if (data.type === "turn_context") {
      if (payload.model) currentModel = payload.model;
      continue;
    }

    if (data.type !== "event_msg") continue;
    if (payload.type !== "token_count") continue;

    const info = payload.info;
    if (!info) continue;

    const total = info.total_token_usage;
    if (!total) continue;

    const last = info.last_token_usage || null;

    const prev = prevTotalsBySession[sessionId] || {
      input_tokens: 0,
      output_tokens: 0,
      cached_input_tokens: 0,
    };

    let deltaInput, deltaOutput, deltaCached;
    let isReset = false;

    if (last) {
      deltaInput = last.input_tokens || 0;
      deltaOutput = last.output_tokens || 0;
      deltaCached = last.cached_input_tokens || 0;
    } else {
      deltaInput = (total.input_tokens || 0) - prev.input_tokens;
      deltaOutput = (total.output_tokens || 0) - prev.output_tokens;
      deltaCached = (total.cached_input_tokens || 0) - prev.cached_input_tokens;

      if (deltaInput < 0 || deltaOutput < 0 || deltaCached < 0) {
        isReset = true;
        if (process.env.TT_DEBUG) {
          console.error(`[CODEX] Session reset detected: ${sessionId}`);
        }
        deltaInput = total.input_tokens || 0;
        deltaOutput = total.output_tokens || 0;
        deltaCached = total.cached_input_tokens || 0;
      }
    }

    prevTotalsBySession[sessionId] = {
      input_tokens: total.input_tokens || 0,
      output_tokens: total.output_tokens || 0,
      cached_input_tokens: total.cached_input_tokens || 0,
    };

    if (!isReset && deltaInput === 0 && deltaOutput === 0 && deltaCached === 0) continue;

    const nonCachedInput = Math.max(0, deltaInput - deltaCached);

    const dedupKey = sessionId && data.timestamp
      ? `${sessionId}:${data.timestamp}`
      : null;

    const { project_id, project_path } = toProjectFields(sessionCwd);

    const entry = createUsageEntry({
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
    });
    entry.project_id = project_id;
    entry.project_path = project_path;
    entry.session_id = sessionId;
    entries.push(entry);
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

  const withMtime = [];
  for (const f of files) {
    try {
      const stat = fs.statSync(f);
      withMtime.push({ file: f, mtimeMs: stat.mtimeMs });
    } catch {
      continue;
    }
  }

  withMtime.sort((a, b) => a.mtimeMs - b.mtimeMs);

  if (sinceMtimeMs) {
    return withMtime.filter((x) => x.mtimeMs >= sinceMtimeMs).map((x) => x.file);
  }

  return withMtime.map((x) => x.file);
}

async function parseFiles(files, prevTotalsBySession = {}) {
  const seen = new Set();
  const all = [];

  for (const file of files) {
    const entries = await parseFile(file, prevTotalsBySession);
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
  return parseFiles(files, {});
}

async function parseRecent(sinceMtimeMs) {
  const files = await findFiles(sinceMtimeMs);
  return parseFiles(files, {});
}

async function ingest(cursor) {
  const prev = (cursor.source_specific && cursor.source_specific.prev_totals_by_session) || {};
  const files = await findFiles();
  const entries = await parseFiles(files, prev);
  if (!cursor.source_specific) cursor.source_specific = {};
  cursor.source_specific.prev_totals_by_session = prev;
  return entries;
}

module.exports = {
  name: "codex",
  dataDir: () => DATA_DIR,
  filePattern: "**/*.jsonl",
  parseFile,
  parseAll,
  parseRecent,
  ingest,
};
