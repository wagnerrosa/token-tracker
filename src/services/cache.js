"use strict";

const fs = require("fs");
const path = require("path");
const { CACHE_VERSION, CACHE_DIR } = require("../types");
const aggregator = require("./aggregator");

function cachePath(source) {
  return path.join(CACHE_DIR, `${source}_daily.json`);
}

function loadCache(source) {
  const p = cachePath(source);
  if (!fs.existsSync(p)) return null;

  try {
    const raw = fs.readFileSync(p, "utf8");
    const cache = JSON.parse(raw);
    if (cache.version !== CACHE_VERSION) return null;
    return cache;
  } catch {
    return null;
  }
}

function saveCache(source, summaries, lastFileMtime) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const cache = {
    version: CACHE_VERSION,
    source,
    updated_at: new Date().toISOString(),
    last_file_mtime: lastFileMtime || Date.now(),
    summaries,
  };

  fs.writeFileSync(cachePath(source), JSON.stringify(cache, null, 2));
  return cache;
}

async function getMaxMtime(parser) {
  const { glob } = require("glob");
  const pattern = path.join(parser.dataDir(), parser.filePattern);
  let files;
  try {
    files = await glob(pattern, { nodir: true });
  } catch {
    return 0;
  }

  let max = 0;
  for (const f of files) {
    try {
      const stat = fs.statSync(f);
      if (stat.mtimeMs > max) max = stat.mtimeMs;
    } catch {
      continue;
    }
  }
  return max;
}

/**
 * Load data for a parser using cache-first strategy.
 *
 * Warm path: keep cached past days, recompute today from full parse.
 * Cold path: full parse, aggregate, save cache.
 */
async function loadForParser(parser) {
  const cache = loadCache(parser.name);
  const today = aggregator.localDate(new Date().toISOString());

  if (cache) {
    // Warm path: check if any files changed
    const recentEntries = await parser.parseRecent(cache.last_file_mtime);

    if (recentEntries.length === 0) {
      // No changes at all — return cached as-is
      return cache.summaries;
    }

    // Files changed. Keep cached past days (not today).
    const pastCached = cache.summaries.filter((s) => s.date !== today);

    // For today: do a full parse to get all today's entries accurately
    const allEntries = await parser.parseAll();
    const todayEntries = allEntries.filter(
      (e) => aggregator.localDate(e.timestamp) === today
    );
    const todaySummaries = aggregator.daily(todayEntries);

    // For past dates that appear in recent files (not today): recompute from recent
    const recentPast = recentEntries.filter(
      (e) => aggregator.localDate(e.timestamp) !== today
    );
    const freshPastSummaries = aggregator.daily(recentPast);

    // Merge: past cached (minus dates in freshPast) + freshPast + today
    const freshPastDates = new Set(freshPastSummaries.map((s) => s.date));
    const keptPast = pastCached.filter((s) => !freshPastDates.has(s.date));

    const merged = aggregator.mergeSummaries(
      [...keptPast, ...freshPastSummaries],
      todaySummaries
    );

    const maxMtime = await getMaxMtime(parser);
    saveCache(parser.name, merged, maxMtime);
    return merged;
  }

  // Cold path: full parse
  const entries = await parser.parseAll();
  const summaries = aggregator.daily(entries);
  const maxMtime = await getMaxMtime(parser);
  saveCache(parser.name, summaries, maxMtime);
  return summaries;
}

module.exports = { loadForParser, loadCache, saveCache, cachePath };
