const express = require("express");
const fs = require("fs/promises");
const path = require("path");

const app = express();
const PORT = 4000;
const OPENAI_BASE = "https://api.openai.com";
const USAGE_DIR = path.join(process.cwd(), ".ai-tracker");
const USAGE_FILE = path.join(USAGE_DIR, "usage.json");
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

  // Forward headers, stripping hop-by-hop and normalizing auth casing
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
      console.error(`[ai-tracker] Upstream error: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    const body = await response.arrayBuffer();
    const bodyBuffer = Buffer.from(body);

    // Try to extract usage from JSON responses
    if (contentType.includes("application/json")) {
      try {
        const json = JSON.parse(bodyBuffer.toString("utf-8"));
        if (json.usage) {
          saveUsage(json).catch((err) =>
            console.error("[ai-tracker] Failed to save usage:", err.message)
          );
        }
      } catch (err) {
        console.error("[ai-tracker] Failed to parse JSON response:", err.message);
      }
    }

    // Forward response status and headers
    for (const [key, value] of response.headers.entries()) {
      if (key === "transfer-encoding") continue;
      res.setHeader(key, value);
    }
    res.status(response.status).send(bodyBuffer);
  } catch (err) {
    if (err.name === "AbortError") {
      console.error("[ai-tracker] Request timeout after", FETCH_TIMEOUT_MS, "ms");
      return res.status(504).json({ error: "Gateway Timeout" });
    }
    console.error("[ai-tracker] Proxy error:", err.message);
    res.status(502).json({ error: "Proxy error", message: err.message });
  }
});

async function saveUsage(json) {
  const { prompt_tokens, completion_tokens, total_tokens } = json.usage;

  if (prompt_tokens == null || completion_tokens == null || total_tokens == null) {
    console.warn("[ai-tracker] Skipping: missing token fields in usage", json.usage);
    return;
  }

  const entry = {
    provider: "openai",
    model: json.model || "unknown",
    tokens_input: prompt_tokens,
    tokens_output: completion_tokens,
    total_tokens,
    timestamp: new Date().toISOString(),
  };

  // Queue writes to prevent race conditions
  writeQueue = writeQueue.then(() => appendEntry(entry));
  return writeQueue;
}

async function appendEntry(entry) {
  await fs.mkdir(USAGE_DIR, { recursive: true });

  let data = [];
  try {
    const content = await fs.readFile(USAGE_FILE, "utf-8");
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      data = parsed;
    } else {
      console.warn("[ai-tracker] usage.json is not an array, resetting");
    }
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn("[ai-tracker] Corrupted usage.json, resetting:", err.message);
    }
  }

  data.push(entry);
  await fs.writeFile(USAGE_FILE, JSON.stringify(data, null, 2));
  console.log(`[ai-tracker] +${entry.total_tokens} tokens (${entry.model})`);
}

app.use((req, res) => {
  res.status(404).json({ error: "Not found. Proxy only handles /v1/* routes." });
});

app.listen(PORT, () => {
  console.log(`[ai-tracker] Proxy running on http://localhost:${PORT}`);
});
