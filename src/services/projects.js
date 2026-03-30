"use strict";

const os = require("os");
const path = require("path");

/**
 * Convert a Claude project hash to a readable name.
 * Hashes are directory paths encoded as slugs, e.g.:
 *   "-Users-wagnerrosa-Projetos-token-tracker" → "token-tracker"
 *
 * Strategy: replace leading "-" with "/", then take last path segment.
 */
function hashToName(hash) {
  if (!hash) return "(unknown)";
  // Replace slug separators back to path separators
  // The hash starts with "-" representing the root "/"
  const fullPath = hash.replace(/-/g, path.sep);
  const segments = fullPath.split(path.sep).filter(Boolean);
  return segments[segments.length - 1] || hash;
}

/**
 * Convert current working directory to the Claude project hash.
 * Inverse of hashToName logic:
 *   "/Users/wagnerrosa/Projetos/token-tracker" → "-Users-wagnerrosa-Projetos-token-tracker"
 */
function cwdToHash(dir) {
  // Normalize: replace path separators with hyphens
  return dir.replace(new RegExp("\\" + path.sep, "g"), "-");
}

/**
 * Aggregate DailySummary[] (with project breakdown) by project.
 * Returns array of { project, name, total_input_tokens, total_output_tokens, total_cost_usd, days }
 *
 * Since DailySummary doesn't carry per-project breakdown,
 * we aggregate UsageEntry[] directly by project.
 */
function aggregateByProject(entries) {
  const map = new Map();

  for (const e of entries) {
    const hash = e.project || "(unknown)";
    let p = map.get(hash);
    if (!p) {
      p = {
        project: hash,
        name: hashToName(hash),
        total_input_tokens: 0,
        total_output_tokens: 0,
        cache_read_tokens: 0,
        total_cost_usd: 0,
        count: 0,
      };
      map.set(hash, p);
    }
    p.total_input_tokens += e.input_tokens || 0;
    p.total_output_tokens += e.output_tokens || 0;
    p.cache_read_tokens += e.cache_read_tokens || 0;
    p.total_cost_usd += e.cost_usd || 0;
    p.count += 1;
  }

  return [...map.values()].sort((a, b) => b.total_cost_usd - a.total_cost_usd);
}

module.exports = { hashToName, cwdToHash, aggregateByProject };
