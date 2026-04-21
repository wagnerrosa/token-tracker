"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { glob } = require("glob");
const { getEventsDir } = require("./storage-path");
const { createEvent } = require("./types/event");

function eventDate(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function fileDateFromPath(f) {
  const parent = path.basename(path.dirname(f));
  if (/^\d{4}-\d{2}-\d{2}$/.test(parent)) return parent;
  return path.basename(f, ".jsonl");
}

function layoutOfPath(f) {
  const parent = path.basename(path.dirname(f));
  return /^\d{4}-\d{2}-\d{2}$/.test(parent) ? "A" : "B";
}

// List all raw event files older than `before` (exclusive). Excludes _compact/ archive.
async function listFilesBefore(eventsDir, before) {
  const patterns = [
    path.join(eventsDir, "*", "*.jsonl"),
    path.join(eventsDir, "*", "*", "*.jsonl"),
  ];
  const compactPrefix = path.join(eventsDir, "_compact") + path.sep;
  const out = [];
  for (const p of patterns) {
    try {
      const files = await glob(p, { nodir: true });
      for (const f of files) {
        if (f.startsWith(compactPrefix)) continue;
        const date = fileDateFromPath(f);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        if (date < before) out.push(f);
      }
    } catch { /* ignore */ }
  }
  return out;
}

function groupKey(ev) {
  return [
    eventDate(ev.ts),
    ev.source || "",
    ev.model || "",
    ev.user_id || "",
    ev.project_id || "",
  ].join("\x00");
}

function readEventsSync(file) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { return []; }
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip corrupt */ }
  }
  return out;
}

function aggregateGroup(events) {
  const sample = events[0];
  const date = eventDate(sample.ts);
  const agg = {
    ts: `${date}T00:00:00.000Z`,
    source: sample.source,
    model: sample.model,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    reasoning_tokens: 0,
    cost_usd: 0,
    cost_source: "compacted",
    project_id: sample.project_id ?? null,
    project_path: sample.project_path ?? null,
    session_id: null,
    user_id: sample.user_id ?? null,
    user_name: sample.user_name ?? null,
  };
  for (const ev of events) {
    agg.input_tokens += ev.input_tokens || 0;
    agg.output_tokens += ev.output_tokens || 0;
    agg.cache_read_tokens += ev.cache_read_tokens || 0;
    agg.cache_write_tokens += ev.cache_write_tokens || 0;
    agg.reasoning_tokens += ev.reasoning_tokens || 0;
    agg.cost_usd += ev.cost_usd || 0;
    if (!agg.project_path && ev.project_path) agg.project_path = ev.project_path;
    if (!agg.user_name && ev.user_name) agg.user_name = ev.user_name;
  }
  const dedup_key = [
    "compact",
    date,
    agg.source,
    agg.model || "",
    agg.user_id || "",
    agg.project_id || "",
  ].join(":");
  const ev = createEvent({ ...agg, dedup_key });
  ev.compacted = true;
  ev.compacted_count = events.length;
  return ev;
}

function plan(files) {
  const byDateSource = new Map();
  for (const f of files) {
    const date = fileDateFromPath(f);
    const source = path.basename(layoutOfPath(f) === "A" ? path.dirname(path.dirname(f)) : path.dirname(f));
    const key = `${source}/${date}`;
    if (!byDateSource.has(key)) byDateSource.set(key, { source, date, files: [] });
    byDateSource.get(key).files.push(f);
  }
  return byDateSource;
}

async function compactBefore(before, { dryRun = false, eventsDir = getEventsDir() } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) {
    throw new Error(`invalid --before date: ${before} (expected YYYY-MM-DD)`);
  }

  const files = await listFilesBefore(eventsDir, before);
  const stats = {
    files_scanned: files.length,
    events_read: 0,
    groups: 0,
    files_removed: 0,
    bytes_before: 0,
    bytes_after: 0,
    totals: { input_tokens: 0, output_tokens: 0, cost_usd: 0 },
  };

  if (files.length === 0) return stats;

  const plans = plan(files);

  for (const { source, date, files: groupFiles } of plans.values()) {
    const outFile = path.join(eventsDir, "_compact", source, `${date}.jsonl`);

    // Re-compact safe: if archive already has this date, merge its events too.
    const existingArchive = readEventsSync(outFile);

    const events = [...existingArchive];
    for (const f of groupFiles) {
      try { stats.bytes_before += (await fsp.stat(f)).size; } catch { /* ignore */ }
      const evs = readEventsSync(f);
      stats.events_read += evs.length;
      events.push(...evs);
    }

    const groups = new Map();
    for (const ev of events) {
      const k = groupKey(ev);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(ev);
    }

    const aggregated = [];
    for (const group of groups.values()) {
      // Re-aggregating an already-compacted group must preserve compacted_count
      const agg = aggregateGroup(group);
      const preCompactedCount = group
        .filter((e) => e.compacted)
        .reduce((s, e) => s + (e.compacted_count || 1), 0);
      const rawCount = group.filter((e) => !e.compacted).length;
      if (preCompactedCount > 0) agg.compacted_count = preCompactedCount + rawCount;
      aggregated.push(agg);
      stats.totals.input_tokens += agg.input_tokens;
      stats.totals.output_tokens += agg.output_tokens;
      stats.totals.cost_usd += agg.cost_usd;
    }
    stats.groups += aggregated.length;

    if (dryRun) continue;

    // Write compacted archive at {eventsDir}/_compact/{source}/{date}.jsonl (overwrite, idempotent).
    await fsp.mkdir(path.dirname(outFile), { recursive: true });
    const lines = aggregated.map((e) => JSON.stringify(e)).join("\n") + "\n";
    const tmp = `${outFile}.tmp`;
    await fsp.writeFile(tmp, lines);
    await fsp.rename(tmp, outFile);

    // Remove raw source files (archive lives outside scanned tree, never matches).
    for (const f of groupFiles) {
      try {
        await fsp.unlink(f);
        stats.files_removed += 1;
      } catch { /* ignore */ }
    }

    // Clean empty parent dirs (layout A date dirs)
    for (const f of groupFiles) {
      const dir = path.dirname(f);
      try {
        const entries = await fsp.readdir(dir);
        if (entries.length === 0) await fsp.rmdir(dir);
      } catch { /* ignore */ }
    }

    try { stats.bytes_after += (await fsp.stat(outFile)).size; } catch { /* ignore */ }
  }

  return stats;
}

module.exports = { compactBefore, aggregateGroup, groupKey, listFilesBefore };
