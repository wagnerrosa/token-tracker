"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { glob } = require("glob");
const { getTTHome } = require("./storage-path");
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
    const pattern = path.join(EVENTS_DIR, src, "*.jsonl");
    const files = await glob(pattern, { nodir: true });
    let srcCount = 0;
    const sessions = new Set();
    let lastTs = null;

    for (const f of files) {
      const date = path.basename(f, ".jsonl");
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
      text: `${ttHome}  ${ui.pc.gray(`${fileCount} files · ${mb} MB`)}`,
    });
  } catch {
    storage.items.push({ level: "warn", text: `${ttHome}  inaccessible` });
  }

  const oldCache = path.join(ttHome, "cache");
  if (fs.existsSync(oldCache)) {
    storage.items.push({
      level: "warn",
      text: `legacy cache at ${oldCache} (run: rm -rf ${oldCache})`,
    });
  }

  // Cursors
  let cursorBad = 0;
  for (const src of sources) {
    const p = path.join(CURSORS_DIR, `${src}.json`);
    try {
      const raw = await fsp.readFile(p, "utf8");
      JSON.parse(raw);
    } catch {
      cursorBad++;
    }
  }
  if (cursorBad > 0) {
    storage.items.push({ level: "warn", text: `${cursorBad} invalid cursor(s)` });
  }

  sections.push(eventLog, pricingSection, storage);
  ui.renderDoctor({ sections });
}

module.exports = { doctor };
