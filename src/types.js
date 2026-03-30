"use strict";

const os = require("os");
const path = require("path");

const CACHE_VERSION = 1;
const TT_HOME = path.join(os.homedir(), ".token-tracker");
const CACHE_DIR = path.join(TT_HOME, "cache");

function createUsageEntry(data = {}) {
  return {
    timestamp: data.timestamp || null,
    source: data.source || null,
    provider: data.provider || null,
    model: data.model || null,
    input_tokens: data.input_tokens || 0,
    output_tokens: data.output_tokens || 0,
    cache_read_tokens: data.cache_read_tokens || 0,
    cache_creation_tokens: data.cache_creation_tokens || 0,
    thinking_tokens: data.thinking_tokens || 0,
    cost_usd: data.cost_usd ?? null,
    message_id: data.message_id || null,
    request_id: data.request_id || null,
    project: data.project || null,
    dedup_key: data.dedup_key || null,
  };
}

function createDailySummary(data = {}) {
  return {
    date: data.date || null,
    source: data.source || null,
    total_input_tokens: data.total_input_tokens || 0,
    total_output_tokens: data.total_output_tokens || 0,
    cache_read_tokens: data.cache_read_tokens || 0,
    cache_creation_tokens: data.cache_creation_tokens || 0,
    thinking_tokens: data.thinking_tokens || 0,
    total_cost_usd: data.total_cost_usd || 0,
    models: data.models || {},
  };
}

module.exports = {
  CACHE_VERSION,
  TT_HOME,
  CACHE_DIR,
  createUsageEntry,
  createDailySummary,
};
