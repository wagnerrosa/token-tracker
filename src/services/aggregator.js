"use strict";

const { createDailySummary } = require("../types");

/**
 * Get local date string "YYYY-MM-DD" from an ISO timestamp.
 */
function localDate(timestamp) {
  if (!timestamp) return "unknown";
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Aggregate UsageEntry[] into DailySummary[] grouped by local date.
 */
function daily(entries) {
  const map = new Map();

  for (const e of entries) {
    const date = localDate(e.timestamp);
    let s = map.get(date);
    if (!s) {
      s = createDailySummary({ date, source: e.source });
      map.set(date, s);
    }

    s.total_input_tokens += e.input_tokens || 0;
    s.total_output_tokens += e.output_tokens || 0;
    s.cache_read_tokens += e.cache_read_tokens || 0;
    s.cache_creation_tokens += e.cache_creation_tokens || 0;
    s.thinking_tokens += e.thinking_tokens || 0;
    s.total_cost_usd += e.cost_usd || 0;

    const model = e.model || "unknown";
    if (!s.models[model]) {
      s.models[model] = {
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        count: 0,
      };
    }
    const m = s.models[model];
    m.input_tokens += e.input_tokens || 0;
    m.output_tokens += e.output_tokens || 0;
    m.cost_usd += e.cost_usd || 0;
    m.count += 1;
  }

  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get the Monday (week start) for a given date string "YYYY-MM-DD".
 */
function weekStart(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  d.setDate(d.getDate() - diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Aggregate DailySummary[] into weekly summaries.
 */
function weekly(dailySummaries) {
  return aggregateByPeriod(dailySummaries, (s) => weekStart(s.date));
}

/**
 * Aggregate DailySummary[] into monthly summaries.
 */
function monthly(dailySummaries) {
  return aggregateByPeriod(dailySummaries, (s) => s.date.slice(0, 7));
}

/**
 * Generic period aggregation.
 */
function aggregateByPeriod(summaries, keyFn) {
  const map = new Map();

  for (const s of summaries) {
    const key = keyFn(s);
    let agg = map.get(key);
    if (!agg) {
      agg = createDailySummary({ date: key, source: s.source });
      map.set(key, agg);
    }
    accumulate(agg, s);
  }

  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Accumulate one summary into another.
 */
function accumulate(target, source) {
  target.total_input_tokens += source.total_input_tokens;
  target.total_output_tokens += source.total_output_tokens;
  target.cache_read_tokens += source.cache_read_tokens;
  target.cache_creation_tokens += source.cache_creation_tokens;
  target.thinking_tokens += source.thinking_tokens;
  target.total_cost_usd += source.total_cost_usd;

  for (const [model, usage] of Object.entries(source.models)) {
    if (!target.models[model]) {
      target.models[model] = {
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        count: 0,
      };
    }
    const t = target.models[model];
    t.input_tokens += usage.input_tokens;
    t.output_tokens += usage.output_tokens;
    t.cost_usd += usage.cost_usd;
    t.count += usage.count;
  }
}

/**
 * Merge cached summaries with fresh summaries.
 * Fresh data overwrites cached data for the same date.
 */
function mergeSummaries(cached, fresh) {
  const map = new Map();

  // Load cached first
  for (const s of cached) {
    map.set(s.date, s);
  }

  // Fresh overwrites same dates
  for (const s of fresh) {
    map.set(s.date, s);
  }

  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Merge summaries from multiple parsers, accumulating by date.
 * Unlike mergeSummaries (which overwrites), this SUMS tokens/cost
 * when different sources share the same date.
 */
function mergeAllSummaries(arrayOfSummaryArrays) {
  const map = new Map();

  for (const summaries of arrayOfSummaryArrays) {
    for (const s of summaries) {
      let target = map.get(s.date);
      if (!target) {
        target = createDailySummary({ date: s.date, source: "all" });
        map.set(s.date, target);
      }
      accumulate(target, s);
    }
  }

  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { daily, weekly, monthly, mergeSummaries, mergeAllSummaries, localDate };
