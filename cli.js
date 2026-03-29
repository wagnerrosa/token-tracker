#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const USAGE_DIR = path.join(process.cwd(), ".ai-tracker");

function loadAllEntries() {
  if (!fs.existsSync(USAGE_DIR)) return [];

  const files = fs.readdirSync(USAGE_DIR).filter((f) => f.endsWith("-usage.json"));
  const entries = [];

  for (const file of files) {
    const user = file.replace(/-usage\.json$/, "");
    try {
      const raw = fs.readFileSync(path.join(USAGE_DIR, file), "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          entries.push({ ...entry, user });
        }
      }
    } catch {
      console.warn(`[ai-tracker] Could not read ${file}, skipping`);
    }
  }

  return entries;
}

function aggregate(entries) {
  const byUser = {};
  let totalTokens = 0;
  let totalCost = 0;

  for (const e of entries) {
    totalTokens += e.total_tokens || 0;
    totalCost += e.cost_total || 0;

    if (!byUser[e.user]) byUser[e.user] = { tokens: 0, cost: 0, requests: 0 };
    byUser[e.user].tokens += e.total_tokens || 0;
    byUser[e.user].cost += e.cost_total || 0;
    byUser[e.user].requests += 1;
  }

  return { totalTokens, totalCost, byUser };
}

const command = process.argv[2];

const entries = loadAllEntries();
if (entries.length === 0) {
  console.log("No usage data found in .ai-tracker/");
  process.exit(0);
}

const { totalTokens, totalCost, byUser } = aggregate(entries);

if (command === "leaderboard") {
  console.log("\nLeaderboard (by cost)\n");
  const ranked = Object.entries(byUser).sort((a, b) => b[1].cost - a[1].cost);
  ranked.forEach(([user, stats], i) => {
    console.log(`  ${i + 1}. ${user} — $${stats.cost.toFixed(6)} (${stats.tokens.toLocaleString()} tokens)`);
  });
  console.log();
} else {
  // Default: stats
  console.log("\nAI Tracker — Usage Summary\n");
  console.log(`  Total tokens : ${totalTokens.toLocaleString()}`);
  console.log(`  Total cost   : $${totalCost.toFixed(6)}`);
  console.log(`  Total requests: ${entries.length}`);
  console.log("\n  Breakdown by user:\n");
  const sorted = Object.entries(byUser).sort((a, b) => b[1].cost - a[1].cost);
  for (const [user, stats] of sorted) {
    console.log(`  ${user}`);
    console.log(`    tokens   : ${stats.tokens.toLocaleString()}`);
    console.log(`    cost     : $${stats.cost.toFixed(6)}`);
    console.log(`    requests : ${stats.requests}`);
  }
  console.log();
}
