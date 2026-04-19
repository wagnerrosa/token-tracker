"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { glob } = require("glob");
const { TT_HOME } = require("./types");
const { EVENTS_DIR, CURSORS_DIR } = require("./event-log");
const { resolveModel, MODELS } = require("./services/pricing");

async function doctor() {
  const lines = [];
  const warn = (msg) => lines.push(`⚠ ${msg}`);
  const ok = (msg) => lines.push(`✓ ${msg}`);
  const err = (msg) => lines.push(`✗ ${msg}`);

  // 1. Event log: count events per source, last 7 days
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
    err("Event log dir não encontrado: " + EVENTS_DIR);
  }

  const unknownModels = new Map(); // model → {count, tokens}

  for (const src of sources) {
    const pattern = path.join(EVENTS_DIR, src, "*.jsonl");
    const files = await glob(pattern, { nodir: true });
    let srcCount = 0;

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
  }

  const sourceSummary = [...sourceStats.entries()].map(([s, n]) => `${s}:${n}`).join(", ");
  if (totalEvents > 0) {
    ok(`Event log: ${totalEvents} eventos (últimos 7d) — ${sourceSummary}`);
  } else {
    warn("Event log: zero eventos nos últimos 7 dias");
  }

  if (corruptLines > 0) {
    warn(`${corruptLines} linha(s) inválida(s) no event log`);
  } else {
    ok("Linhas JSONL: todas válidas");
  }

  if (nullCostEvents > 0) {
    warn(`${nullCostEvents} eventos sem pricing (cost_source=null, tokens>0)`);
  } else {
    ok("Pricing: todos eventos com custo calculado");
  }

  // 2. Cursores
  let cursorOk = 0;
  let cursorBad = 0;
  for (const src of sources) {
    const p = path.join(CURSORS_DIR, `${src}.json`);
    try {
      const raw = await fsp.readFile(p, "utf8");
      JSON.parse(raw);
      cursorOk++;
    } catch {
      cursorBad++;
      warn(`Cursor inválido ou ausente: ${src}`);
    }
  }
  if (cursorBad === 0) {
    ok(`Cursores: ${cursorOk}/${sources.length} válidos`);
  }

  // 3. Modelos sem pricing
  if (unknownModels.size > 0) {
    for (const [model, { count, tokens }] of unknownModels.entries()) {
      warn(`Modelo sem pricing: ${model} (${count} eventos, ${(tokens / 1000).toFixed(1)}k tokens)`);
    }
  } else {
    ok("Modelos: todos resolvidos em MODELS");
  }

  // 4. Cache antigo
  const oldCache = path.join(TT_HOME, "cache");
  if (fs.existsSync(oldCache)) {
    warn(`Cache antigo detectado: ${oldCache}\n  Pode apagar com: rm -rf ${oldCache}`);
  } else {
    ok("Cache antigo: não encontrado");
  }

  // 5. Codex prev_totals
  const codexCursor = path.join(CURSORS_DIR, "codex.json");
  try {
    const raw = await fsp.readFile(codexCursor, "utf8");
    const c = JSON.parse(raw);
    const sessions = Object.keys((c.source_specific || {}).prev_totals_by_session || {}).length;
    if (sessions > 0) {
      ok(`Codex: ${sessions} sessões com prev_totals persistidos`);
    } else {
      warn("Codex: nenhuma sessão em prev_totals_by_session");
    }
  } catch {
    warn("Codex: cursor não encontrado");
  }

  console.log("\ntt doctor\n");
  for (const l of lines) console.log(l);
  console.log();
}

module.exports = { doctor };
