#!/usr/bin/env bash
# E2E manual: 2 usuarios no mesmo repo Git + consolidacao via merge.
# Fase 2.7-T de env/MIGRACAO_STORAGE_REPO.md.
#
# Fluxo:
#   1. cria repo Git tmp
#   2. usuario A (alice@ex.com) gera evento no branch main
#   3. usuario B (bob@ex.com) gera evento no branch feature-bob
#   4. merge feature-bob -> main (com merge=union em *.jsonl)
#   5. roda `tt --by-user --json` e valida:
#       - 2 user_ids distintos
#       - total_cost_usd consolidado = soma dos individuais
#       - nenhum evento duplicado
#
# Uso: bash test/e2e-two-users.sh [--keep]
#   --keep  nao remove dir temporario (para inspecao)

set -euo pipefail

KEEP=${1:-}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TT_BIN="$REPO_ROOT/src/cli.js"

TMP=$(mktemp -d -t tt-e2e-XXXXXX)
echo "==> tmp repo: $TMP"
cleanup() {
  if [ "$KEEP" = "--keep" ]; then
    echo "==> preservado em $TMP"
  else
    rm -rf "$TMP"
  fi
}
trap cleanup EXIT

cd "$TMP"
git init -q -b main .

# pre-seed config pra evitar banner onboarding (polui stdout JSON)
mkdir -p .token-tracker
echo '{"onboarded":true}' > .token-tracker/config.json

# .gitattributes: merge=union em jsonl de eventos
mkdir -p .token-tracker/events/claude
cat > .gitattributes <<'EOF'
.token-tracker/events/**/*.jsonl merge=union
EOF

# cursores locais nao entram em git
cat > .gitignore <<'EOF'
.token-tracker/cursors/
.token-tracker/cache/
EOF

git add .gitattributes .gitignore
git -c user.email=bootstrap@ex.com -c user.name=Bootstrap commit -q -m "bootstrap storage"

TODAY=$(date -u +%Y-%m-%d)
EVENTS_FILE=".token-tracker/events/claude/${TODAY}.jsonl"

# ---------- Usuario A: Alice ----------
git checkout -q -b feature-alice
git config user.email "alice@ex.com"
git config user.name "Alice"

# Evento Alice: 1000 in / 500 out, cost=0.015
cat > /tmp/tt-e2e-alice.js <<EOF
const fs = require("fs");
const path = require("path");
const { entryToEvent } = require("${REPO_ROOT}/src/types/event");
const ev = entryToEvent({
  timestamp: new Date().toISOString(),
  source: "claude",
  model: "claude-3-5-sonnet",
  input_tokens: 1000,
  output_tokens: 500,
  cost_usd: 0.015,
  user_id: "alice@ex.com",
  user_name: "Alice",
  project_path: "${TMP}",
  project_id: path.basename("${TMP}"),
  session_id: "sess-alice-1",
}, { source: "claude" });
const file = "${EVENTS_FILE}";
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.appendFileSync(file, JSON.stringify(ev) + "\n");
console.log("alice dedup:", ev.dedup_key);
EOF
node /tmp/tt-e2e-alice.js
git add "$EVENTS_FILE"
git commit -q -m "alice: +1 event"

# ---------- Usuario B: Bob (em branch paralelo) ----------
git checkout -q main
git checkout -q -b feature-bob
git config user.email "bob@ex.com"
git config user.name "Bob"

cat > /tmp/tt-e2e-bob.js <<EOF
const fs = require("fs");
const path = require("path");
const { entryToEvent } = require("${REPO_ROOT}/src/types/event");
const ev = entryToEvent({
  timestamp: new Date().toISOString(),
  source: "claude",
  model: "claude-3-5-sonnet",
  input_tokens: 2000,
  output_tokens: 800,
  cost_usd: 0.030,
  user_id: "bob@ex.com",
  user_name: "Bob",
  project_path: "${TMP}",
  project_id: path.basename("${TMP}"),
  session_id: "sess-bob-1",
}, { source: "claude" });
const file = "${EVENTS_FILE}";
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.appendFileSync(file, JSON.stringify(ev) + "\n");
console.log("bob dedup:", ev.dedup_key);
EOF
node /tmp/tt-e2e-bob.js
git add "$EVENTS_FILE"
git commit -q -m "bob: +1 event"

# ---------- Merge ----------
git checkout -q main
git merge -q --no-ff feature-alice -m "merge alice"
# agora merge bob (conflito esperado em jsonl, resolvido via merge=union)
if ! git merge -q --no-ff feature-bob -m "merge bob"; then
  echo "==> conflito esperado, resolvendo com merge=union manual"
  # forca union do arquivo
  git show feature-alice:"$EVENTS_FILE" > /tmp/alice.jsonl
  git show feature-bob:"$EVENTS_FILE" > /tmp/bob.jsonl
  cat /tmp/alice.jsonl /tmp/bob.jsonl | sort -u > "$EVENTS_FILE"
  git add "$EVENTS_FILE"
  git commit -q -m "merge bob (union)"
fi

echo
echo "==> conteudo final do events file:"
cat "$EVENTS_FILE"
echo

# ---------- Validacao ----------
# rodar tt com user neutro para leitura (nao vai ingerir nada novo: sem parsers reais aqui;
# ingestAll rodara mas sem eventos; read() pegara os 2 eventos ja gravados).
# usamos TT_USER_ID_STRATEGY=email e um config git neutro so pra ingest nao quebrar.
git config user.email "reader@ex.com"
git config user.name "Reader"

echo "==> tt --by-user --json"
OUT=$(TT_USER_ID_STRATEGY=email node "$TT_BIN" --by-user --json 2>/dev/null)
echo "$OUT"
echo

# parse + asserts via node
node <<EOF
const data = $OUT;
const assert = require("assert");

assert.ok(Array.isArray(data), "output deve ser array");
const ids = data.map(u => u.user_id).sort();
assert.deepEqual(ids, ["alice@ex.com", "bob@ex.com"], "deve ter 2 usuarios distintos");

const alice = data.find(u => u.user_id === "alice@ex.com");
const bob = data.find(u => u.user_id === "bob@ex.com");

assert.equal(alice.total_input_tokens, 1000, "alice input");
assert.equal(alice.total_output_tokens, 500, "alice output");
assert.ok(Math.abs(alice.total_cost_usd - 0.015) < 1e-9, "alice cost");
assert.equal(alice.count, 1, "alice 1 evento");

assert.equal(bob.total_input_tokens, 2000, "bob input");
assert.equal(bob.total_output_tokens, 800, "bob output");
assert.ok(Math.abs(bob.total_cost_usd - 0.030) < 1e-9, "bob cost");
assert.equal(bob.count, 1, "bob 1 evento");

const totalCost = alice.total_cost_usd + bob.total_cost_usd;
assert.ok(Math.abs(totalCost - 0.045) < 1e-9, "consolidado = 0.045");

console.log("OK: consolidacao correta. alice+bob =", totalCost.toFixed(4), "USD");
EOF

echo
echo "==> E2E 2.7-T PASSOU"
