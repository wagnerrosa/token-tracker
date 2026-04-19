"use strict";

function localDate(ts) {
  if (!ts) return "unknown";
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function weekStart(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function periodKey(ts, granularity) {
  const d = localDate(ts);
  if (granularity === "weekly") return weekStart(d);
  if (granularity === "monthly") return d.slice(0, 7);
  return d;
}

function emptyPeriod(date) {
  return {
    date,
    source: "all",
    total_input_tokens: 0,
    total_output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    thinking_tokens: 0,
    total_cost_usd: 0,
    has_missing_pricing: false,
    models: {},
  };
}

function accumulate(target, ev) {
  target.total_input_tokens += ev.input_tokens || 0;
  target.total_output_tokens += ev.output_tokens || 0;
  target.cache_read_tokens += ev.cache_read_tokens || 0;
  target.cache_creation_tokens += ev.cache_write_tokens || 0;
  target.thinking_tokens += ev.reasoning_tokens || 0;
  target.total_cost_usd += ev.cost_usd || 0;

  if (ev.cost_source === null && (ev.input_tokens || ev.output_tokens)) {
    target.has_missing_pricing = true;
  }

  const model = ev.model || "unknown";
  if (!target.models[model]) {
    target.models[model] = {
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      count: 0,
    };
  }
  const m = target.models[model];
  m.input_tokens += ev.input_tokens || 0;
  m.output_tokens += ev.output_tokens || 0;
  m.cost_usd += ev.cost_usd || 0;
  m.count += 1;
}

function aggregate(events, { granularity = "daily", project = null, since, until } = {}) {
  const periods = new Map();

  for (const ev of events) {
    if (project && ev.project_id !== project) continue;
    if (since && ev.ts < since) continue;
    if (until && ev.ts > until) continue;

    const key = periodKey(ev.ts, granularity);
    if (!periods.has(key)) periods.set(key, emptyPeriod(key));
    accumulate(periods.get(key), ev);
  }

  return [...periods.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, data]) => data);
}

function byProject(events, { since, until } = {}) {
  const map = new Map();

  for (const ev of events) {
    if (since && ev.ts < since) continue;
    if (until && ev.ts > until) continue;

    const key = ev.project_id || `${ev.source} · sem projeto`;
    let p = map.get(key);
    if (!p) {
      p = {
        project_id: ev.project_id,
        project_path: ev.project_path,
        name: ev.project_id || `${ev.source} · sem projeto`,
        source: ev.source,
        total_input_tokens: 0,
        total_output_tokens: 0,
        cache_read_tokens: 0,
        total_cost_usd: 0,
        count: 0,
      };
      map.set(key, p);
    }

    p.total_input_tokens += ev.input_tokens || 0;
    p.total_output_tokens += ev.output_tokens || 0;
    p.cache_read_tokens += ev.cache_read_tokens || 0;
    p.total_cost_usd += ev.cost_usd || 0;
    p.count += 1;
    if (!p.project_path && ev.project_path) p.project_path = ev.project_path;
  }

  return [...map.values()].sort((a, b) => b.total_cost_usd - a.total_cost_usd);
}

module.exports = { aggregate, byProject, localDate, periodKey, weekStart };
