# TokenTracker (TT)

<img src="./imgs/token-tracker.png" alt="TokenTracker Logo" width="400">

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)](#license)
[![Status](https://img.shields.io/badge/status-active%20development-brightgreen)](#roadmap)

```text
[tt] token-tracker v1.0.0
AI usage cost per project and per user
local-first · no external services · no database
```

I’m a designer, not a backend engineer.

This started as a small internal tool to solve a very simple question in our team:

“How much is this project actually costing us in AI?”

The data existed — but it was fragmented across tools, users, and logs.

So I tried a different approach.

**A small tool I built to understand what each project is actually costing in AI usage.**

TokenTracker is a Git-friendly, repo-local CLI for tracking AI usage cost per project and per user.

It stores append-oriented event logs inside your repository (`./.token-tracker`), partitions them per user to reduce merge conflicts, and computes cost on demand — no database, no backend, no SaaS.


Git transports and merges the event history; the CLI performs deterministic aggregation.

TokenTracker is not a dashboard or SaaS.

It is a Git-friendly accounting layer for AI usage.
This project prioritizes accurate cost accounting and practical team workflows over strict immutability or centralized control.

It’s not a perfect system — and it wasn’t designed as one.

It’s a pragmatic solution that worked well for a small team, and might be useful for others dealing with the same problem.

---

## Why TokenTracker

This project didn’t start as a product idea.

It started as a practical need: understanding AI cost at the level where work actually happens — the repository.

### Why repo-local instead of per-user dashboards?

AI usage is usually tracked per user or per tool.

But real work happens per repository.

TokenTracker makes the repository the natural boundary for cost:
- events are stored alongside the code
- teams merge usage history via Git
- cost evolves with the project itself

This enables multi-user cost tracking without any central service.

AI CLIs (Claude Code, Codex, Gemini, OpenCode) store usage locally, but that data is hard to compare and easy to lose context on.

| Problem | TokenTracker approach |
|---------|-----------------------|
| Per-provider siloed logs | Unified multi-provider view |
| Weak project visibility | Project-first aggregation |
| Missing/unknown model prices | Explicit missing-pricing diagnostics (`tt doctor`) |
| Fragile derived caches | Append-oriented event log + pure aggregation |

This approach came from experimenting, not from trying to design a perfect system upfront.

### What you can answer quickly

- Which project is driving most cost
- Which model dominates your spend
- How much you spent today / this week
- Whether you have events with missing pricing

### Core design choices

- **Repo-local storage by default**: cost is tied to the repository, not the tool or machine
- **Git-compatible event logs**: JSONL append semantics designed to work with Git merges
- **Per-user partitioning**: one file per user per day to minimize merge conflicts
- **Append-oriented log with compaction**: raw history preserved until optional aggregation
- **Deterministic aggregation**: no background jobs, no cached summaries

This design is intentional: event files are partitioned per user and per day to minimize Git merge conflicts in collaborative environments.

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

# Top projects only in the current repo
tt projects --local

# Current project only
tt project
tt project daily
tt project weekly

# User ranking (when collaborating)
tt users
tt users daily
tt users weekly
tt project users

# Filter by user
tt --user alice@example.com

# Health and diagnostics
tt doctor

# Help
tt help
```

---

## Usage Examples

### Today Summary (`tt`)

```
[tt] token-tracker v1.0.0

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 global (today)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Claude (claude-3-5-sonnet)         86.2k tokens   $2.84
 Claude (claude-3-opus)             42.1k tokens   $1.82
 Gemini (gemini-2.0-flash)          31.5k tokens   $0.34
 ─────────────────────────────────────────────────
 Total                             159.8k tokens   $5.00

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 project (token-tracker)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Claude (claude-3-5-sonnet)         52.0k tokens   $1.71
 ─────────────────────────────────────────────────
 Total                              52.0k tokens   $1.71
```

### Daily Summary (`tt daily`)

```
[tt] daily

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 global (last 7 days)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Date         Claude          Gemini          OpenCode       Total Cost
 ─────────────────────────────────────────────────────────────────────
 2026-05-04   $5.00           $0.34           —              $5.34
 2026-05-03   $8.21           $0.87           $0.45          $9.53
 2026-05-02   $6.54           $0.12           —              $6.66
 2026-05-01   $12.34          $1.23           $2.10          $15.67
 2026-04-30   $4.18           $0.56           —              $4.74
 2026-04-29   $7.89           $0.34           $0.67          $8.90
 2026-04-28   $9.12           $0.78           $1.23          $11.13
 ─────────────────────────────────────────────────────────────────────
 TOTAL       $53.28          $4.24           $4.45          $61.97
```

### Projects Overview (`tt projects`)

```
[tt] projects

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Top Projects (last 7 days, cross-repo)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Project Name          Tokens    Claude    Gemini    OpenCode   Cost
 ─────────────────────────────────────────────────────────────────────
 token-tracker       298.2k    $12.34    $0.56     —          $12.90
 planton-lp          512.4k    $21.87    $2.34     $1.45      $25.66
 next-app            234.1k    $10.21    $1.12     $0.34      $11.67
 python-utils        156.3k    $6.78     $0.22     —          $7.00
 ─────────────────────────────────────────────────────────────────────
 TOTAL             1,201.0k    $51.20    $4.24     $1.79      $57.23
```

### Users Breakdown (`tt users`)

```
[tt] users (today)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Ranking by Cost (today)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 User                      Tokens    Models Used              Cost
 ─────────────────────────────────────────────────────────────────────
 wagner.rosa@planton.eco   86.2k     claude-3-5-sonnet       $2.84
 alice@example.com         52.1k     claude-3-opus, gemini   $2.12
 bob@example.com           21.5k     claude-3-5-sonnet       $0.71
 ─────────────────────────────────────────────────────────────────────
 TOTAL                    159.8k                             $5.67
```

### Project with Users (`tt project users`)

```
[tt] project users (token-tracker)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 token-tracker — Users (today)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 User                      Tokens    claude-3-5   claude-3-opus   Cost
 ─────────────────────────────────────────────────────────────────────
 wagner.rosa@planton.eco   52.0k     52.0k        —              $1.71
 ─────────────────────────────────────────────────────────────────────
 TOTAL                     52.0k     52.0k        —              $1.71
```

### Health Diagnostics (`tt doctor`)

```
[tt] doctor

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Storage & Configuration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Storage Mode            repo-local
 Storage Path            ./.token-tracker
 Layout Version          A (per-user per-day files)
 User ID Strategy        email
 Pricing Cache TTL       1h

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Event Files
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Total Events            1,247
 Sources                 claude, gemini, opencode
 Date Range              2026-04-15 to 2026-05-04
 Missing Pricing         0 events (✓)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Repo Registry
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Registered Repos        3
 Last Updated            2 days ago
 Status                  ✓ healthy

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Conclusion              ✓ All systems nominal
```

---

## Storage Mode

TokenTracker uses the filesystem (and optionally Git) as its storage layer.

Instead of a database or central service, event logs live:
- per repository (default)
- or globally (`~/.token-tracker`)

When used in a repo, Git becomes the transport and merge layer for multi-user usage.

TokenTracker resolves storage lazily with this precedence:

1. `TT_HOME`
2. `TT_STORAGE=global`
3. current Git repo: `./.token-tracker`
4. fallback global: `~/.token-tracker`


In practice, this means:

- In repo mode, the repository becomes the primary boundary for cost tracking, but some events may still be stored globally depending on their origin.
- inside a Git repo, default storage is `./.token-tracker`
- outside a Git repo, default storage is `~/.token-tracker`

### Per-repository storage

When you run `tt` inside a Git repository, TokenTracker automatically detects it and uses `./.token-tracker` as the storage location instead of the global directory.

**Benefits:**
- Events are versioned alongside your code
- Team members can consolidate usage costs in a single repository view
- No cross-project event leakage: events scoped to their origin project are isolated
- `tt projects` can still recover a solo developer's cross-repo view through a repo registry in `~/.token-tracker/repos.json`

### Cross-repo projects view

`tt projects` is the only command that reads across repositories.

- It merges events from the current repo, the global store, and all repos registered in `~/.token-tracker/repos.json`
- Repos are registered automatically whenever `tt` ingests events inside a repo
- Duplicates are removed by `dedup_key` when the same event exists in more than one place

Use these modes depending on what you want:

```bash
# Cross-repo view (default)
tt projects

# Only the current repo
tt projects --local
```

**Setup for team repos (recommended):**

Add to your repo's `.gitattributes`:
```
# Per-user per-day event files + compacted archive
.token-tracker/events/**/*.jsonl merge=union
```

Add to your repo's `.gitignore`:
```
# TokenTracker state (local to each developer, never commit)
.token-tracker/cache/
.token-tracker/cursors/
.token-tracker/pricing.json
```

**Resolving merge conflicts:**

If two team members commit events for the same date/user, Git's `merge=union` strategy automatically combines lines (events). If conflicts still occur, manually merge the JSONL files:
```bash
# Both sides have .token-tracker/events/claude/2026-04-21/alice@example.com.jsonl
git checkout --theirs .token-tracker/events/claude/2026-04-21/alice@example.com.jsonl
# Then re-run: tt (to aggregate with both sets of events)
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

### Why this works for teams

TokenTracker avoids most Git conflicts by design:

- each user writes to their own file (`{user_id}.jsonl`)
- files are partitioned per day
- JSONL append-oriented format works well with line-based merges

Git does not understand events — it merges lines.
TokenTracker handles aggregation and deduplication at runtime.
This approach trades some guarantees (like strict immutability or centralized identity)
for simplicity, transparency, and Git-native collaboration.

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
tt projects --local
tt project
tt project daily
tt project weekly
```

### Users

```bash
tt users
tt users daily
tt users weekly
tt project users
tt project users daily
tt project users weekly
```

### Context-aware usage

When you run `tt` inside a Git repository, the default output is split into two blocks:

- `global` for today's overall usage in the current storage
- `project (name)` for the current repository, filtered by `project_path`

The same split applies to `tt daily` and `tt weekly`.

`tt users` is a separate user-ranking command with these periods:

- `tt users` for today
- `tt users daily` for the last 7 days
- `tt users weekly` for the last 4 weeks

Use `tt project` or `tt project users` for focused project-only output with no global block.

### Users (team collaboration)

```bash
tt users
tt users daily
tt users weekly
tt project users
tt project users daily
tt project users weekly
tt --user alice@example.com
tt --by-user
tt --by-user --json
```

`tt --by-user` is still supported for compatibility, but `tt users` is the preferred command.

### Archiving and rotation

For large repos, compact old events to reduce JSONL file count:

```bash
# Preview impact (no files modified)
tt compact --before 2026-01-01 --dry-run

# Apply (requires --yes to confirm)
tt compact --before 2026-01-01 --yes

# This aggregates and removes raw events older than the date,
# replacing them with compacted summaries in .token-tracker/events/_compact/
```

**When to compact:**
- After 1+ month of team usage (100s of events accumulating)
- Before archiving old quarters for audit trail
- If `.token-tracker/` directory size exceeds your Git limits

**What happens:**
- Raw JSONL files (older than `--before`) are aggregated by `(date, source, model, user_id, project_id)`
- Each aggregate is a single event with `compacted: true` and `compacted_count: N`
- Totals (tokens, cost) are preserved exactly
- Original files are deleted; `.token-tracker/events/_compact/{source}/{date}.jsonl` holds the archive
- Re-running `tt compact` is idempotent: existing archive is merged, totals stay exact

### Diagnostics

```bash
tt doctor
```

Shows storage mode, layout version, user_id strategy, repo registry health, and event health.

### Help

```bash
tt help
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
                    Events are deduped, tagged with user_id, and scoped:
                    - Default: ./.token-tracker/events/{source}/{date}/{user_id}.jsonl
                    - Legacy B: ./.token-tracker/events/{source}/{date}.jsonl when TT_EVENT_LAYOUT=B
                    - Global mode mirrors the same layouts under ~/.token-tracker/events/
                                  |
                                  v
                          Cursors (per-user, local state):
                    - Repo mode: ./.token-tracker/cursors/{source}/{user_id}.json
                    - Global: ~/.token-tracker/cursors/{source}/{user_id}.json
                                  |
                                  v
                  Optional: compact old events (archive to _compact/)
                          (preserves totals, reduces file count)
                                  |
                                  v
                          aggregate(events) on-demand
                          (by period, project, user, model)
                                  |
                                  v
                         pricing.js (MODELS + LiteLLM cache)
```

Note:
- Git is responsible for transporting and merging event files
- TokenTracker performs all aggregation and accounting in-process

1. Parsers read local logs and emit deduplicated `UsageEvent`s tagged with `user_id`
1. Events are appended to storage (repo or global) under `events/{source}/{YYYY-MM-DD}/{user_id}.jsonl` by default, or `events/{source}/{YYYY-MM-DD}.jsonl` when `TT_EVENT_LAYOUT=B`
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
  events/{source}/{YYYY-MM-DD}/{user_id}.jsonl  # layout A (default): per-user per-day files (designed to reduce Git merge conflicts in team environments)
  events/_compact/{source}/{YYYY-MM-DD}.jsonl   # aggregated events (via tt compact)
  cursors/{source}/{user_id}.json               # dedup state (per user, local)
  pricing.json                                  # LiteLLM cache (TTL 1h)
  config.json                                   # onboarding flag
```

**Storage layout options:**
- **Layout A** (default): `events/{source}/{YYYY-MM-DD}/{user_id}.jsonl` — one file per user per day
  - Better for multi-user repos: fewer merge conflicts (each user writes their own file)
  - Use `tt compact --before <date> --yes` to aggregate old events into `_compact/`
- **Layout B** (legacy): `events/{source}/{YYYY-MM-DD}.jsonl` — all users in one daily file
  - Set `export TT_EVENT_LAYOUT=B` to opt out of layout A

**Repo-local files (in `.gitignore`):**
- `cursors/` — never commit (local state, regenerated per developer)
- `cache/` — legacy caches (auto-cleaned by `tt doctor`) 

**Repo-shared files (committed):**
- `events/{source}/` — shared event history (events from all team members)
- `events/_compact/{source}/` — archived aggregated events (created by `tt compact`)
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
| Storage | Done | Per-repo storage + user_id + collaboration + layout A + `tt compact` |
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
