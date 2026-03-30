"use strict";

/**
 * Normalize a model name to canonical form.
 * - Dots to hyphens: "claude-opus-4.5" → "claude-opus-4-5"
 * - Remove 8-digit date suffix: "claude-sonnet-4-20250514" → "claude-sonnet-4"
 */
function normalizeModelName(model) {
  if (!model) return model;

  // Step 1: replace dots with hyphens
  let normalized = model.replace(/\./g, "-");

  // Step 2: remove trailing 8-digit date suffix (starts with "20")
  const match = normalized.match(/^(.*)-(\d{8})$/);
  if (match && match[2].startsWith("20")) {
    normalized = match[1];
  }

  return normalized;
}

/**
 * Convert normalized model name to human-readable display name.
 */
function displayName(normalized) {
  if (!normalized) return "";

  // Claude: claude-{family}-{version} → {Family} {version}
  if (normalized.startsWith("claude-")) {
    return parseClaudeName(normalized.slice("claude-".length));
  }

  // GPT: gpt-{variant}...
  if (normalized.startsWith("gpt-")) {
    return parseGptName(normalized.slice("gpt-".length));
  }

  // Gemini: gemini-{version}-{tier}
  if (normalized.startsWith("gemini-")) {
    return parseGeminiName(normalized.slice("gemini-".length));
  }

  // Codex: codex-{variant}(-latest)
  if (normalized.startsWith("codex-")) {
    return parseCodexName(normalized.slice("codex-".length));
  }

  // o-series: o{N}, o{N}-mini, etc.
  if (/^o\d/.test(normalized)) {
    return parseOSeries(normalized);
  }

  return normalized;
}

function capitalize(s) {
  if (!s) return "";
  return s[0].toUpperCase() + s.slice(1);
}

function parseClaudeName(rest) {
  // "opus-4-5" → family="opus", version="4-5" → "Opus 4.5"
  const idx = rest.indexOf("-");
  if (idx === -1) return `Claude ${capitalize(rest)}`;
  const family = capitalize(rest.slice(0, idx));
  const version = rest.slice(idx + 1).replace(/-/g, ".");
  return `${family} ${version}`;
}

function parseGptName(rest) {
  // "4o" → "GPT-4o"
  // "4o-mini" → "GPT-4o Mini"
  // "4-1" → "GPT-4.1"
  // "4-1-mini" → "GPT-4.1 Mini"
  // "4-turbo" → "GPT-4 Turbo"
  const parts = rest.split("-");
  const variant = parts[0];

  if (
    parts.length >= 2 &&
    parts[1].length <= 2 &&
    /^\d+$/.test(parts[1])
  ) {
    // Minor version
    const version = `${variant}.${parts[1]}`;
    if (parts.length > 2) {
      const suffix = parts.slice(2).map(capitalize).join(" ");
      return `GPT-${version} ${suffix}`;
    }
    return `GPT-${version}`;
  }

  if (parts.length > 1) {
    const suffix = parts.slice(1).map(capitalize).join(" ");
    return `GPT-${variant} ${suffix}`;
  }

  return `GPT-${rest}`;
}

function parseGeminiName(rest) {
  // "2-5-pro" → "Gemini 2.5 Pro"
  const parts = rest.split("-");
  const versionParts = [];
  const tierParts = [];

  for (const part of parts) {
    if (/^\d+$/.test(part) && tierParts.length === 0) {
      versionParts.push(part);
    } else {
      tierParts.push(capitalize(part));
    }
  }

  const version = versionParts.join(".");
  const tier = tierParts.join(" ");
  return tier ? `Gemini ${version} ${tier}` : `Gemini ${version}`;
}

function parseCodexName(rest) {
  // "mini-latest" → "Codex Mini", "mini" → "Codex Mini"
  const stripped = rest.replace(/-latest$/, "");
  if (!stripped) return "Codex";
  const parts = stripped.split("-").map(capitalize).join(" ");
  return `Codex ${parts}`;
}

function parseOSeries(name) {
  // "o1" → "o1", "o1-mini" → "o1 Mini"
  const idx = name.indexOf("-");
  if (idx === -1) return name;
  const base = name.slice(0, idx);
  const suffix = name.slice(idx + 1);
  return `${base} ${capitalize(suffix)}`;
}

module.exports = { normalizeModelName, displayName };
