#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { aggregate, byProject } = require("./aggregate");
const { resolveModel } = require("./services/pricing");
const { read: readEvents, ingestAll, enrichCosts } = require("./event-log");
const { doctor } = require("./doctor");
const { TT_HOME, CACHE_DIR } = require("./types");

const [, , ...rest] = process.argv;
let cmd = null;
const jsonFlag = rest.includes("--json");
const projectFlag = rest.includes("--project") ? rest[rest.indexOf("--project") + 1] : null;
if (rest.length > 0 && !rest[0].startsWith("-")) {
  cmd = rest[0];
}

function fmtTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function fmtCost(n) {
  return "$" + n.toFixed(4);
}

function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function printSummaryTable(summaries) {
  if (summaries.length === 0) {
    console.log("sem dados");
    return;
  }
  const header = ["date", "input", "output", "cost"].map((h) => h.padEnd(12));
  console.log(header.join(""));
  console.log("─".repeat(48));
  for (const s of summaries) {
    const row = [
      s.date.padEnd(12),
      fmtTokens(s.total_input_tokens).padEnd(12),
      fmtTokens(s.total_output_tokens).padEnd(12),
      fmtCost(s.total_cost_usd).padEnd(12),
    ];
    console.log(row.join(""));
  }
}

function warnOldCache() {
  if (fs.existsSync(CACHE_DIR)) {
    const flag = path.join(TT_HOME, ".cache_warning_shown");
    if (!fs.existsSync(flag)) {
      console.error(`Aviso: cache antigo detectado em ${CACHE_DIR} (não é mais usado).`);
      console.error(`  Pode apagar com: rm -rf ${CACHE_DIR}`);
      try { fs.writeFileSync(flag, "1"); } catch { /* ignore */ }
    }
  }
}

async function main() {
  if (cmd === "doctor") {
    await doctor();
    return;
  }

  warnOldCache();
  await ingestAll();
  const events = await readEvents();
  await enrichCosts(events);

  if (cmd === "projects") {
    const projects = byProject(events);
    if (jsonFlag) {
      console.log(JSON.stringify(projects, null, 2));
      return;
    }
    if (projects.length === 0) {
      console.log("sem dados");
      return;
    }
    console.log("Projetos\n");
    const header = ["project", "input", "output", "cost"].map((h) => h.padEnd(20));
    console.log(header.join(""));
    console.log("─".repeat(80));
    for (const p of projects) {
      const row = [
        p.name.slice(0, 18).padEnd(20),
        fmtTokens(p.total_input_tokens).padEnd(20),
        fmtTokens(p.total_output_tokens).padEnd(20),
        fmtCost(p.total_cost_usd).padEnd(20),
      ];
      console.log(row.join(""));
    }
    return;
  }

  let scoped = events;
  if (projectFlag !== null) {
    const rawDir = projectFlag === "." ? process.cwd() : path.resolve(projectFlag);
    let cwd;
    try { cwd = fs.realpathSync(rawDir); } catch { cwd = rawDir; }
    scoped = events.filter((e) => e.project_path === cwd);
    if (scoped.length === 0) {
      console.log(`sem dados para projeto: ${cwd}`);
      return;
    }
  }

  const daily = aggregate(scoped, { granularity: "daily" });

  if (cmd === "daily") {
    const last7 = daily.slice(-7);
    if (jsonFlag) {
      console.log(JSON.stringify(last7, null, 2));
    } else {
      console.log("Últimos 7 dias\n");
      printSummaryTable(last7);
    }
    return;
  }

  if (cmd === "weekly") {
    const weekly = aggregate(scoped, { granularity: "weekly" }).slice(-4);
    if (jsonFlag) {
      console.log(JSON.stringify(weekly, null, 2));
    } else {
      console.log("Últimas 4 semanas\n");
      printSummaryTable(weekly);
    }
    return;
  }

  const todayDate = today();
  const todaySummary = daily.find((s) => s.date === todayDate);

  if (!todaySummary) {
    console.log("Hoje: sem dados");
    return;
  }

  if (jsonFlag) {
    console.log(JSON.stringify({ today: todayDate, daily: [todaySummary], weekly: daily }, null, 2));
    return;
  }

  console.log(`Hoje (${todayDate})\n`);
  console.log(`  Input:   ${fmtTokens(todaySummary.total_input_tokens)}`);
  console.log(`  Output:  ${fmtTokens(todaySummary.total_output_tokens)}`);
  if (todaySummary.cache_read_tokens > 0) {
    console.log(`  Cache ↑: ${fmtTokens(todaySummary.cache_read_tokens)}`);
  }
  console.log(`  Custo:   ${fmtCost(todaySummary.total_cost_usd)}`);
  console.log();

  const models = Object.entries(todaySummary.models).sort(
    (a, b) => b[1].cost_usd - a[1].cost_usd
  );
  if (models.length > 0) {
    console.log("  Modelos:");
    for (const [model, usage] of models) {
      const name = resolveModel(model).display;
      console.log(`    ${name.padEnd(36)} ${fmtCost(usage.cost_usd)}  (${usage.count}x)`);
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
