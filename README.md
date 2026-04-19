# TokenTracker (TT)

**Rastreia uso de tokens de LLMs por projeto e usuário.**

Observabilidade local-first para consumo de IA. Sem banco de dados, sem serviços externos. Event log append-only como fonte de verdade.

---

## Por quê

Ferramentas de IA (Claude Code, Codex, Gemini, OpenCode) registram dados de uso localmente, mas esses dados:
- São apagados após 30 dias
- Não têm agregação por projeto
- Não mostram custos reais
- Não rastreiam uso por time

**TokenTracker** lê esses logs locais e oferece:
- Resumo unificado por dia/semana/projeto — todos os providers em uma visão
- Custo real via [LiteLLM pricing](https://github.com/BerriAI/litellm) com cache local
- `project_id` promovido a coluna de primeira classe no schema
- Event log append-only em `~/.token-tracker/events/{source}/{date}.jsonl`
- `tt doctor` para auditar saúde do sistema

---

## Instalação

```bash
npm install
npm install -g .
```

Agora `tt` funciona em qualquer diretório.

---

## Uso

### Resumo de hoje

```bash
tt
```

```
Hoje (2026-04-19)

  Input:   543
  Output:  87.2k
  Cache ↑: 20.3M
  Custo:   $11.0346

  Modelos:
    Opus 4.7                             $5.9231  (86x)
    Sonnet 4.6                           $4.1150  (130x)
    Haiku 4.5                            $0.9965  (67x)
```

### Últimos 7 dias / semanas

```bash
tt daily
tt weekly
tt daily --json    # saída JSON para scripts
```

### Projetos

```bash
tt projects              # ranking de projetos por custo
tt --project .           # filtra pelo projeto do cwd (via realpath)
tt daily --project .     # combinável com subcomandos
```

### Auditoria

```bash
tt doctor                # reporta estado do event log, cursores, modelos sem pricing
```

---

## Providers suportados

| Provider | Fonte de dados | Observações |
|----------|---------------|-------------|
| **Claude Code** | `~/.claude/projects/**/*.jsonl` | `costUSD` nativo, `project_path` via campo `cwd` |
| **Codex** | `~/.codex/sessions/**/*.jsonl` | Delta tracking stateful (cursor persiste `prev_totals_by_session`) |
| **Gemini** | `~/.gemini/tmp/*/chats/session-*.json` | thinking_tokens suportado |
| **OpenCode** | `~/.local/share/opencode/**/msg_*.json` | reasoning_tokens + cache read/write |

Todos os providers são agregados em uma única visão unificada.

---

## Como funciona

```
~/.claude/...            ─┐
~/.codex/...              ─┤                       events/{source}/{date}.jsonl
~/.gemini/...             ─┼─→ Parsers (com cursor) ─→ append-only (source of truth)
~/.local/share/opencode/  ─┘                                        │
                                                                    │
                                                      ┌─────────────┴─────────────┐
                                                      ▼                           ▼
                                                aggregate(events)           pricing.js
                                                 (função pura)              (tabela MODELS
                                                      │                     + LiteLLM)
                                                      ▼
                                                 CLI / doctor
```

1. **Parsers especializados** — lêem logs locais, emitem `UsageEvent` deduplicado via cursor
2. **Event log append-only** — arquivos `events/{source}/{YYYY-MM-DD}.jsonl`, zero reescrita
3. **Cursor atômico** — `cursors/{source}.json` persiste `seen_keys_today` + `source_specific`
4. **Pricing determinístico** — tabela `MODELS` com aliases + LiteLLM table (sem fuzzy matching)
5. **Agregação pura** — `aggregate(events, {granularity, project, since, until})` sem classes, sem cache

---

## Arquitetura

```
src/
  parsers/
    claude.js              # Claude Code JSONL, detecta project via data.cwd
    codex.js               # Codex delta tracking (cursor-based)
    gemini.js              # Gemini CLI
    opencode.js            # OpenCode CLI
    index.js               # Registry
  services/
    pricing.js             # Tabela MODELS + resolveModel + computeCost
  types/
    event.js               # createEvent, entryToEvent, toProjectFields
  types.js                 # UsageEntry + constantes
  event-log.js             # append, read, cursor, ingestAll, enrichCosts
  aggregate.js             # aggregate (pura) + byProject
  doctor.js                # tt doctor — auditoria
  cli.js                   # Entry point
```

### Modelo de dados

**UsageEvent** — único tipo persistido:
```js
{
  id,                    // timestamp(base36) + 8 hex bytes
  ts,                    // ISO 8601
  source,                // claude|codex|gemini|opencode
  model,
  input_tokens,
  output_tokens,
  cache_read_tokens,
  cache_write_tokens,
  reasoning_tokens,
  cost_usd,              // null = pricing indisponível, >0 = custo real
  cost_source,           // native | computed | null
  project_id,            // slug ASCII-safe estável entre máquinas
  project_path,          // realpath local (usado por --project .)
  session_id,
  dedup_key              // idempotência no ingest
}
```

**DailySummary** — computado on-demand por `aggregate()`, não persistido.

### Storage

```
~/.token-tracker/
  events/{source}/{YYYY-MM-DD}.jsonl    # source of truth
  cursors/{source}.json                  # dedup + source-specific state
  pricing.json                           # cache LiteLLM (TTL 1h)
```

Nada de `cache/{source}_daily.json`. Nada de warm/cold path. Nada de `mergeAllSummaries`.

---

## Pricing

- Cache local em `~/.token-tracker/pricing.json` (TTL 1h, fonte: LiteLLM)
- Tabela `MODELS` em [`src/services/pricing.js`](src/services/pricing.js) com aliases explícitos
- `resolveModel(rawId)` → lookup direto + aliases + fallback (sem fuzzy substring)
- Claude usa `costUSD` nativo quando disponível → `cost_source: "native"`
- Eventos sem pricing: `cost_usd: null` + `cost_source: null` (nunca falha silencioso)
- `has_missing_pricing: true` aparece em agregações com eventos incompletos

---

## Roadmap

| Fase | Status | Descrição |
|------|--------|-----------|
| 1-11a | ✅ | Rebuild + multi-provider (parsers, CLI, proxy, pricing) |
| 12-15 | ✅ | Data validation, pricing robustness, stability, project tracking |
| **N1-N6** | ✅ | **Migração arquitetural: event log + aggregate puro + project-first** |
| 16 | ⏳ | Performance guardrails + benchmarks |
| 17 | ⏳ | Watch mode — `tt watch` com fs.watch() |
| 18 | ⏳ | API REST — GET /api/summary, /api/daily, /api/projects |
| 19 | ⏳ | Dashboard web |

Histórico completo em [env/8_architecture_migration.md](env/8_architecture_migration.md) e [env/9_project_status_2026-04-19.md](env/9_project_status_2026-04-19.md).

---

## Desenvolvimento

```bash
# CLI
node src/cli.js
node src/cli.js daily
node src/cli.js daily --json
node src/cli.js projects
node src/cli.js --project .
node src/cli.js doctor

# Verificar parsers
node -e "require('./src/parsers').getAll().map(p => console.log(p.name))"

# Testar parser específico
node -e "require('./src/parsers/claude').parseAll().then(e => console.log(e.length, 'entries'))"

# Inspecionar event log
ls ~/.token-tracker/events/claude/
wc -l ~/.token-tracker/events/*/*.jsonl

# Inspecionar cursor
cat ~/.token-tracker/cursors/codex.json | jq '.source_specific.prev_totals_by_session | keys | length'
```

---

## Licença

ISC
