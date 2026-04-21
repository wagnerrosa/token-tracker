"use strict";

const fs = require("fs");
const path = require("path");
const pc = require("picocolors");
const { getTTHome } = require("./storage-path");
const { resolveModel } = require("./services/pricing");

function getConfigPath() { return path.join(getTTHome(), "config.json"); }
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

function fmtPctSmart(n) {
  if (n >= 10 || n === 0) return Math.round(n) + "%";
  return n.toFixed(1) + "%";
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
  if (!max) return "░".repeat(width);
  const filled = Math.round((value / max) * width);
  return "█".repeat(Math.min(filled, width)) + "░".repeat(Math.max(0, width - filled));
}

function bar(pct, width = 12) {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(Math.min(filled, width)) + "░".repeat(Math.max(0, width - filled));
}


function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  try {
    fs.mkdirSync(getTTHome(), { recursive: true });
    fs.writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2));
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

function renderHeaderToday(summary) {
  const dateStr = todayStr();
  const cost = summary ? fmtCost(summary.total_cost_usd) : fmtCost(0);
  console.log(`${pc.white("tt")}  ${pc.white(cost)} ${pc.gray("today")}`);
  console.log(`    ${pc.gray(fmtDateLong(dateStr))}`);
  console.log();
}

function renderHeaderProjects(projects, periodLabel) {
  const total = projects.reduce((s, p) => s + p.total_cost_usd, 0);
  const title = "Projects";
  const indent = " ".repeat(title.length);
  console.log(`${pc.white(title)}  ${pc.white(fmtCost(total))}`);
  console.log(`${indent}  ${pc.gray(periodLabel)}`);
  console.log();
}

function renderHeaderPeriod(summaries, title, periodLabel) {
  const total = summaries.reduce((s, x) => s + x.total_cost_usd, 0);
  const indent = " ".repeat(title.length);
  console.log(`${pc.white(title)}  ${pc.white(fmtCost(total))}`);
  console.log(`${indent}  ${pc.gray(periodLabel)}`);
  console.log();
}

function renderHeaderDoctor() {
  console.log(pc.white("System health"));
  console.log();
}

function renderToday(summary, { projectsByCost, usersByCost, missingCount, projectFilter }) {
  renderHeaderToday(summary);

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

  // Users (only when ≥2 distinct users — keeps default output clean for solo use)
  const multiUser = usersByCost && usersByCost.length >= 2;
  if (multiUser) {
    console.log();
    console.log(pc.gray("Users"));
    const totalUserCost = usersByCost.reduce((s, u) => s + u.total_cost_usd, 0) || 1;
    const names = usersByCost.map((u) => u.user_id || "unknown");
    const nameW = Math.max(...names.map((n) => n.length));
    const costs = usersByCost.map((u) => fmtCost(u.total_cost_usd));
    const costW = Math.max(...costs.map((c) => c.length));

    for (let i = 0; i < usersByCost.length; i++) {
      const u = usersByCost[i];
      const pctNum = (u.total_cost_usd / totalUserCost) * 100;
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
  const topProjectInsight = !projectFilter && projectsByCost && projectsByCost.length > 0;
  const topUserInsight = multiUser;
  const hasInsight = topProjectInsight || topUserInsight || missingCount > 0;
  if (hasInsight) {
    console.log();
    console.log(pc.gray("Insights"));
  }
  if (topProjectInsight) {
    const top = projectsByCost[0];
    console.log(`  ${pc.gray("→")} ${top.name}  ${fmtCost(top.total_cost_usd)} ${pc.gray("(top project)")}`);
  }
  if (topUserInsight) {
    const top = usersByCost[0];
    const label = top.user_id || "unknown";
    console.log(`  ${pc.gray("→")} ${label}  ${fmtCost(top.total_cost_usd)} ${pc.gray("(top user)")}`);
  }
  if (missingCount > 0) {
    console.log(`  ${pc.yellow(`⚠ ${missingCount} model${missingCount === 1 ? "" : "s"} missing pricing — run tt doctor`)}`);
  }
}

function renderProjects(projects, { cwd, periodLabel = "last 7 days" } = {}) {
  renderHeaderProjects(projects, periodLabel);

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

function renderDaily(summaries, { title = "Daily usage", periodLabel = "last 7 days", insights = null } = {}) {
  renderHeaderPeriod(summaries, title, periodLabel);

  const today = todayStr();
  const total = summaries.reduce((s, x) => s + x.total_cost_usd, 0);
  const totalOrOne = total || 1;

  const rows = summaries.map((s) => {
    const isToday = s.date === today;
    const label = isToday ? "today" : (s.date ? fmtDateShort(s.date) : (s.week_start ? fmtDateShort(s.week_start) : "—"));
    const eventCount = Object.values(s.models).reduce((sum, m) => sum + m.count, 0);
    const tokenCount = s.total_input_tokens + s.total_output_tokens;
    const pctNum = (s.total_cost_usd / totalOrOne) * 100;
    return {
      label,
      labelColored: isToday ? pc.cyan(label) : pc.gray(label),
      cost: fmtCost(s.total_cost_usd),
      pct: fmtPctSmart(pctNum),
      tokens: fmtTokens(tokenCount),
      events: fmtInt(eventCount),
    };
  });

  const labelW = Math.max(...rows.map((r) => r.label.length));
  const costW = Math.max(...rows.map((r) => r.cost.length));
  const pctW = Math.max(...rows.map((r) => r.pct.length));
  const tokenW = Math.max(...rows.map((r) => r.tokens.length));
  const eventsW = Math.max(...rows.map((r) => r.events.length));

  // bar width: up to 16, clamped so row fits in terminal
  // fixed chars: 2(indent) + labelW + 2 + costW + 2 + pctW + 2 + BAR + 2 + tokenW + 8(" tokens  ") + eventsW + 3(" ev")
  const fixedW = 2 + labelW + 2 + costW + 2 + pctW + 2 + 2 + tokenW + 8 + eventsW + 3;
  const BAR_WIDTH = Math.max(4, Math.min(16, cols() - fixedW));

  for (const r of rows) {
    const b = pc.white(bar(parseFloat(r.pct), BAR_WIDTH));
    console.log(`  ${pad(r.labelColored, labelW)}  ${padLeft(r.cost, costW)}  ${pc.gray(padLeft(r.pct, pctW))}  ${b}  ${padLeft(r.tokens, tokenW)} tokens  ${pc.gray(padLeft(r.events, eventsW) + " ev")}`);
  }

  const totalTokens = summaries.reduce((s, x) => s + x.total_input_tokens + x.total_output_tokens, 0);
  const avg = summaries.length ? total / summaries.length : 0;
  const avgTokens = summaries.length ? totalTokens / summaries.length : 0;
  const barGap = " ".repeat(BAR_WIDTH + 2);
  console.log();
  console.log(`  ${pc.gray(pad("total", labelW))}  ${padLeft(fmtCost(total), costW)}  ${" ".repeat(pctW)}  ${barGap}${padLeft(fmtTokens(totalTokens), tokenW)} tokens`);
  console.log(`  ${pc.gray(pad("avg", labelW))}  ${padLeft(fmtCost(avg), costW)}  ${" ".repeat(pctW)}  ${barGap}${padLeft(fmtTokens(avgTokens), tokenW)} tokens`);

  if (insights && insights.length > 0) {
    console.log();
    for (const line of insights) {
      console.log(`  ${pc.gray("→")} ${line}`);
    }
  }
}

function renderDoctor(report) {
  renderHeaderDoctor();
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
    ["tt projects", "ranking by cost (cross-repo)"],
    ["tt projects --local", "ranking only current repo"],
    ["tt --project .", "filter by current project"],
    ["tt --by-user", "ranking by user cost (last 7 days)"],
    ["tt --user <id>", "filter by user id"],
    ["tt doctor", "health check"],
    ["tt compact --before <date>", "aggregate + remove raw JSONL older than date"],
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

function renderUsers(users, { periodLabel = "last 7 days" } = {}) {
  const total = users.reduce((s, u) => s + u.total_cost_usd, 0);
  const title = "Users";
  const indent = " ".repeat(title.length);
  console.log(`${pc.white(title)}  ${pc.white(fmtCost(total))}`);
  console.log(`${indent}  ${pc.gray(periodLabel)}`);
  console.log();

  const totalCost = total || 1;
  const names = users.map((u) => u.user_id || "unknown");
  const nameW = Math.max(...names.map((n) => n.length));
  const costs = users.map((u) => fmtCost(u.total_cost_usd));
  const costW = Math.max(...costs.map((c) => c.length));
  const idxW = String(users.length).length;

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const pct = (u.total_cost_usd / totalCost) * 100;
    const name = i === 0 ? pc.white(names[i]) : pc.gray(names[i]);
    console.log(
      `  ${pc.gray(padLeft(i + 1, idxW))}  ${pad(name, nameW)}  ${padLeft(costs[i], costW)}  ${padLeft(fmtPct(pct), 3)}   ${pc.white(bar(pct))}`
    );
  }
  console.log();
  console.log(`  ${pc.gray(`${users.length} user${users.length === 1 ? "" : "s"} · ${fmtCost(total)} total`)}`);
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
  fmtPctSmart,
  fmtDateLong,
  todayStr,
  pad,
  padLeft,
  bar,
  cols,
  loadConfig,
  saveConfig,
  detectedProviders,
  renderToday,
  renderProjects,
  renderDaily,
  renderUsers,
  renderDoctor,
  renderHelp,
  renderEmpty,
  renderWarning,
  maybeOnboard,
};
