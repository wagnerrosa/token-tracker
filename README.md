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
- 📊 Resumo de uso por dia/semana/mês
- 🗂️ Agregação automática por projeto
- 💰 Custo real (não estimado)
- 🔄 Cache inteligente (warm/cold path)
- 📁 Dados locais persistentes

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
Hoje (2026-03-29)

  Input:   5.4k
  Output:  35.7k
  Cache ↑: 9.3M
  Custo:   $0.0000

  Modelos:
    claude-haiku-4-5-20251001            $0.0000  (26x)
    claude-opus-4-6                      $0.0000  (110x)
    claude-sonnet-4-6                    $0.0000  (63x)
```

### Últimos 7 dias

```bash
tt daily
```

```
Últimos 7 dias

date        input       output      cost
────────────────────────────────────────────────
2026-03-23  292         21.3k       $0.0000
2026-03-24  11.1k       67.7k       $0.0000
2026-03-25  37.6k       70.6k       $0.0000
2026-03-26  3.6k        46.3k       $0.0000
2026-03-27  1.3k        25.8k       $0.0000
2026-03-28  13.0k       43.6k       $0.0000
2026-03-29  5.4k        35.8k       $0.0000
```

### Últimas 4 semanas

```bash
tt weekly
```

### Saída JSON

```bash
tt daily --json
```

---

## Como funciona

```
~/.claude/projects/**/*.jsonl  ─┐
~/.codex/sessions/**/*.jsonl   ─┼─→ Parsers ─→ Cache ─→ CLI
~/.gemini/tmp/*/chats/*.json   ─┤  (warm/cold)
~/.local/share/opencode/*/*.json ┘
```

1. **Parsers especializados** — lêem logs locais de cada ferramenta
2. **Agregação** — agrupa entries em `DailySummary` por data
3. **Cache inteligente** — warm path (rápido) e cold path (completo)
4. **CLI** — mostra dados formatados ou JSON

---

## Arquitetura

```
src/
  parsers/
    claude.js      # Parser Claude Code JSONL
  services/
    cache.js       # Warm/cold path cache
    aggregator.js  # Agregação por dia/semana/mês
  types.js         # Modelos de dados
  cli.js           # Entry point CLI
```

### Modelo de dados

**UsageEntry** — uma mensagem/interação:
```js
{
  timestamp,
  source: "claude" | "codex" | "gemini" | "opencode",
  provider: "anthropic" | "openai" | "google" | null,
  model: string,
  input_tokens, output_tokens,
  cache_read_tokens, cache_creation_tokens,
  thinking_tokens,
  cost_usd,
  project,    // derivado do path
  dedup_key   // para deduplicação
}
```

**DailySummary** — agregação diária:
```js
{
  date: "YYYY-MM-DD",
  total_input_tokens,
  total_output_tokens,
  total_cost_usd,
  models: {
    "claude-opus-4": { input_tokens, output_tokens, cost_usd, count }
  }
}
```

---

## Cache

Salvo em `~/.token-tracker/cache/`:
- `claude_daily.json` — resumos diários do Claude Code

**Warm path** (rápido):
- Lê apenas arquivos modificados desde último cache
- Recomputa hoje (sempre completo)
- Merge com dias passados

**Cold path** (completo):
- Full parse de todos os arquivos
- Cria cache do zero

Versioning automático — mudanças na lógica invalidam cache.

---

## Roadmap

| Fase | Status | Descrição |
|------|--------|-----------|
| 1 | ✅ | CLEANUP — estrutura de pastas |
| 2 | ✅ | DATA MODEL — tipos e constantes |
| 3 | ✅ | CLAUDE PARSER — streaming JSONL |
| 4 | ✅ | CACHE — warm/cold path |
| 5 | ✅ | CLI MÍNIMA — `tt`, `tt daily`, `tt weekly` |
| 6 | ⏳ | PROJETOS — agregação por projeto |
| 7 | ⏳ | CODEX PARSER — delta tracking |
| 8 | ⏳ | GEMINI + OPENCODE — multi-provider |
| 9 | ⏳ | NORMALIZAÇÃO + PRICING — nomes + custos |
| 10 | ⏳ | PROXY UPGRADE — adaptar server.js |
| 11 | ⏳ | PRODUTO — watch mode, API REST, alertas |

---

## Desenvolvimento

```bash
# Testes das parsers
node -e "require('./src/parsers/claude').parseAll().then(e => console.log(e.length))"

# Debug do cache
node -e "require('./src/services/cache').loadCache('claude')"

# Executar CLI
node src/cli.js
node src/cli.js daily
node src/cli.js daily --json
```

---

## Env vars

Nenhuma obrigatória por enquanto. Configuração é 100% local.

---

## Licença

ISC
