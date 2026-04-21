"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { getTTHome } = require("../storage-path");

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

function getCachePath() { return path.join(getTTHome(), "pricing.json"); }
const CACHE_TTL_MS = 60 * 60 * 1000;

// Canonical model table. Key = litellm_key used in pricing lookup.
const MODELS = {
  "claude-opus-4-7": {
    display: "Opus 4.7",
    aliases: [],
  },
  "claude-opus-4-6": {
    display: "Opus 4.6",
    aliases: ["claude-opus-4-6-20260301", "claude-opus-4.6"],
  },
  "claude-sonnet-4-6": {
    display: "Sonnet 4.6",
    aliases: ["claude-sonnet-4-6-20261231"],
  },
  "claude-haiku-4-5": {
    display: "Haiku 4.5",
    aliases: ["claude-haiku-4-5-20251001", "claude-haiku-4.5"],
  },
  "deepseek/deepseek-v3.2-exp": {
    display: "DeepSeek V3.2 Exp",
    aliases: ["deepseek-v3.2-exp"],
  },
};

// Reverse index: alias → canonical key
const _aliasMap = new Map();
for (const [canonical, info] of Object.entries(MODELS)) {
  for (const alias of info.aliases) {
    _aliasMap.set(alias, canonical);
  }
}

function resolveModel(rawId) {
  if (!rawId) return { display: rawId, canonical: rawId };
  if (MODELS[rawId]) return { display: MODELS[rawId].display, canonical: rawId };
  const via = _aliasMap.get(rawId);
  if (via) return { display: MODELS[via].display, canonical: via };
  return { display: rawId, canonical: rawId };
}

let _cache = null;

function loadCacheFromDisk() {
  try {
    const raw = fs.readFileSync(getCachePath(), "utf8");
    const data = JSON.parse(raw);
    if (data && data.fetched_at && data.models) return data;
  } catch {
    // ignore
  }
  return null;
}

function saveCacheToDisk(cache) {
  try {
    fs.mkdirSync(getTTHome(), { recursive: true });
    fs.writeFileSync(getCachePath(), JSON.stringify(cache, null, 2));
  } catch {
    // ignore
  }
}

function fetchPricing() {
  return new Promise((resolve, reject) => {
    const req = https.get(LITELLM_URL, { timeout: 10000 }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          const models = JSON.parse(body);
          resolve({ fetched_at: Date.now(), models });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

async function getCache() {
  if (_cache && Date.now() - _cache.fetched_at < CACHE_TTL_MS) return _cache;

  const disk = loadCacheFromDisk();
  if (disk && Date.now() - disk.fetched_at < CACHE_TTL_MS) {
    _cache = disk;
    return _cache;
  }

  try {
    const fresh = await fetchPricing();
    saveCacheToDisk(fresh);
    _cache = fresh;
    return _cache;
  } catch {
    if (disk) {
      _cache = disk;
      return _cache;
    }
    return null;
  }
}

async function computeCost(model, tokens) {
  const { canonical } = resolveModel(model);
  try {
    const cache = await getCache();
    if (!cache) return { cost_usd: null, cost_source: null };

    const pricing = cache.models[canonical];
    if (!pricing) {
      if (process.env.TT_DEBUG) {
        console.error(`[pricing] unknown model: ${model} (canonical: ${canonical})`);
      }
      return { cost_usd: null, cost_source: null };
    }

    const input = (tokens.input_tokens || 0) * (pricing.input_cost_per_token || 0);
    const output = (tokens.output_tokens || 0) * (pricing.output_cost_per_token || 0);
    const cacheRead = (tokens.cache_read_tokens || 0) * (pricing.cache_read_input_token_cost || 0);
    const cacheWrite = (tokens.cache_write_tokens || 0) * (pricing.cache_creation_input_token_cost || 0);

    return { cost_usd: input + output + cacheRead + cacheWrite, cost_source: "computed" };
  } catch {
    return { cost_usd: null, cost_source: null };
  }
}

// Legacy wrapper for cache.js (warm/cold path — removed in N4)
async function getCost(entry) {
  if (entry.cost_usd !== null && entry.cost_usd !== undefined) {
    return entry.cost_usd;
  }
  const result = await computeCost(entry.model, entry);
  return result.cost_usd ?? 0;
}

module.exports = { getCost, getCache, computeCost, resolveModel, get CACHE_PATH() { return getCachePath(); }, MODELS };
