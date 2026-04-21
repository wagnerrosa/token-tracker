"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { glob } = require("glob");
const { getEventsDir, getCursorsDir, getGlobalHome, getRepoRoot } = require("./storage-path");

function eventDate(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function encodeUserId(userId) {
  if (!userId) return "_nouser";
  return encodeURIComponent(userId);
}

function useLayoutB() {
  return process.env.TT_EVENT_LAYOUT === "B";
}

function layoutAFile(eventsDir, source, date, userId) {
  return path.join(eventsDir, source, date, `${encodeUserId(userId)}.jsonl`);
}

function layoutBFile(eventsDir, source, date) {
  return path.join(eventsDir, source, `${date}.jsonl`);
}

async function appendToDir(events, eventsDir) {
  if (!events || events.length === 0) return;

  const layoutB = useLayoutB();
  const groups = new Map();
  for (const ev of events) {
    const date = eventDate(ev.ts);
    const key = layoutB
      ? `${ev.source}/${date}`
      : `${ev.source}/${date}/${encodeUserId(ev.user_id)}`;
    if (!groups.has(key)) {
      const file = layoutB
        ? layoutBFile(eventsDir, ev.source, date)
        : layoutAFile(eventsDir, ev.source, date, ev.user_id);
      groups.set(key, { file, lines: [] });
    }
    groups.get(key).lines.push(JSON.stringify(ev));
  }

  for (const { file, lines } of groups.values()) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.appendFile(file, lines.join("\n") + "\n");
  }
}

async function append(events) {
  return appendToDir(events, getEventsDir());
}

function fileDateFromPath(f) {
  // Layout A: .../{source}/{date}/{user}.jsonl → parent dir = date
  // Layout B: .../{source}/{date}.jsonl        → basename without ext = date
  const parent = path.basename(path.dirname(f));
  if (/^\d{4}-\d{2}-\d{2}$/.test(parent)) return parent;
  return path.basename(f, ".jsonl");
}

async function collectEventFiles(eventsDir, source) {
  // Dual-layout scan: B (flat date.jsonl) + A (date/user.jsonl) + compacted archive.
  const patternB = path.join(eventsDir, source, "*.jsonl");
  const patternA = path.join(eventsDir, source, "*", "*.jsonl");
  const patternCompact = path.join(eventsDir, "_compact", source, "*.jsonl");
  const out = [];
  for (const p of [patternB, patternA, patternCompact]) {
    try {
      const f = await glob(p, { nodir: true });
      out.push(...f);
    } catch { /* ignore */ }
  }
  return out;
}

async function read({ source, since, until, project } = {}) {
  const sources = source ? [source] : await listSources();
  const results = [];

  for (const src of sources) {
    const files = await collectEventFiles(getEventsDir(), src);

    for (const f of files) {
      const date = fileDateFromPath(f);
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
    const sources = new Set(
      entries
        .filter((e) => e.isDirectory() && e.name !== "_compact")
        .map((e) => e.name),
    );
    // Also include sources that only exist in _compact/ archive
    try {
      const compactEntries = await fsp.readdir(
        path.join(getEventsDir(), "_compact"),
        { withFileTypes: true },
      );
      for (const e of compactEntries) {
        if (e.isDirectory()) sources.add(e.name);
      }
    } catch { /* no compact dir */ }
    return [...sources];
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
  const today = todayISO();
  const keys = new Set();
  const candidates = [
    layoutBFile(getEventsDir(), source, today),
  ];
  // Layout A: scan all user files for today's date
  try {
    const dir = path.join(getEventsDir(), source, today);
    const entries = await fsp.readdir(dir);
    for (const e of entries) {
      if (e.endsWith(".jsonl")) candidates.push(path.join(dir, e));
    }
  } catch { /* no layout A for today */ }

  for (const file of candidates) {
    let raw;
    try {
      raw = await fsp.readFile(file, "utf8");
    } catch {
      continue;
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

function resolveRepoRootReal() {
  const raw = getRepoRoot();
  if (!raw) return null;
  try {
    return fs.realpathSync(raw);
  } catch {
    return raw;
  }
}

function belongsToRepo(projectPath, repoRootReal) {
  if (!projectPath) return false;
  if (projectPath === repoRootReal) return true;
  return projectPath.startsWith(repoRootReal + path.sep);
}

async function ingestAll() {
  const { getAll } = require("./parsers");
  const { entryToEvent } = require("./types/event");
  const { computeCost } = require("./services/pricing");
  const { getUserId, getUserName } = require("./git-user");

  const user_id = getUserId();
  const user_name = getUserName();

  const repoRoot = resolveRepoRootReal();
  const repoMode = repoRoot !== null;
  const globalEventsDir = path.join(getGlobalHome(), "events");

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

    const repoEvents = [];
    const globalEvents = [];

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

      if (repoMode) {
        if (belongsToRepo(ev.project_path, repoRoot)) {
          repoEvents.push(ev);
        } else {
          // event outside current repo — double-write to global storage
          globalEvents.push(ev);
        }
      } else {
        repoEvents.push(ev);
      }
    }

    if (repoEvents.length > 0) {
      try {
        await append(repoEvents);
      } catch (err) {
        if (process.env.TT_DEBUG) console.error(`[event-log] append failed:`, err);
        continue;
      }
    }

    if (globalEvents.length > 0) {
      try {
        await appendToDir(globalEvents, globalEventsDir);
      } catch (err) {
        if (process.env.TT_DEBUG) console.error(`[event-log] global append failed:`, err);
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
  appendToDir,
  read,
  loadCursor,
  saveCursor,
  recoverSeenKeys,
  ingestAll,
  enrichCosts,
  belongsToRepo,
  encodeUserId,
  get EVENTS_DIR() { return getEventsDir(); },
  get CURSORS_DIR() { return getCursorsDir(); },
};
