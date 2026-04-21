#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { aggregate, byProject, byUser, localDate } = require("./aggregate");
const { resolveModel, MODELS } = require("./services/pricing");
const { read: readEvents, readAllRepos, ingestAll, enrichCosts } = require("./event-log");
const { doctor } = require("./doctor");
const { compactBefore } = require("./compact");
const { getTTHome } = require("./storage-path");
const ui = require("./ui");

const [, , ...rest] = process.argv;
let cmd = null;
const jsonFlag = rest.includes("--json");
const helpFlag = rest.includes("--help") || rest.includes("-h");
const projectFlag = rest.includes("--project") ? rest[rest.indexOf("--project") + 1] : null;
const byUserFlag = rest.includes("--by-user");
const userFlag = rest.includes("--user") ? rest[rest.indexOf("--user") + 1] : null;
const beforeFlag = rest.includes("--before") ? rest[rest.indexOf("--before") + 1] : null;
const dryRunFlag = rest.includes("--dry-run");
const yesFlag = rest.includes("--yes") || rest.includes("-y");
const localFlag = rest.includes("--local");
if (rest.length > 0 && !rest[0].startsWith("-")) {
  cmd = rest[0];
}

function warnOldCache() {
  const ttHome = getTTHome();
  const cacheDir = path.join(ttHome, "cache");
  if (fs.existsSync(cacheDir)) {
    const flag = path.join(ttHome, ".cache_warning_shown");
    if (!fs.existsSync(flag)) {
      console.error(`warning: legacy cache detected at ${cacheDir} (no longer used)`);
      console.error(`  you can remove it with: rm -rf ${cacheDir}`);
      try { fs.writeFileSync(flag, "1"); } catch { /* ignore */ }
    }
  }
}

function countMissingPricing(events) {
  const unknown = new Set();
  for (const ev of events) {
    if (!ev.model) continue;
    const { canonical } = resolveModel(ev.model);
    if (MODELS[canonical] == null) unknown.add(ev.model);
  }
  return unknown.size;
}

const DAY_NAMES_SHORT = ["sun","mon","tue","wed","thu","fri","sat"];
const MONTH_NAMES_SHORT = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

function dayLabel(dateStr) {
  const today = ui.todayStr();
  if (dateStr === today) return "today";
  const d = new Date(dateStr + "T12:00:00");
  return `${DAY_NAMES_SHORT[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}`;
}

function buildDailyInsights(last7, allScoped) {
  const lines = [];
  const total7 = last7.reduce((s, x) => s + x.total_cost_usd, 0);
  if (total7 === 0) return lines;

  // last 7 days vs last 4 weeks
  const weekly4 = aggregate(allScoped, { granularity: "weekly" }).slice(-4);
  const total4w = weekly4.reduce((s, x) => s + x.total_cost_usd, 0);
  if (total4w > 0 && total4w > total7) {
    const pct = ui.fmtPctSmart((total7 / total4w) * 100);
    lines.push(`last 7 days = ${pct} of last 4 weeks`);
  }

  // top day
  const topDay = last7.reduce((a, b) => (b.total_cost_usd > a.total_cost_usd ? b : a));
  if (topDay.total_cost_usd > 0) {
    const pct = ui.fmtPctSmart((topDay.total_cost_usd / total7) * 100);
    lines.push(`top day (${dayLabel(topDay.date)}) = ${pct} of spend`);
  }

  // spike: any non-top day > avg * 1.5
  const avg = total7 / last7.length;
  const spike = last7.find((s) => s !== topDay && s.total_cost_usd > avg * 1.5);
  if (spike) {
    lines.push(`spike on ${dayLabel(spike.date)} (${ui.fmtCost(spike.total_cost_usd)} = ${ui.fmtPctSmart((spike.total_cost_usd / total7) * 100)} of week)`);
  }

  return lines;
}

function buildWeeklyInsights(weekly) {
  const lines = [];
  const total = weekly.reduce((s, x) => s + x.total_cost_usd, 0);
  if (total === 0) return lines;

  const topWeek = weekly.reduce((a, b) => (b.total_cost_usd > a.total_cost_usd ? b : a));
  const pct = ui.fmtPctSmart((topWeek.total_cost_usd / total) * 100);
  const dateStr = topWeek.week_start || topWeek.date;
  const d = new Date(dateStr + "T12:00:00");
  const label = `${String(d.getDate()).padStart(2, "0")} ${MONTH_NAMES_SHORT[d.getMonth()]}`;
  lines.push(`top week (${label}) = ${pct} of total`);

  return lines;
}

async function main() {
  if (helpFlag) {
    ui.renderHelp();
    return;
  }

  if (cmd === "doctor") {
    await doctor();
    return;
  }

  if (cmd === "compact") {
    await runCompact();
    return;
  }

  const isFirstRun = jsonFlag ? false : ui.maybeOnboard();

  warnOldCache();
  await ingestAll();
  const events = await readEvents();
  await enrichCosts(events);

  // --user <id> filter
  if (userFlag !== null) {
    const matched = events.filter((e) => e.user_id === userFlag);
    if (matched.length === 0) {
      ui.renderEmpty(`no data for user: ${userFlag}`);
      return;
    }
    events.splice(0, events.length, ...matched);
  }

  // --by-user ranking
  if (byUserFlag) {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const users = byUser(events, { since });
    if (jsonFlag) {
      console.log(JSON.stringify(users, null, 2));
      return;
    }
    if (users.length === 0) {
      ui.renderEmpty("no data");
      return;
    }
    ui.renderUsers(users, { periodLabel: "last 7 days" });
    return;
  }

  // projects command
  if (cmd === "projects") {
    const projectEvents = localFlag ? events : await readAllRepos();
    await enrichCosts(projectEvents);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const projects = byProject(projectEvents, { since });
    if (jsonFlag) {
      console.log(JSON.stringify(projects, null, 2));
      return;
    }
    if (projects.length === 0) {
      ui.renderEmpty("no data");
      return;
    }
    let cwd;
    try { cwd = fs.realpathSync(process.cwd()); } catch { cwd = process.cwd(); }
    ui.renderProjects(projects, { cwd, periodLabel: "last 7 days" });
    return;
  }

  // project filter
  let scoped = events;
  let projectFilterResolved = null;
  if (projectFlag !== null) {
    const rawDir = projectFlag === "." ? process.cwd() : path.resolve(projectFlag);
    let cwd;
    try { cwd = fs.realpathSync(rawDir); } catch { cwd = rawDir; }
    projectFilterResolved = cwd;
    scoped = events.filter((e) => e.project_path === cwd);
    if (scoped.length === 0) {
      ui.renderEmpty(`no data for project: ${cwd}`);
      return;
    }
  }

  const daily = aggregate(scoped, { granularity: "daily" });

  if (cmd === "daily") {
    const last7 = daily.slice(-7).reverse();
    if (jsonFlag) {
      console.log(JSON.stringify(last7, null, 2));
    } else if (last7.length === 0) {
      ui.renderEmpty("no data");
    } else {
      const insights = buildDailyInsights(last7, scoped);
      ui.renderDaily(last7, { title: "Daily usage", periodLabel: "last 7 days", insights });
    }
    return;
  }

  if (cmd === "weekly") {
    const weekly = aggregate(scoped, { granularity: "weekly" }).slice(-4).reverse();
    if (jsonFlag) {
      console.log(JSON.stringify(weekly, null, 2));
    } else if (weekly.length === 0) {
      ui.renderEmpty("no data");
    } else {
      const insights = buildWeeklyInsights(weekly);
      ui.renderDaily(weekly, { title: "Weekly usage", periodLabel: "last 4 weeks", insights });
    }
    return;
  }

  // default: today
  const todayDate = ui.todayStr();
  const todaySummary = daily.find((s) => s.date === todayDate);

  if (!todaySummary) {
    if (!isFirstRun) ui.renderEmpty("today: no data");
    return;
  }

  if (jsonFlag) {
    console.log(JSON.stringify({ today: todayDate, daily: [todaySummary], weekly: daily }, null, 2));
    return;
  }

  // byProject for today's "→ mais caro hoje"
  const todayEvents = scoped.filter((e) => localDate(e.ts) === todayDate);
  const projectsByCost = byProject(todayEvents);
  const usersByCost = byUser(todayEvents);
  const missingCount = countMissingPricing(todayEvents);

  ui.renderToday(todaySummary, {
    projectsByCost,
    usersByCost,
    missingCount,
    projectFilter: projectFilterResolved,
  });
}

async function runCompact() {
  if (!beforeFlag) {
    console.error("error: tt compact requires --before YYYY-MM-DD");
    process.exit(2);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(beforeFlag)) {
    console.error(`error: invalid --before date: ${beforeFlag} (expected YYYY-MM-DD)`);
    process.exit(2);
  }

  // Dry run first to preview impact
  const preview = await compactBefore(beforeFlag, { dryRun: true });

  if (preview.files_scanned === 0) {
    console.log(`no event files older than ${beforeFlag}`);
    return;
  }

  if (jsonFlag) {
    const result = dryRunFlag ? preview : await compactBefore(beforeFlag, { dryRun: false });
    console.log(JSON.stringify({ dry_run: dryRunFlag, before: beforeFlag, ...result }, null, 2));
    return;
  }

  const mb = (b) => (b / 1024 / 1024).toFixed(2);
  console.log(`compact preview (before ${beforeFlag}):`);
  console.log(`  files scanned:  ${preview.files_scanned}`);
  console.log(`  events:         ${preview.events_read}`);
  console.log(`  → groups:       ${preview.groups}`);
  console.log(`  input tokens:   ${preview.totals.input_tokens.toLocaleString()}`);
  console.log(`  output tokens:  ${preview.totals.output_tokens.toLocaleString()}`);
  console.log(`  cost (usd):     ${preview.totals.cost_usd.toFixed(4)}`);
  console.log(`  size before:    ${mb(preview.bytes_before)} MB`);

  if (dryRunFlag) {
    console.log("\ndry-run: no files modified. rerun without --dry-run to apply.");
    return;
  }

  if (!yesFlag) {
    console.log("\nthis will DELETE raw JSONL files and replace them with aggregated events.");
    console.log("rerun with --yes to confirm.");
    return;
  }

  const result = await compactBefore(beforeFlag, { dryRun: false });
  console.log(`\ncompacted ${result.events_read} events → ${result.groups} groups`);
  console.log(`removed ${result.files_removed} files · size after: ${mb(result.bytes_after)} MB`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
