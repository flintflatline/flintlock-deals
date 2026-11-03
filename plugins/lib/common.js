// Shared helpers for Deals Desk plugins. Lives in plugins/lib/ so the writer's
// plugins/*.js discovery never runs it as a plugin. Read-only helpers only.
const fs = require("fs");
const path = require("path");

const STATE_DIR = path.join(__dirname, "..", "state");

function log(name, ...args) {
  console.error(`[${name}]`, ...args);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw new Error(`cannot read ${file}: ${e.message}`);
  }
}

function writeJsonAtomic(file, data) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, "." + path.basename(file) + "." + process.pid + ".tmp");
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
}

function statePath(name) {
  return path.join(STATE_DIR, name + ".json");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET/POST with per-attempt timeout; retries network errors, 429 and 5xx with
// backoff (honours Retry-After up to 10s). Other statuses are returned to the
// caller, which decides what they mean. Never logs request headers.
async function fetchRetry(url, opts = {}, { timeoutMs = 10000, retries = 2, baseDelayMs = 1000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: ctl.signal });
      const body = await res.text();
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const ra = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10000) : baseDelayMs * 2 ** attempt);
        continue;
      }
      return { status: res.status, body };
    } catch (e) {
      lastErr = e.name === "AbortError" ? new Error(`timeout after ${timeoutMs}ms`) : e;
      if (attempt < retries) await sleep(baseDelayMs * 2 ** attempt);
    } finally {
      clearTimeout(t);
    }
  }
  throw new Error(`${new URL(url).host}: ${lastErr ? lastErr.message : "request failed"}`);
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Print the entry array as the only stdout content, then exit 0.
function emit(entries) {
  process.stdout.write(JSON.stringify(entries) + "\n", () => process.exit(0));
}

function fail(name, msg) {
  log(name, "FAILED:", msg);
  process.exit(1);
}

module.exports = { log, readJson, writeJsonAtomic, statePath, sleep, fetchRetry, num, emit, fail };
