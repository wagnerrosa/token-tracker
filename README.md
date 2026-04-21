# TokenTracker (TT)

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)](#license)
[![Status](https://img.shields.io/badge/status-active%20development-brightgreen)](#roadmap)

**Understand what each project is actually costing in AI usage.**

TokenTracker is a local-first CLI that turns raw LLM logs into clear cost and usage insights by project, model, and time period.

No database. No external backend. Append-only event log as the source of truth.

---

## Why TokenTracker

AI CLIs (Claude Code, Codex, Gemini, OpenCode) store usage locally, but that data is hard to compare and easy to lose context on.

| Problem | TokenTracker approach |
|---------|-----------------------|
| Per-provider siloed logs | Unified multi-provider view |
| Weak project visibility | Project-first aggregation |
| Missing/unknown model prices | Explicit missing-pricing diagnostics (`tt doctor`) |
| Fragile derived caches | Append-only event log + pure aggregation |

### What you can answer quickly

- Which project is driving most cost
- Which model dominates your spend
- How much you spent today / this week
- Whether you have events with missing pricing

### Core design choices

- **Project-first**: project-level cost is a first-class outcome
- **Append-only event log**: full history, no destructive rewrites
- **Deterministic pricing**: explicit model table + aliases, no fuzzy matching
- **On-demand aggregation**: no stale view cache
- **Local by default**: your data stays on your machine

---

## Installation

```bash
npm install
npm install -g .
```

After that, `tt` is available globally.

## Quick Start

```bash
# Today summary
tt

# Last 7 days
tt daily

# Last 4 weeks
tt weekly

# Top projects in the last 7 days
tt projects

# Scope to current working directory project
tt --project .

# User ranking (when collaborating)
tt --by-user

# Filter by user
tt --user alice@example.com

# Health and diagnostics
tt doctor
```

---

## Storage Mode

By default, TokenTracker stores data in `~/.token-tracker` (global, shared across all projects on your machine).

Starting with Phase 2, you can also store data **per-repository** in `./.token-tracker`, enabling version control and team collaboration:

### Per-repository storage

When you run `tt` inside a Git repository, TokenTracker automatically detects it and uses `./.token-tracker` as the storage location instead of the global directory.

**Benefits:**
- Events are versioned alongside your code
- Team members can consolidate usage costs in a single repository view
- No cross-project event leakage: events scoped to their origin project are isolated

**Setup (optional):**

Add to your repo's `.gitattributes`:
```
.token-tracker/events/**/*.jsonl merge=union
```

Add to your repo's `.gitignore`:
```
# TokenTracker state (local to each developer)
.token-tracker/cache/
.token-tracker/cursors/
```

### Forcing global storage

If you want to always use global storage even inside a Git repo:
```bash
export TT_STORAGE=global
tt
```

Or set it permanently in your shell config:
```bash
echo 'export TT_STORAGE=global' >> ~/.bashrc  # or ~/.zshrc
```

---

## Collaboration

When multiple team members use TokenTracker in the same repository, each contributor's events are tagged with their `user_id` (derived from `git config user.email`).

**Commands:**
```bash
# Ranking by user cost (last 7 days)
tt --by-user

# Filter events by user
tt --user alice@example.com
tt --user alice@example.com daily
```

**User identification strategy:**

By default, `user_id` is set to `git config user.email`. You can customize this:

```bash
# Use git config user.name instead
export TT_USER_ID_STRATEGY=name
tt

# Use a hashed identifier (recommended for public repos)
export TT_USER_ID_STRATEGY=hash
export TT_USER_ID_SALT="my-repo-salt"  # optional salt for hash
tt
```

---

## Privacy

For repositories that might be public or shared, use the `hash` strategy to anonymize user identities:

```bash
# In your repo's .env or shell profile
export TT_USER_ID_STRATEGY=hash
export TT_USER_ID_SALT="unique-salt-per-team"
```

This replaces email/name with a truncated SHA256 hash, making events anonymous while still preserving per-user aggregation.

---

## Usage

### Today summary

```bash
tt
```

### Daily / Weekly

```bash
tt daily
tt weekly
tt daily --json
```

### Projects

```bash
tt projects
tt --project .
tt daily --project .
```

### Users (team collaboration)

```bash
tt --by-user
tt --user alice@example.com
tt --by-user --json
```

### Diagnostics

```bash
tt doctor
```

### Help

```bash
tt --help
```

---

## Supported Providers

| Provider | Data source | Notes |
|----------|-------------|-------|
| **Claude Code** | `~/.claude/projects/**/*.jsonl` | Native `costUSD` when available, project path from `cwd` |
| **Codex** | `~/.codex/sessions/**/*.jsonl` | Stateful delta tracking via cursor (`prev_totals_by_session`) |
| **Gemini** | `~/.gemini/tmp/*/chats/session-*.json` | Supports `thinking_tokens` |
| **OpenCode** | `~/.local/share/opencode/**/msg_*.json` | Supports reasoning + cache read/write tokens |

All providers are merged into one unified model for reporting.

---

## How It Works

```text
~/.claude/...            --\
~/.codex/...              --+--> Parsers (cursor-aware, user_id from git config)
~/.gemini/...             --/                               
~/.local/share/opencode/ --/                                
                                  |
                                  v
                    Events are deduped and scoped:
                    - If in Git repo: ./.token-tracker/events/...
                    - Otherwise: ~/.token-tracker/events/...
                                  |
                                  v
                          Cursors (per-user):
                    - Repo mode: ./.token-tracker/cursors/{source}/{user_id}.json
                    - Global: ~/.token-tracker/cursors/{source}/{user_id}.json
                                  |
                                  v
                          aggregate(events) on-demand
                          (by period, project, user)
                                  |
                                  v
                         pricing.js (MODELS + LiteLLM cache)
```

1. Parsers read local logs and emit deduplicated `UsageEvent`s tagged with `user_id`
1. Events are appended to storage (repo or global) under `events/{source}/{YYYY-MM-DD}.jsonl`
1. Cursor state is saved atomically under `cursors/{source}/{user_id}.json` (per-user partition)
4. Pricing is resolved via deterministic model aliases + LiteLLM pricing cache
5. Aggregation is computed on demand with pure functions, supporting `byProject()`, `byUser()`, and time periods

---

## Data Model

`UsageEvent` is the only persisted domain event:

```js
{
  id,
  ts,
  source,                // claude | codex | gemini | opencode
  model,
  input_tokens,
  output_tokens,
  cache_read_tokens,
  cache_write_tokens,
  reasoning_tokens,
  cost_usd,              // null = unknown pricing
  cost_source,           // native | computed | null
  project_id,            // stable ASCII-safe slug
  project_path,          // local realpath (used by --project .)
  session_id,
  user_id,               // from git config user.email (or strategy override)
  user_name,             // from git config user.name (optional)
  dedup_key              // includes user_id to prevent cross-user collisions
}
```

`DailySummary` is derived on demand by `aggregate()` and is not persisted.

---

## Storage Layout

TokenTracker stores data in either `./.token-tracker` (repo mode, when inside a Git repo) or `~/.token-tracker` (global mode).

```text
./.token-tracker/  (or ~/.token-tracker/)
  events/{source}/{YYYY-MM-DD}.jsonl      # source of truth (append-only)
  cursors/{source}/{user_id}.json         # dedup + source-specific state (per user)
  pricing.json                            # LiteLLM cache (TTL 1h)
  config.json                             # onboarding flag
```

**Repo-local files (in `.gitignore`):**
- `cursors/` — never commit (local state, regenerated per developer)
- `cache/` — legacy caches (auto-cleaned by `tt doctor`)

**Repo-shared files (committed):**
- `events/` — shared event history (use `merge=union` in `.gitattributes`)
- `pricing.json` — shared pricing cache (safe to version)

Legacy `cache/` data can still exist from older versions; `tt doctor` will flag it.

---

## Pricing Behavior

- Local pricing cache: `~/.token-tracker/pricing.json` (TTL 1 hour)
- Canonical model table and aliases in `src/services/pricing.js`
- Claude native cost is preferred when present (`cost_source: "native"`)
- Missing pricing is explicit (`cost_usd: null`, `cost_source: null`)
- Aggregates expose missing-pricing signals (`has_missing_pricing`)

---

## Roadmap

| Phase | Status | Description |
|------|--------|-------------|
| 1-11a | Done | Rebuild + multi-provider ingestion/parsers/CLI/pricing |
| 12-15 | Done | Data validation, pricing robustness, project tracking |
| N1-N6 | Done | Architecture migration: append-only event log + pure aggregate + project-first |
| 16 | Planned | Performance guardrails + benchmarks |
| 17 | Planned | Watch mode (`tt watch`) |
| 18 | Planned | REST API (`/api/summary`, `/api/daily`, `/api/projects`) |
| 19 | Planned | Web dashboard |

Detailed context is available in `env/8_architecture_migration.md` and `env/9_project_status_2026-04-19.md`.

---

## Development

```bash
# CLI
node src/cli.js
node src/cli.js daily
node src/cli.js daily --json
node src/cli.js projects
node src/cli.js --project .
node src/cli.js doctor

# List parsers
node -e "require('./src/parsers').getAll().map(p => console.log(p.name))"

# Parse one provider directly
node -e "require('./src/parsers/claude').parseAll().then(e => console.log(e.length, 'entries'))"

# Inspect event log
ls ~/.token-tracker/events/claude/
wc -l ~/.token-tracker/events/*/*.jsonl

# Inspect Codex cursor state
cat ~/.token-tracker/cursors/codex.json | jq '.source_specific.prev_totals_by_session | keys | length'
```

---

## Contributing

Contributions are welcome.

- Open an issue for bugs, edge cases, or feature proposals
- Keep PRs focused and small when possible
- Include reproduction steps for parser or pricing issues
- Run the CLI manually against your local data before opening a PR

If you are proposing provider/parser changes, include sample log shape (sanitized) and expected `UsageEvent` output.

---

## Known Limitations

- Some new model IDs may appear before they are mapped in `MODELS`
- Historical events with unknown pricing remain explicit as `cost_usd: null`
- Project detection depends on provider log metadata (for some providers it can be `null`)

Use `tt doctor` to surface these cases quickly.

---

## License

ISC
