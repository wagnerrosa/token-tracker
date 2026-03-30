const express = require("express");
const { createUsageEntry } = require("./src/types");
const { getCost } = require("./src/services/pricing");
const { loadForParser, saveCache, loadCache } = require("./src/services/cache");
const { daily } = require("./src/services/aggregator");

const app = express();
const PORT = 4000;
const OPENAI_BASE = "https://api.openai.com";
const FETCH_TIMEOUT_MS = 15_000;

// Simple write queue to prevent race conditions
let writeQueue = Promise.resolve();

// Headers that should not be forwarded to upstream
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "transfer-encoding",
  "te", "trailer", "upgrade", "host", "content-length",
]);

// Parse raw body so we can forward it
app.use(express.raw({ type: "*/*", limit: "10mb" }));

// Only handle /v1/ routes
app.all("/v1/*splat", async (req, res) => {
  const targetUrl = `${OPENAI_BASE}${req.originalUrl}`;

  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    headers[key] = value;
  }
  headers["host"] = new URL(OPENAI_BASE).host;

  try {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
      signal: abort.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      console.error(`[tt-proxy] Upstream error: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    const body = await response.arrayBuffer();
    const bodyBuffer = Buffer.from(body);

    if (contentType.includes("application/json")) {
      try {
        const json = JSON.parse(bodyBuffer.toString("utf-8"));
        if (json.usage) {
          saveEntry(json).catch((err) =>
            console.error("[tt-proxy] Failed to save usage:", err.message)
          );
        }
      } catch (err) {
        console.error("[tt-proxy] Failed to parse JSON response:", err.message);
      }
    }

    for (const [key, value] of response.headers.entries()) {
      if (key === "transfer-encoding") continue;
      res.setHeader(key, value);
    }
    res.status(response.status).send(bodyBuffer);
  } catch (err) {
    if (err.name === "AbortError") {
      console.error("[tt-proxy] Request timeout after", FETCH_TIMEOUT_MS, "ms");
      return res.status(504).json({ error: "Gateway Timeout" });
    }
    console.error("[tt-proxy] Proxy error:", err.message);
    res.status(502).json({ error: "Proxy error", message: err.message });
  }
});

async function saveEntry(json) {
  const usage = json.usage;
  if (!usage) return;

  const inputTokens = usage.prompt_tokens || 0;
  const outputTokens = usage.completion_tokens || 0;
  if (inputTokens === 0 && outputTokens === 0) return;

  const entry = createUsageEntry({
    timestamp: new Date().toISOString(),
    source: "openai-proxy",
    provider: "openai",
    model: json.model || null,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    thinking_tokens: 0,
    cost_usd: null,
    message_id: json.id || null,
    request_id: null,
    project: null,
    dedup_key: json.id || null,
  });

  // Calculate cost via pricing service
  entry.cost_usd = await getCost(entry);

  // Queue write to avoid race conditions
  writeQueue = writeQueue.then(() => appendToCache(entry));
  return writeQueue;
}

async function appendToCache(entry) {
  const SOURCE = "openai-proxy";

  // Load existing cache (if any)
  const existing = loadCache(SOURCE);
  const cachedSummaries = existing ? existing.summaries : [];

  // Merge new entry into summaries
  const freshSummaries = daily([entry]);
  const { mergeSummaries } = require("./src/services/aggregator");
  const merged = mergeSummaries(cachedSummaries, freshSummaries);

  saveCache(SOURCE, merged, Date.now());

  console.log(
    `[tt-proxy] +${entry.input_tokens}/${entry.output_tokens} tokens (${entry.model || "unknown"}) cost=$${(entry.cost_usd || 0).toFixed(6)}`
  );
}

app.use((req, res) => {
  res.status(404).json({ error: "Not found. Proxy only handles /v1/* routes." });
});

app.listen(PORT, () => {
  console.log(`[tt-proxy] Proxy running on http://localhost:${PORT}`);
});
