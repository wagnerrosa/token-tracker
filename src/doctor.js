"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { glob } = require("glob");
const { getTTHome, getStorageMode } = require("./storage-path");
const { getUserId } = require("./git-user");
const { listRepos, getRepoStaleness } = require("./repo-registry");
const { EVENTS_DIR, CURSORS_DIR } = require("./event-log");
const { resolveModel, MODELS, CACHE_PATH: PRICING_CACHE_PATH } = require("./services/pricing");
const ui = require("./ui");

async function doctor() {
  const sections = [];
  const eventLog = { title: "event log", items: [] };
  const pricingSection = { title: "pricing", items: [] };
  const storage = { title: "storage", items: [] };

  // 1. Event log
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const sourceStats = new Map();
  let totalEvents = 0;
  let nullCostEvents = 0;
  let corruptLines = 0;

  let sources = [];
  try {
    const entries = await fsp.readdir(EVENTS_DIR, { withFileTypes: true });
    sources = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    eventLog.items.push({ level: "err", text: `directory not found: ${EVENTS_DIR}` });
  }

  const unknownModels = new Map();
  const sourceMeta = new Map();

  for (const src of sources) {
    const patternB = path.join(EVENTS_DIR, src, "*.jsonl");
    const patternA = path.join(EVENTS_DIR, src, "*", "*.jsonl");
    const filesB = await glob(patternB, { nodir: true });
    const filesA = await glob(patternA, { nodir: true });
    const files = [...filesB, ...filesA];
    let srcCount = 0;
    const sessions = new Set();
    let lastTs = null;

    for (const f of files) {
      // Layout B: basename = "{date}.jsonl". Layout A: parent dir = date.
      const parent = path.basename(path.dirname(f));
      const date = /^\d{4}-\d{2}-\d{2}$/.test(parent) ? parent : path.basename(f, ".jsonl");
      if (date < since7) continue;

      let raw;
      try { raw = await fsp.readFile(f, "utf8"); } catch { continue; }

      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        let ev;
        try { ev = JSON.parse(line); } catch {
          corruptLines++;
          continue;
        }
        srcCount++;
        totalEvents++;
        if (ev.session_id) sessions.add(ev.session_id);
        if (ev.ts && (!lastTs || ev.ts > lastTs)) lastTs = ev.ts;

        if (ev.cost_usd == null && (ev.input_tokens || ev.output_tokens)) {
          nullCostEvents++;
        }

        if (ev.model) {
          const { canonical } = resolveModel(ev.model);
          if (MODELS[canonical] == null) {
            const prev = unknownModels.get(ev.model) || { count: 0, tokens: 0 };
            unknownModels.set(ev.model, {
              count: prev.count + 1,
              tokens: prev.tokens + (ev.input_tokens || 0) + (ev.output_tokens || 0),
            });
          }
        }
      }
    }

    sourceStats.set(src, srcCount);
    sourceMeta.set(src, { sessions: sessions.size, lastTs });
  }

  for (const src of sources) {
    const n = sourceStats.get(src) || 0;
    const meta = sourceMeta.get(src) || {};
    const level = n > 0 ? "ok" : "warn";
    let detail = `${ui.fmtInt(n)} events`;
    if (meta.sessions > 0) detail += ` · ${meta.sessions} sessions`;
    if (meta.lastTs) detail += ` · last ${meta.lastTs.slice(0, 16).replace("T", " ")}`;
    eventLog.items.push({
      level,
      text: `${ui.pad(src, 10)}  ${ui.pc.gray(detail)}`,
    });
  }

  if (corruptLines > 0) {
    eventLog.items.push({ level: "warn", text: `${corruptLines} invalid JSONL line(s)` });
  }

  // 2. Pricing
  try {
    const raw = fs.readFileSync(PRICING_CACHE_PATH, "utf8");
    const data = JSON.parse(raw);
    const ageMs = Date.now() - (data.fetched_at || 0);
    const ageMin = Math.round(ageMs / 60000);
    const modelCount = data.models ? Object.keys(data.models).length : 0;
    pricingSection.items.push({
      level: "ok",
      text: `cache LiteLLM  ${ui.pc.gray(`updated ${ageMin}min ago · ${modelCount} models`)}`,
    });
  } catch {
    pricingSection.items.push({ level: "warn", text: "cache LiteLLM  not found" });
  }

  if (unknownModels.size > 0) {
    for (const [model, { count }] of unknownModels.entries()) {
      pricingSection.items.push({
        level: "warn",
        text: `${model} ${ui.pc.gray(`· invisible cost in ${count} event${count === 1 ? "" : "s"}`)}`,
      });
    }
  } else if (totalEvents > 0) {
    pricingSection.items.push({ level: "ok", text: "all models have pricing" });
  }

  if (nullCostEvents > 0) {
    pricingSection.items.push({
      level: "warn",
      text: `${nullCostEvents} event${nullCostEvents === 1 ? "" : "s"} without cost`,
    });
  }

  // 3. Storage
  const ttHome = getTTHome();
  const storageMode = getStorageMode();
  const eventLayout = process.env.TT_EVENT_LAYOUT === "B" ? "B" : "A";
  storage.items.push({
    level: "ok",
    text: `mode ${ui.pc.gray(storageMode)} · layout ${ui.pc.gray(eventLayout)} · path ${ttHome}`,
  });

  const userIdStrategy = process.env.TT_USER_ID_STRATEGY || "email";
  const resolvedUserId = getUserId();
  storage.items.push({
    level: "ok",
    text: `user_id strategy ${ui.pc.gray(userIdStrategy)} · resolved ${ui.pc.gray(resolvedUserId)}`,
  });

  try {
    const repos = await listRepos();
    const stale = [];
    let missing = 0;
    let aged = 0;
    for (const repo of repos) {
      const st = getRepoStaleness(repo, { maxAgeDays: 30 });
      if (!st.stale) continue;
      stale.push({ ...repo, ...st });
      if (!st.exists) missing++;
      else aged++;
    }
    const level = stale.length > 0 ? "warn" : "ok";
    storage.items.push({
      level,
      text: `repo registry ${ui.pc.gray(`${repos.length} total · ${stale.length} stale (missing ${missing}, old ${aged})`)}`,
    });
  } catch {
    storage.items.push({ level: "warn", text: "repo registry unavailable" });
  }

  try {
    const entries = await fsp.readdir(ttHome, { withFileTypes: true, recursive: true });
    let fileCount = 0;
    let totalBytes = 0;
    for (const e of entries) {
      if (e.isFile()) {
        fileCount++;
        try {
          const full = path.join(e.path || ttHome, e.name);
          const st = await fsp.stat(full);
          totalBytes += st.size;
        } catch { /* ignore */ }
      }
    }
    const mb = (totalBytes / 1024 / 1024).toFixed(1);
    storage.items.push({
      level: "ok",
      text: `${ui.pc.gray(`${fileCount} files · ${mb} MB`)}`,
    });
  } catch {
    storage.items.push({ level: "warn", text: "inaccessible" });
  }

  const oldCache = path.join(ttHome, "cache");
  if (fs.existsSync(oldCache)) {
    storage.items.push({
      level: "warn",
      text: `legacy cache at ${oldCache} (run: rm -rf ${oldCache})`,
    });
  }

  // Cursors — check both legacy and new layouts
  let cursorCount = 0;
  let cursorBad = 0;
  try {
    const pattern = path.join(CURSORS_DIR, "**", "*.json");
    const files = await glob(pattern, { nodir: true });
    for (const f of files) {
      cursorCount++;
      try {
        const raw = await fsp.readFile(f, "utf8");
        JSON.parse(raw);
      } catch {
        cursorBad++;
      }
    }
  } catch {
    // cursor dir doesn't exist yet
  }
  if (cursorCount > 0) {
    const level = cursorBad > 0 ? "warn" : "ok";
    const mark = cursorBad > 0 ? `${cursorBad}/${cursorCount} bad` : `${cursorCount} valid`;
    storage.items.push({ level, text: `cursors  ${ui.pc.gray(mark)}` });
  }

  sections.push(eventLog, pricingSection, storage);
  ui.renderDoctor({ sections });
}

module.exports = { doctor };
