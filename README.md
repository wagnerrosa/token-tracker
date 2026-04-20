# TokenTracker (TT)

**Descubra quanto cada projeto realmente custa em uso de IA.**

TokenTracker é uma ferramenta CLI que transforma logs locais de LLMs em insights claros de custo, uso e consumo por projeto — sem depender de serviços externos.

Observabilidade local-first para consumo de IA. Sem banco de dados, sem serviços externos. Event log append-only como fonte de verdade.

---

## Por quê

\n## O que você descobre

- Qual projeto está gerando mais custo
- Qual modelo está dominando seu uso
- Quanto você gastou hoje / semana
- Se há eventos sem pricing (custo invisível)

## Diferenciais

- **Project-first**: custo por projeto, não só total
- **Event log append-only**: histórico completo, sem perda
- **Sem dependências externas**: tudo local
- **Agregação sob demanda**: sem cache inconsistente
- **Pricing determinístico**: sem heurísticas imprevisíveis
- **Output semântico**: cores apenas onde carregam significado (cyan = identidade, green = OK, yellow = aviso, red = erro)

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
  ◆ tt  seg 20 abr  ·····················································  $1.10

  input           774
  output        13.1k
  cache hit    804.3k
  cache write   58.6k

  Opus 4.7  $1.10  100%

  → token-tracker é o projeto mais caro hoje  $1.10
```

### Últimos 7 dias / semanas

```bash
tt daily
```

```
  últimos 7 dias

  hoje     $1.18  20 ev
  dom 19  $27.16  609 ev
  sex 17  $32.43  804 ev
  qui 16  $14.73  314 ev
  qua 15  $10.20  342 ev
  ter 14  $19.70  286 ev
  seg 13  $26.64  792 ev

  total  $132.04
  média  $18.86
```

```bash
tt weekly          # últimas 4 semanas
tt daily --json    # saída JSON para scripts
```

### Projetos

```bash
tt projects
```

```
  projetos · últimos 7 dias

  1  planton-design-system  $57.16  43%  ▰▰▱▱▱
  2  token-tracker          $31.13  24%  ▰▱▱▱▱ ·
  3  genius-dados           $14.88  11%  ▰▱▱▱▱
  4  planton-vault          $13.38  10%  ▰▱▱▱▱

  4 projetos · $132.04 total
```

```bash
tt --project .           # filtra pelo projeto do cwd (via realpath)
tt daily --project .     # combinável com subcomandos
```

### Auditoria

```bash
tt doctor
```

```
  event log
  ✓  claude      3.263 eventos · último 2026-04-20 03:05
  ✓  codex       14 eventos · 1 sessões · último 2026-04-13 00:03

  pricing
  ✓  cache LiteLLM  atualizado há 0min · 2672 modelos
  !  gpt-5.4 · custo invisível em 14 eventos
  !  1317 eventos sem custo calculado

  storage
  ✓  ~/.token-tracker  55 arquivos · 1.2 MB
  !  cache antigo em /Users/wagnerrosa/.token-tracker/cache (rode: rm -rf ...)
```

### Ajuda

```bash
tt --help
```

Mostra providers detectados, comandos e dicas na primeira execução.

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

TokenTracker funciona em três etapas simples:

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

> Se você quer apenas usar, pode pular esta seção.

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
  ui.js                    # Formatters + renderers com picocolors
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
