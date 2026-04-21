#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { aggregate, byProject, byUser, localDate } = require("./aggregate");
const { resolveModel, MODELS } = require("./services/pricing");
const { read: readEvents, ingestAll, enrichCosts } = require("./event-log");
const { doctor } = require("./doctor");
const { getTTHome } = require("./storage-path");
const ui = require("./ui");

const [, , ...rest] = process.argv;
let cmd = null;
const jsonFlag = rest.includes("--json");
const helpFlag = rest.includes("--help") || rest.includes("-h");
const projectFlag = rest.includes("--project") ? rest[rest.indexOf("--project") + 1] : null;
const byUserFlag = rest.includes("--by-user");
const userFlag = rest.includes("--user") ? rest[rest.indexOf("--user") + 1] : null;
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

async function main() {
  if (helpFlag) {
    ui.renderHelp();
    return;
  }

  if (cmd === "doctor") {
    await doctor();
    return;
  }

  const isFirstRun = ui.maybeOnboard();

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
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const projects = byProject(events, { since });
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
      ui.renderDaily(last7, { title: "Daily usage", periodLabel: "last 7 days" });
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
      ui.renderDaily(weekly, { title: "Weekly usage", periodLabel: "last 4 weeks" });
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
  const missingCount = countMissingPricing(todayEvents);

  ui.renderToday(todaySummary, {
    projectsByCost,
    missingCount,
    projectFilter: projectFilterResolved,
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
