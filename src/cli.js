#!/usr/bin/env node
"use strict";

const { loadForParser } = require("./services/cache");
const { daily, weekly } = require("./services/aggregator");
const claude = require("./parsers/claude");

const [, , cmd, ...args] = process.argv;
const jsonFlag = args.includes("--json");

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
  const header = ["date", "input", "output", "cost"].map((h) =>
    h.padEnd(12)
  );
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

async function main() {
  // Auto-scan: always warm path
  const allSummaries = await loadForParser(claude);

  if (cmd === "daily") {
    const last7 = allSummaries.slice(-7);
    if (jsonFlag) {
      console.log(JSON.stringify(last7, null, 2));
    } else {
      console.log("Últimos 7 dias\n");
      printSummaryTable(last7);
    }
    return;
  }

  if (cmd === "weekly") {
    const weeklySummaries = weekly(allSummaries).slice(-4);
    if (jsonFlag) {
      console.log(JSON.stringify(weeklySummaries, null, 2));
    } else {
      console.log("Últimas 4 semanas\n");
      printSummaryTable(weeklySummaries);
    }
    return;
  }

  if (cmd === "projects") {
    // Fase 6
    console.log("tt projects — implementado na Fase 6");
    return;
  }

  // Default: tt (today)
  const todayDate = today();
  const todaySummary = allSummaries.find((s) => s.date === todayDate);

  if (!todaySummary) {
    console.log("Hoje: sem dados");
    return;
  }

  console.log(`Hoje (${todayDate})\n`);
  console.log(
    `  Input:   ${fmtTokens(todaySummary.total_input_tokens)}`
  );
  console.log(
    `  Output:  ${fmtTokens(todaySummary.total_output_tokens)}`
  );
  if (todaySummary.cache_read_tokens > 0) {
    console.log(
      `  Cache ↑: ${fmtTokens(todaySummary.cache_read_tokens)}`
    );
  }
  console.log(`  Custo:   ${fmtCost(todaySummary.total_cost_usd)}`);
  console.log();

  const models = Object.entries(todaySummary.models).sort(
    (a, b) => b[1].cost_usd - a[1].cost_usd
  );
  if (models.length > 0) {
    console.log("  Modelos:");
    for (const [model, usage] of models) {
      console.log(
        `    ${model.padEnd(36)} ${fmtCost(usage.cost_usd)}  (${usage.count}x)`
      );
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
