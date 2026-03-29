# TokenTracker

**Track LLM token usage per project.**

---

## Why

LLM API usage is invisible by default. Most teams have no idea how many tokens each developer consumes, which models cost the most, or how usage changes over time.

Existing solutions require centralized platforms, database setups, or vendor-specific dashboards.

TokenTracker takes a different approach:

- **Local-first** — data stays in your project directory
- **Lightweight** — single proxy server, no database
- **Developer-friendly** — works with any OpenAI-compatible client, zero config on the client side

---

## Features

- Intercepts LLM API requests via local proxy
- Tracks token usage and estimated cost per request
- Multi-user tracking based on Git identity
- CLI analytics (summary, leaderboard)
- Automatic API key injection (clients don't need the key)
- File-based storage (no external dependencies)

---

## How it works

```
Client App → localhost:4000 → OpenAI API
                  ↓
           Capture usage
                  ↓
         .token-tracker/{user}-usage.json
```

1. Your app sends requests to `http://localhost:4000` instead of `api.openai.com`
2. The proxy forwards requests to OpenAI, injecting the API key
3. On response, token usage and cost are extracted and stored locally
4. Each developer gets their own usage file, identified by `git config user.name`

---

## Installation

```bash
git clone <repo-url>
cd token-tracker
npm install
```

Create a `.env` file:

```bash
cp .env.example .env
# Edit .env and add your OpenAI API key
```

```
OPENAI_API_KEY=sk-your-key-here
```

Optional — install the CLI globally:

```bash
npm link
```

---

## Usage

### Start the proxy

```bash
npm start
# or
node server.js
```

```
[tt] Proxy running on http://localhost:4000
[tt] Using OpenAI key: sk-pr...nKcA
[tt] Logging usage for user: wagnerrosa
```

### Make a request

Point your client to `http://localhost:4000` instead of `https://api.openai.com`:

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'
```

The proxy logs each request:

```
[tt] +14 tokens (gpt-4o-mini-2024-07-18) ~$0.000003
```

### CLI

**Summary** — total usage with breakdown by user:

```bash
tt
```

```
TokenTracker — Usage Summary

  Total tokens : 217
  Total cost   : $0.010010
  Total requests: 5

  Breakdown by user:

  wagnerrosa
    tokens   : 67
    cost     : $0.000010
    requests : 4
  joao
    tokens   : 150
    cost     : $0.010000
    requests : 1
```

**Leaderboard** — users ranked by cost:

```bash
tt leaderboard
```

```
Leaderboard (by cost)

  1. joao — $0.010000 (150 tokens)
  2. wagnerrosa — $0.000010 (67 tokens)
```

---

## File structure

```
.token-tracker/
  wagnerrosa-usage.json
  joao-usage.json
```

- One file per user (derived from `git config user.name`)
- Each file contains an array of usage entries
- Append-only — new requests are added, never overwritten
- Local to the project — add to `.gitignore` or commit to track team usage

Each entry:

```json
{
  "provider": "openai",
  "model": "gpt-4o-mini-2024-07-18",
  "tokens_input": 12,
  "tokens_output": 2,
  "total_tokens": 14,
  "cost_input": 0.0000018,
  "cost_output": 0.0000012,
  "cost_total": 0.000003,
  "timestamp": "2026-03-29T19:49:51.609Z"
}
```

---

## User detection

The proxy identifies the current user via this fallback chain:

1. `git config user.name` (normalized: lowercase, no spaces)
2. `GITHUB_ACTOR` environment variable
3. `"unknown"`

---

## Roadmap

### Phase 1 — Foundations
- [ ] JSONL storage (append-only, safer writes)
- [ ] Data normalization (consistent cost + tokens)
- [ ] Stable user identity (based on Git)

### Phase 2 — Multi-provider & CLI
- [ ] Anthropic support
- [ ] CLI structure (`tt init`, `tt stats`)
- [ ] `tt init` for project setup

### Phase 3 — Analysis
- [ ] Breakdown by model
- [ ] Filter by user
- [ ] Filter by time range

### Phase 4 — Git integration
- [ ] Track repo, branch, commit per request
- [ ] Cost per PR / feature

### Phase 5 — Distribution
- [ ] Publish CLI via npm
- [ ] Stable installation flow

### Phase 6 — Export & integrations
- [ ] JSON output mode
- [ ] CSV export

### Phase 7 — Visualization
- [ ] Local dashboard

### Phase 8 — Developer experience
- [ ] CLI styling (chalk)
- [ ] Improved terminal UX

---

## License

ISC
