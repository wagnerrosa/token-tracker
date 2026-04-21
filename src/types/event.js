"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const REQUIRED = ["ts", "source"];

function createEvent(data = {}) {
  for (const key of REQUIRED) {
    if (!data[key]) {
      if (process.env.NODE_ENV !== "production") {
        throw new Error(`createEvent: missing required field ${key}`);
      }
    }
  }

  const tsMs = Date.parse(data.ts);
  const idPrefix = Number.isFinite(tsMs)
    ? tsMs.toString(36)
    : Date.now().toString(36);
  const id =
    data.id || `${idPrefix}-${crypto.randomBytes(4).toString("hex")}`;

  return {
    id,
    ts: data.ts,
    source: data.source,
    model: data.model || null,
    input_tokens: data.input_tokens || 0,
    output_tokens: data.output_tokens || 0,
    cache_read_tokens: data.cache_read_tokens || 0,
    cache_write_tokens: data.cache_write_tokens || 0,
    reasoning_tokens: data.reasoning_tokens || 0,
    cost_usd: data.cost_usd ?? null,
    cost_source: data.cost_source ?? null,
    project_id: data.project_id ?? null,
    project_path: data.project_path ?? null,
    session_id: data.session_id ?? null,
    user_id: data.user_id ?? null,
    user_name: data.user_name ?? null,
    dedup_key: data.dedup_key || null,
  };
}

function entryToEvent(entry, { source } = {}) {
  const src = source || entry.source;
  const ts = entry.timestamp || new Date().toISOString();

  let cost_source = null;
  if (entry.cost_usd != null) {
    cost_source = src === "claude" && entry.cost_usd > 0 ? "native" : "computed";
  }

  const userId = entry.user_id ?? null;
  const baseKey = entry.dedup_key ||
    `${ts}:${src}:${entry.model || ""}:${entry.input_tokens || 0}:${entry.output_tokens || 0}`;
  // include user_id in dedup_key only when present — preserves legacy key for old events
  const dedup_key = userId ? `${baseKey}:${userId}` : baseKey;

  return createEvent({
    ts,
    source: src,
    model: entry.model,
    input_tokens: entry.input_tokens,
    output_tokens: entry.output_tokens,
    cache_read_tokens: entry.cache_read_tokens,
    cache_write_tokens: entry.cache_creation_tokens,
    reasoning_tokens: entry.thinking_tokens,
    cost_usd: entry.cost_usd,
    cost_source,
    project_id: entry.project_id ?? null,
    project_path: entry.project_path ?? null,
    session_id: entry.session_id || null,
    user_id: userId,
    user_name: entry.user_name ?? null,
    dedup_key,
  });
}

function toProjectFields(rawPath) {
  if (!rawPath) return { project_id: null, project_path: null };
  let realPath;
  try {
    realPath = fs.realpathSync(rawPath);
  } catch {
    realPath = rawPath;
  }
  const slug = path.basename(realPath).replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
  return { project_id: slug || null, project_path: realPath };
}

module.exports = { createEvent, entryToEvent, toProjectFields };
