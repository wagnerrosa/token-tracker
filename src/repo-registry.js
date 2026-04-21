"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { getGlobalHome } = require("./storage-path");

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function parseDateOnly(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return null;
  return new Date(`${s}T00:00:00Z`);
}

function daysBetween(a, b) {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function normalizeRepoPath(repoPath) {
  if (!repoPath) return null;
  const resolved = path.resolve(repoPath);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function getRegistryPath() {
  return path.join(getGlobalHome(), "repos.json");
}

async function loadRegistry() {
  const file = getRegistryPath();
  try {
    const raw = await fsp.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.repos)) return { repos: [] };
    return { repos: parsed.repos };
  } catch {
    return { repos: [] };
  }
}

async function saveRegistry(registry) {
  const file = getRegistryPath();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(registry, null, 2) + "\n", "utf8");
}

async function listRepos() {
  const registry = await loadRegistry();
  return registry.repos
    .filter((r) => r && typeof r.path === "string")
    .map((r) => ({ path: r.path, last_seen: r.last_seen || null }));
}

async function registerRepo(repoPath, { now = todayISO() } = {}) {
  const normalized = normalizeRepoPath(repoPath);
  if (!normalized) return;

  const registry = await loadRegistry();
  const repos = registry.repos.filter((r) => r && typeof r.path === "string");
  const idx = repos.findIndex((r) => r.path === normalized);
  const entry = { path: normalized, last_seen: now };
  if (idx >= 0) repos[idx] = entry;
  else repos.push(entry);

  repos.sort((a, b) => a.path.localeCompare(b.path));
  await saveRegistry({ repos });
}

async function pruneStale({ maxAgeDays = 60, now = todayISO() } = {}) {
  const nowDate = parseDateOnly(now) || new Date();
  const registry = await loadRegistry();

  const repos = [];
  for (const entry of registry.repos || []) {
    if (!entry || typeof entry.path !== "string") continue;

    let exists = false;
    try {
      const st = await fsp.stat(entry.path);
      exists = st.isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) continue;

    const seenDate = parseDateOnly(entry.last_seen);
    if (seenDate && daysBetween(seenDate, nowDate) > maxAgeDays) continue;
    repos.push({ path: entry.path, last_seen: entry.last_seen || null });
  }

  await saveRegistry({ repos });
  return { kept: repos.length };
}

function getRepoStaleness(entry, { maxAgeDays = 30, now = todayISO() } = {}) {
  const nowDate = parseDateOnly(now) || new Date();
  const seenDate = parseDateOnly(entry.last_seen);

  let exists = false;
  try {
    exists = fs.existsSync(entry.path);
  } catch {
    exists = false;
  }

  const ageDays = seenDate ? daysBetween(seenDate, nowDate) : null;
  const staleByAge = ageDays != null && ageDays > maxAgeDays;
  const stale = !exists || staleByAge;
  return { stale, exists, ageDays };
}

module.exports = {
  getRegistryPath,
  loadRegistry,
  saveRegistry,
  listRepos,
  registerRepo,
  pruneStale,
  getRepoStaleness,
  _internal: { todayISO, normalizeRepoPath, parseDateOnly, daysBetween },
};
