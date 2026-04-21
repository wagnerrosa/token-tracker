"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { glob } = require("glob");
const { getEventsDir, getCursorsDir } = require("./storage-path");

function eventDate(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function eventFile(source, date) {
  return path.join(getEventsDir(), source, `${date}.jsonl`);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function append(events) {
  if (!events || events.length === 0) return;

  const groups = new Map();
  for (const ev of events) {
    const date = eventDate(ev.ts);
    const key = `${ev.source}/${date}`;
    if (!groups.has(key)) groups.set(key, { source: ev.source, date, lines: [] });
    groups.get(key).lines.push(JSON.stringify(ev));
  }

  for (const { source, date, lines } of groups.values()) {
    const file = eventFile(source, date);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.appendFile(file, lines.join("\n") + "\n");
  }
}

async function read({ source, since, until, project } = {}) {
  const sources = source ? [source] : await listSources();
  const results = [];

  for (const src of sources) {
    const pattern = path.join(getEventsDir(), src, "*.jsonl");
    let files;
    try {
      files = await glob(pattern, { nodir: true });
    } catch {
      continue;
    }

    for (const f of files) {
      const date = path.basename(f, ".jsonl");
      if (since && date < eventDate(since)) continue;
      if (until && date > eventDate(until)) continue;

      let raw;
      try {
        raw = await fsp.readFile(f, "utf8");
      } catch {
        continue;
      }

      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          if (process.env.TT_DEBUG) {
            console.error(`[event-log] skipping invalid line in ${f}`);
          }
          continue;
        }
        if (since && ev.ts < since) continue;
        if (until && ev.ts > until) continue;
        if (project && ev.project_id !== project) continue;
        results.push(ev);
      }
    }
  }

  return results;
}

async function listSources() {
  try {
    const entries = await fsp.readdir(getEventsDir(), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

function cursorPath(source, userId) {
  if (userId) {
    return path.join(getCursorsDir(), source, `${userId}.json`);
  }
  // legacy path for backward compat
  return path.join(getCursorsDir(), `${source}.json`);
}

async function loadCursor(source, userId) {
  const p = cursorPath(source, userId);
  try {
    const raw = await fsp.readFile(p, "utf8");
    const cursor = JSON.parse(raw);
    if (cursor.last_run_date !== todayISO()) {
      cursor.seen_keys_today = [];
      cursor.last_run_date = todayISO();
    }
    return cursor;
  } catch {
    return {
      version: 1,
      seen_keys_today: [],
      last_run_date: todayISO(),
      source_specific: {},
    };
  }
}

async function saveCursor(source, cursor, userId) {
  const p = cursorPath(source, userId);
  await fsp.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(cursor, null, 2));
  await fsp.rename(tmp, p);
}

async function recoverSeenKeys(source) {
  const file = eventFile(source, todayISO());
  const keys = new Set();
  let raw;
  try {
    raw = await fsp.readFile(file, "utf8");
  } catch {
    return keys;
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.dedup_key) keys.add(ev.dedup_key);
    } catch {
      continue;
    }
  }
  return keys;
}

async function enrichCosts(events) {
  const { computeCost } = require("./services/pricing");
  for (const ev of events) {
    if (ev.cost_usd != null) continue;
    const { cost_usd, cost_source } = await computeCost(ev.model, {
      input_tokens: ev.input_tokens,
      output_tokens: ev.output_tokens,
      cache_read_tokens: ev.cache_read_tokens,
      cache_write_tokens: ev.cache_write_tokens,
    });
    ev.cost_usd = cost_usd;
    ev.cost_source = cost_source;
  }
  return events;
}

async function ingestAll() {
  const { getAll } = require("./parsers");
  const { entryToEvent } = require("./types/event");
  const { computeCost } = require("./services/pricing");
  const { getUserId, getUserName } = require("./git-user");

  const user_id = getUserId();
  const user_name = getUserName();

  for (const parser of getAll()) {
    const cursor = await loadCursor(parser.name, user_id);
    let seen = new Set(cursor.seen_keys_today);
    if (seen.size === 0) {
      const recovered = await recoverSeenKeys(parser.name);
      if (recovered.size > 0) seen = recovered;
    }

    let entries;
    if (typeof parser.ingest === "function") {
      entries = await parser.ingest(cursor);
    } else {
      entries = await parser.parseAll();
    }

    const newEvents = [];
    for (const entry of entries) {
      if (entry.cost_usd == null) {
        const { cost_usd, cost_source } = await computeCost(entry.model, {
          input_tokens: entry.input_tokens,
          output_tokens: entry.output_tokens,
          cache_read_tokens: entry.cache_read_tokens,
          cache_write_tokens: entry.cache_creation_tokens,
        });
        entry.cost_usd = cost_usd;
        entry._cost_source = cost_source;
      }
      if (entry.user_id == null) entry.user_id = user_id;
      if (entry.user_name == null) entry.user_name = user_name;
      const ev = entryToEvent(entry, { source: parser.name });
      if (entry._cost_source) ev.cost_source = entry._cost_source;
      if (!ev.dedup_key) continue;
      if (seen.has(ev.dedup_key)) continue;
      seen.add(ev.dedup_key);
      newEvents.push(ev);
    }

    if (newEvents.length > 0) {
      try {
        await append(newEvents);
      } catch (err) {
        if (process.env.TT_DEBUG) console.error(`[event-log] append failed:`, err);
        continue;
      }
    }

    cursor.seen_keys_today = [...seen];
    try {
      await saveCursor(parser.name, cursor, user_id);
    } catch (err) {
      if (process.env.TT_DEBUG) console.error(`[event-log] cursor save failed:`, err);
    }
  }
}

module.exports = {
  append,
  read,
  loadCursor,
  saveCursor,
  recoverSeenKeys,
  ingestAll,
  enrichCosts,
  get EVENTS_DIR() { return getEventsDir(); },
  get CURSORS_DIR() { return getCursorsDir(); },
};
