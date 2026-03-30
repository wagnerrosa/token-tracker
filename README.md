# TokenTracker (TT)

**Rastreia uso de tokens de LLMs por projeto e usuário.**

Observabilidade local-first para consumo de IA sem banco de dados, sem serviços externos.

---

## Por quê

Ferramentas de IA (Claude Code, Codex, Gemini, OpenCode) registram dados de uso localmente, mas esses dados:
- São apagados após 30 dias
- Não têm agregação por projeto
- Não mostram custos comparativos
- Não rastreiam uso por time

**TokenTracker** lê esses logs locais e oferece:
- Resumo de uso por dia/semana/mês
- Agregação automática por projeto
- Custo real via LiteLLM pricing
- Cache inteligente (warm/cold path)
- Proxy OpenAI com captura de uso
- Dados locais persistentes

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
Hoje (2026-03-30)

  Input:   5.4k
  Output:  35.7k
  Cache:   9.3M
  Custo:   $0.1234

  Modelos:
    claude-haiku-4-5-20251001            $0.0120  (26x)
    claude-sonnet-4-6                    $0.0890  (63x)
```

### Últimos 7 dias

```bash
tt daily
tt daily --json    # saída JSON
```

### Últimas 4 semanas

```bash
tt weekly
tt weekly --json
```

### Projetos

```bash
tt projects        # ranking de projetos por custo
tt --project .     # filtra pelo projeto do diretório atual
tt daily --project .   # combinável com subcomandos
```

### Proxy OpenAI

```bash
node server.js     # inicia proxy na porta 4000
# Configure OPENAI_BASE_URL=http://localhost:4000/v1 na sua app
```

O proxy intercepta chamadas OpenAI, calcula custo via pricing service, e salva no cache. Dados aparecem em `tt daily`.

---

## Providers Suportados

| Provider | Fonte de dados | Parser |
|----------|---------------|--------|
| **Claude Code** | `~/.claude/projects/**/*.jsonl` | Streaming JSONL + dedup |
| **Codex** | `~/.codex/sessions/**/*.jsonl` | Delta tracking stateful |
| **Gemini** | `~/.gemini/tmp/*/chats/session-*.json` | JSON sessão + filtro por tipo |
| **OpenCode** | `~/.local/share/opencode/**/msg_*.json` | JSON por mensagem |
| **OpenAI (proxy)** | Interceptado via server.js | Captura automática |

---

## Como funciona

```
~/.claude/projects/**/*.jsonl  ─┐
~/.codex/sessions/**/*.jsonl   ─┼─→ Parsers ─→ Aggregator ─→ Cache ─→ CLI
~/.gemini/tmp/*/chats/*.json   ─┤     │          (warm/cold)
~/.local/share/opencode/*/*.json┘     │
                                      ├─→ Normalizer (nomes de modelos)
                                      └─→ Pricing (LiteLLM + fallback)
```

1. **Parsers especializados** — lêem logs locais de cada ferramenta
2. **Agregação** — agrupa entries em `DailySummary` por data com breakdown por modelo
3. **Cache inteligente** — warm path (só arquivos novos) e cold path (completo)
4. **Pricing** — custo real via LiteLLM com cache local (TTL 1h)
5. **Normalização** — `claude-sonnet-4-20250514` → `Sonnet 4`
6. **CLI** — mostra dados formatados ou JSON

---

## Arquitetura

```
src/
  parsers/
    claude.js        # Parser Claude Code JSONL
    codex.js         # Parser Codex com delta tracking
    gemini.js        # Parser Gemini CLI
    opencode.js      # Parser OpenCode CLI
    index.js         # Registry de parsers
  services/
    cache.js         # Warm/cold path cache
    aggregator.js    # Agregação por dia/semana/mês
    projects.js      # Agregação por projeto
    normalizer.js    # Normalização de nomes de modelos
    pricing.js       # Pricing via LiteLLM
  types.js           # Modelos de dados e constantes
  cli.js             # Entry point CLI
server.js            # Proxy OpenAI + captura de uso
```

### Modelo de dados

**UsageEntry** — uma interação individual:
```js
{
  timestamp, source, provider, model,
  input_tokens, output_tokens,
  cache_read_tokens, cache_creation_tokens,
  thinking_tokens, cost_usd,
  project, dedup_key
}
```

**DailySummary** — agregação diária:
```js
{
  date: "YYYY-MM-DD",
  total_input_tokens, total_output_tokens,
  cache_read_tokens, cache_creation_tokens,
  thinking_tokens, total_cost_usd,
  models: { [name]: { input_tokens, output_tokens, cost_usd, count } }
}
```

---

## Cache

Salvo em `~/.token-tracker/cache/`:

| Arquivo | Conteúdo |
|---------|----------|
| `claude_daily.json` | Resumos diários do Claude Code |
| `codex_daily.json` | Resumos diários do Codex |
| `gemini_daily.json` | Resumos diários do Gemini |
| `opencode_daily.json` | Resumos diários do OpenCode |
| `openai-proxy_daily.json` | Resumos do proxy OpenAI |

**Warm path** — rápido: lê apenas arquivos modificados desde último cache, recomputa hoje, merge com passado.

**Cold path** — completo: full parse de todos os arquivos, cria cache do zero.

Versionamento automático — mudanças na lógica invalidam cache.

---

## Pricing

Custo calculado via [LiteLLM pricing table](https://github.com/BerriAI/litellm):

- Cache local em `~/.token-tracker/pricing.json` (TTL 1h)
- Lookup: exato → normalizado → fuzzy substring
- Usa `costUSD` nativo do Claude quando disponível
- Fallback: custo 0 (nunca falha)

---

## Roadmap

| Fase | Status | Descrição |
|------|--------|-----------|
| 1 | ✅ | CLEANUP — estrutura de pastas |
| 2 | ✅ | DATA MODEL — tipos e constantes |
| 3 | ✅ | CLAUDE PARSER — streaming JSONL |
| 4 | ✅ | CACHE — warm/cold path |
| 5 | ✅ | CLI MÍNIMA — `tt`, `tt daily`, `tt weekly` |
| 6 | ✅ | PROJETOS — `tt projects`, `tt --project .` |
| 7 | ✅ | CODEX PARSER — delta tracking stateful |
| 8 | ✅ | GEMINI + OPENCODE — parsers + registry |
| 9 | ✅ | NORMALIZAÇÃO + PRICING — nomes + custos LiteLLM |
| 10 | ✅ | PROXY UPGRADE — server.js integrado |
| 11a | ⏳ | Consolidação multi-provider na CLI |
| 11b | ⏳ | Watch mode |
| 11c | ⏳ | API REST |
| 11d | ⏳ | Dashboard web |
| 11e | ⏳ | Alertas e budgets |

---

## Desenvolvimento

```bash
# CLI
node src/cli.js
node src/cli.js daily
node src/cli.js daily --json
node src/cli.js projects
node src/cli.js --project .

# Proxy
node server.js

# Testar parsers
node -e "require('./src/parsers/claude').parseAll().then(e => console.log(e.length))"
node -e "require('./src/parsers/codex').parseAll().then(e => console.log(e.length))"
node -e "require('./src/parsers').getAll().map(p => console.log(p.name))"

# Testar pricing
node -e "require('./src/services/pricing').getCache().then(c => console.log(Object.keys(c.models).length, 'models'))"

# Testar normalizer
node -e "const n = require('./src/services/normalizer'); console.log(n.displayName(n.normalizeModelName('claude-sonnet-4-20250514')))"
```

---

## Licença

ISC
