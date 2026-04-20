"use strict";

const fs = require("fs");
const path = require("path");
const pc = require("picocolors");
const { TT_HOME } = require("./types");
const { resolveModel } = require("./services/pricing");

const CONFIG_PATH = path.join(TT_HOME, "config.json");
const VERSION = require("../package.json").version;

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function fmtTokens(n) {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return fmtInt(n);
}

function fmtInt(n) {
  return Math.round(n).toLocaleString("pt-BR");
}

function fmtCost(n) {
  if (n == null) return "—";
  return "$" + n.toFixed(2);
}

function fmtCostPrecise(n) {
  if (n == null) return "—";
  return "$" + n.toFixed(4);
}

function fmtPct(n) {
  return Math.round(n) + "%";
}

function fmtDateLong(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

function fmtDateShort(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return `${DAY_NAMES[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}`;
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function pad(s, w) {
  s = String(s);
  return s + " ".repeat(Math.max(0, w - visibleLen(s)));
}

function padLeft(s, w) {
  s = String(s);
  return " ".repeat(Math.max(0, w - visibleLen(s))) + s;
}

function visibleLen(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, "").length;
}

function cols() {
  return process.stdout.columns || 80;
}

function tokenBar(value, max, width = 12) {
  if (!max) return "▱".repeat(width);
  const filled = Math.round((value / max) * width);
  return "▰".repeat(Math.min(filled, width)) + "▱".repeat(Math.max(0, width - filled));
}

function bar(pct, width = 12) {
  const filled = Math.round((pct / 100) * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  try {
    fs.mkdirSync(TT_HOME, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch { /* ignore */ }
}

function detectedProviders() {
  const { getAll } = require("./parsers");
  return getAll().map((p) => ({
    name: p.name,
    dir: p.dataDir(),
    found: fs.existsSync(p.dataDir()),
  }));
}

// ───────── renderers ─────────

function renderHeader(cost, dateStr = todayStr()) {
  console.log(`${pc.white("tt")} ${pc.cyan("◆")}  ${pc.gray(fmtDateLong(dateStr))}`);
  console.log();
  console.log(pc.white(fmtCost(cost)));
  console.log();
}

function renderToday(summary, { projectsByCost, missingCount, projectFilter }) {
  renderHeader(summary.total_cost_usd);

  // Tokens
  const totalTokens = summary.total_input_tokens + summary.total_output_tokens;
  const barRows = [
    ["total",  totalTokens],
    ["↓ in",   summary.total_input_tokens],
    ["↑ out",  summary.total_output_tokens],
  ];
  const cacheRows = [];
  if (summary.cache_read_tokens > 0)    cacheRows.push(["cache hit",   summary.cache_read_tokens]);
  if (summary.cache_creation_tokens > 0) cacheRows.push(["cache write", summary.cache_creation_tokens]);

  const allLabels = [...barRows, ...cacheRows].map((r) => r[0]);
  const allValues = [...barRows, ...cacheRows].map((r) => fmtTokens(r[1]));
  const labelW = Math.max(...allLabels.map((l) => l.length));
  const valueW = Math.max(...allValues.map((v) => v.length));

  console.log(pc.gray("Tokens"));
  for (const [label, val] of barRows) {
    const b = tokenBar(val, totalTokens);
    console.log(`  ${pc.gray(pad(label, labelW))}   ${pc.white(b)}   ${padLeft(fmtTokens(val), valueW)}`);
  }
  if (cacheRows.length > 0) {
    console.log();
    for (const [label, val] of cacheRows) {
      console.log(`  ${pc.gray(pad(label, labelW))}   ${" ".repeat(12)}   ${padLeft(fmtTokens(val), valueW)}`);
    }
  }

  // Models
  const models = Object.entries(summary.models).sort((a, b) => b[1].cost_usd - a[1].cost_usd);
  if (models.length > 0) {
    console.log();
    console.log(pc.gray("Models"));
    const total = summary.total_cost_usd || 1;
    const names = models.map(([m]) => resolveModel(m).display || m);
    const nameW = Math.max(...names.map((n) => n.length));
    const costs = models.map(([, u]) => fmtCost(u.cost_usd));
    const costW = Math.max(...costs.map((c) => c.length));

    for (let i = 0; i < models.length; i++) {
      const [, usage] = models[i];
      const pctNum = (usage.cost_usd / total) * 100;
      const pct = padLeft(fmtPct(pctNum), 4);
      const b = bar(pctNum);
      if (i === 0) {
        console.log(`  ${pc.white(pad(names[i], nameW))}  ${pc.white(padLeft(costs[i], costW))}  ${pct}   ${pc.white(b)}`);
      } else {
        console.log(`  ${pc.gray(pad(names[i], nameW))}  ${padLeft(costs[i], costW)}  ${pct}   ${pc.white(b)}`);
      }
    }
  }

  // Insights
  const hasInsight = (!projectFilter && projectsByCost?.length > 0) || missingCount > 0;
  if (hasInsight) {
    console.log();
    console.log(pc.gray("Insights"));
  }
  if (!projectFilter && projectsByCost && projectsByCost.length > 0) {
    const top = projectsByCost[0];
    console.log(`  ${pc.gray("→")} ${top.name}  ${fmtCost(top.total_cost_usd)} ${pc.gray("(top project)")}`);
  }
  if (missingCount > 0) {
    console.log(`  ${pc.yellow(`⚠ ${missingCount} model${missingCount === 1 ? "" : "s"} missing pricing — run tt doctor`)}`);
  }
}

function renderProjects(projects, { cwd, periodLabel = "last 7 days" } = {}) {
  console.log(`tt ${pc.cyan("◆")}  ${pc.gray(periodLabel)}`);
  console.log();

  const total = projects.reduce((s, p) => s + p.total_cost_usd, 0) || 1;
  const names = projects.map((p) => p.name);
  const nameW = Math.max(...names.map((n) => n.length));
  const costs = projects.map((p) => fmtCost(p.total_cost_usd));
  const costW = Math.max(...costs.map((c) => c.length));
  const idxW = String(projects.length).length;

  for (let i = 0; i < projects.length; i++) {
    const p = projects[i];
    const pct = (p.total_cost_usd / total) * 100;
    const isCwd = cwd && p.project_path === cwd;
    const name = isCwd ? pc.cyan(p.name) : p.name;
    const marker = isCwd ? pc.gray(" ·") : "";
    console.log(
      `  ${pc.gray(padLeft(i + 1, idxW))}  ${pad(name, nameW)}  ${padLeft(costs[i], costW)}  ${padLeft(fmtPct(pct), 3)}   ${pc.white(bar(pct))}${marker}`
    );
  }
  console.log();
  console.log(`  ${pc.gray(`${projects.length} project${projects.length === 1 ? "" : "s"} · ${fmtCost(total)} total`)}`);
}

function renderDaily(summaries, { title = "last 7 days" } = {}) {
  console.log(`tt ${pc.cyan("◆")}  ${pc.gray(title)}`);
  console.log();

  const today = todayStr();
  const rows = summaries.map((s) => {
    const isToday = s.date === today;
    const label = isToday ? "today" : fmtDateShort(s.date);
    const eventCount = Object.values(s.models).reduce((sum, m) => sum + m.count, 0);
    const tokenCount = s.total_input_tokens + s.total_output_tokens;
    return {
      label,
      labelColored: isToday ? pc.cyan(label) : pc.gray(label),
      cost: fmtCost(s.total_cost_usd),
      tokens: fmtTokens(tokenCount),
      events: fmtInt(eventCount),
    };
  });

  const labelW = Math.max(...rows.map((r) => r.label.length));
  const costW = Math.max(...rows.map((r) => r.cost.length));
  const tokenW = Math.max(...rows.map((r) => r.tokens.length));

  for (const r of rows) {
    console.log(`  ${pad(r.labelColored, labelW)}  ${padLeft(r.cost, costW)}  ${padLeft(r.tokens, tokenW)} tokens  ${pc.gray(r.events + " ev")}`);
  }

  const total = summaries.reduce((s, x) => s + x.total_cost_usd, 0);
  const totalTokens = summaries.reduce((s, x) => s + x.total_input_tokens + x.total_output_tokens, 0);
  const avg = summaries.length ? total / summaries.length : 0;
  const avgTokens = summaries.length ? totalTokens / summaries.length : 0;
  console.log();
  console.log(`  ${pc.gray(pad("total", labelW))}  ${padLeft(fmtCost(total), costW)}  ${padLeft(fmtTokens(totalTokens), tokenW)} tokens`);
  console.log(`  ${pc.gray(pad("avg", labelW))}  ${padLeft(fmtCost(avg), costW)}  ${padLeft(fmtTokens(avgTokens), tokenW)} tokens`);
}

function renderDoctor(report) {
  console.log();
  for (const section of report.sections) {
    console.log(`  ${pc.gray(section.title)}`);
    for (const item of section.items) {
      const mark =
        item.level === "ok" ? pc.green("✓") :
        item.level === "warn" ? pc.yellow("!") :
        item.level === "err" ? pc.red("✗") :
        " ";
      console.log(`  ${mark}  ${item.text}`);
    }
    console.log();
  }
}

function renderHelp() {
  console.log();
  console.log(`  ${pc.cyan("TokenTracker")}  ${pc.gray("v" + VERSION)}`);
  console.log();
  console.log("  discover how much each project really costs in AI usage.");
  console.log("  local logs, no external services, no database.");
  console.log();

  console.log(`  ${pc.gray("providers detected")}`);
  const provs = detectedProviders();
  const nameW = Math.max(...provs.map((p) => p.name.length));
  for (const p of provs) {
    const mark = p.found ? pc.green("✓") : pc.gray("–");
    console.log(`  ${mark}  ${pad(p.name, nameW)}  ${pc.gray(p.found ? p.dir : "not found")}`);
  }
  console.log();

  console.log(`  ${pc.gray("commands")}`);
  const cmds = [
    ["tt", "today summary"],
    ["tt daily", "last 7 days"],
    ["tt weekly", "last 4 weeks"],
    ["tt projects", "ranking by cost"],
    ["tt --project .", "filter by current project"],
    ["tt doctor", "health check"],
  ];
  const cmdW = Math.max(...cmds.map((c) => c[0].length));
  for (const [c, d] of cmds) {
    console.log(`    ${pad(c, cmdW)}    ${pc.gray(d)}`);
  }
  console.log();
  console.log(`  ${pc.gray("tip:")} run tt --project . inside any repository`);
  console.log(`  to see costs for that project only.`);
  console.log();
}

function maybeOnboard() {
  const cfg = loadConfig();
  if (cfg.onboarded) return false;
  renderHelp();
  saveConfig({ ...cfg, onboarded: true });
  return true;
}

function renderEmpty(msg) {
  console.log(`  ${pc.gray(msg)}`);
}

function renderWarning(msg) {
  console.log(`  ${pc.yellow(`⚠ ${msg}`)}`);
}

module.exports = {
  pc,
  fmtTokens,
  fmtCost,
  fmtCostPrecise,
  fmtInt,
  fmtPct,
  fmtDateLong,
  todayStr,
  pad,
  padLeft,
  bar,
  cols,
  loadConfig,
  saveConfig,
  detectedProviders,
  renderHeader,
  renderToday,
  renderProjects,
  renderDaily,
  renderDoctor,
  renderHelp,
  renderEmpty,
  renderWarning,
  maybeOnboard,
};
