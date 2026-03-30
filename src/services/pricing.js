"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { TT_HOME } = require("../types");
const { normalizeModelName } = require("./normalizer");

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const CACHE_PATH = path.join(TT_HOME, "pricing.json");
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let _cache = null; // in-memory cache

function loadCacheFromDisk() {
  try {
    const raw = fs.readFileSync(CACHE_PATH, "utf8");
    const data = JSON.parse(raw);
    if (data && data.fetched_at && data.models) return data;
  } catch {
    // ignore
  }
  return null;
}

function saveCacheToDisk(cache) {
  try {
    fs.mkdirSync(TT_HOME, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch {
    // ignore — pricing cache is best-effort
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
  // In-memory cache still valid
  if (_cache && Date.now() - _cache.fetched_at < CACHE_TTL_MS) {
    return _cache;
  }

  // Try disk cache
  const disk = loadCacheFromDisk();
  if (disk && Date.now() - disk.fetched_at < CACHE_TTL_MS) {
    _cache = disk;
    return _cache;
  }

  // Fetch fresh
  try {
    const fresh = await fetchPricing();
    saveCacheToDisk(fresh);
    _cache = fresh;
    return _cache;
  } catch {
    // Fallback: use expired disk cache if available
    if (disk) {
      _cache = disk;
      return _cache;
    }
    return null;
  }
}

function getPricingForModel(models, model) {
  if (!model || !models) return null;

  // 1. Exact match
  if (models[model]) return models[model];

  // 2. Normalized match
  const normalized = normalizeModelName(model);
  if (normalized !== model && models[normalized]) return models[normalized];

  // 3. Fuzzy substring (longest key wins, skip provider-prefixed keys)
  const lower = normalized.toLowerCase();
  let best = null;
  let bestLen = 0;

  for (const [key, pricing] of Object.entries(models)) {
    if (key.includes("/")) continue; // skip azure/, openrouter/, etc.
    const keyLower = key.toLowerCase();
    if (keyLower && lower.includes(keyLower) && key.length > bestLen) {
      best = pricing;
      bestLen = key.length;
    }
  }

  return best;
}

/**
 * Calculate cost for a UsageEntry.
 * - If entry.cost_usd is set: return it directly.
 * - Otherwise: look up pricing table and calculate.
 * - Fallback: return 0 (never throws).
 */
async function getCost(entry) {
  if (entry.cost_usd !== null && entry.cost_usd !== undefined) {
    return entry.cost_usd;
  }

  try {
    const cache = await getCache();
    if (!cache) return 0;

    const pricing = getPricingForModel(cache.models, entry.model);
    if (!pricing) return 0;

    const input =
      (entry.input_tokens || 0) * (pricing.input_cost_per_token || 0);
    const output =
      (entry.output_tokens || 0) * (pricing.output_cost_per_token || 0);
    const cacheRead =
      (entry.cache_read_tokens || 0) *
      (pricing.cache_read_input_token_cost || 0);
    const cacheCreation =
      (entry.cache_creation_tokens || 0) *
      (pricing.cache_creation_input_token_cost || 0);

    return input + output + cacheRead + cacheCreation;
  } catch {
    return 0;
  }
}

module.exports = { getCost, getCache, CACHE_PATH };
