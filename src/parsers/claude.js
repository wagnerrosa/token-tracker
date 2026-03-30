"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");
const { glob } = require("glob");
const { createUsageEntry } = require("../types");

const DATA_DIR = path.join(os.homedir(), ".claude", "projects");

async function parseFile(filePath) {
  const entries = [];
  const seen = new Set();

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  // Derive project from the hash directory component:
  // ~/.claude/projects/{hash}/something.jsonl → hash
  const relative = path.relative(DATA_DIR, filePath);
  const project = relative.split(path.sep)[0] || null;

  for await (const line of rl) {
    if (!line.trim()) continue;

    let data;
    try {
      data = JSON.parse(line);
    } catch {
      continue; // skip invalid JSON
    }

    const msg = data.message;
    if (!msg || !msg.usage) continue; // skip lines without usage
    if (msg.model === "<synthetic>") continue; // skip synthetic

    const usage = msg.usage;
    const messageId = msg.id || null;
    const requestId = data.requestId || null;

    const dedupKey =
      messageId && requestId
        ? `${messageId}:${requestId}`
        : messageId
          ? messageId
          : null;

    if (dedupKey && seen.has(dedupKey)) continue;
    if (dedupKey) seen.add(dedupKey);

    entries.push(
      createUsageEntry({
        timestamp: data.timestamp || null,
        source: "claude",
        provider: "anthropic",
        model: msg.model || null,
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        cache_read_tokens: usage.cache_read_input_tokens || 0,
        cache_creation_tokens: usage.cache_creation_input_tokens || 0,
        thinking_tokens: 0,
        cost_usd: data.costUSD ?? null,
        message_id: messageId,
        request_id: requestId,
        project,
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
  name: "claude",
  dataDir: () => DATA_DIR,
  filePattern: "**/*.jsonl",
  parseFile,
  parseAll,
  parseRecent,
};
