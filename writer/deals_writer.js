// Deals writer v2 (read-only): Musebook core (market offers with real items
// attached vs today's production costs, >=20% below cost) merged with every
// plugin in ../plugins/*.js into one deals.json (version 2). NEVER buys.
// Usage: node writer/deals_writer.js [--out <path>]
//   exit 0 = snapshot written, exit 2 = Musebook API/identity failure
//   (existing deals.json is left untouched so the last good snapshot
//   survives). A failing plugin is logged to stderr and skipped — never fatal.
const { createPrivateKey, sign, randomBytes } = require("node:crypto");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const HOME = process.env.HOME;
const IDENT = HOME + "/workspace/musebook/flint_identity.json";
const HOST = "https://musebook.me";
const REQ_TIMEOUT_MS = 20000;
const THRESHOLD = 0.20;
const PLUGIN_DIR = path.join(__dirname, "..", "plugins");
const PLUGIN_TIMEOUT_MS = 30000;

// thing.kind -> prices.json production-cost key
const COST_MAP = {
  keepsake: "make.keepsake",
  tool: "make.tool",
  sign: "make.sign",
  document: "make.document",
  game: "make.game",
  album: "make.album",
  song: "compose",
};

function parseOut(argv) {
  const i = argv.indexOf("--out");
  if (i === -1) return path.join(__dirname, "deals.json");
  const p = argv[i + 1];
  if (!p || p.startsWith("--")) {
    console.error("usage: node deals_writer.js [--out <path>]");
    process.exit(2);
  }
  return path.resolve(p);
}

let ident, priv;
function loadIdentity() {
  ident = JSON.parse(fs.readFileSync(IDENT, "utf8"));
  priv = createPrivateKey({
    key: { kty: "OKP", crv: "Ed25519", x: ident.public_key, d: ident.private_key_d },
    format: "jwk",
  });
}

function signFields(endpoint, fields = {}) {
  const timestamp = String(Date.now());
  const nonce = randomBytes(18).toString("base64url");
  const pairLines = Object.keys(fields).sort().map((k) => {
    const v = String(fields[k]);
    return k + ":" + Buffer.byteLength(v, "utf8") + ":" + v;
  });
  const head = ["musebook-v1", endpoint, timestamp, nonce, ident.muse_id].join("\n");
  const message = pairLines.length ? head + "\n" + pairLines.join("\n") : head;
  const signature = sign(null, Buffer.from(message, "utf8"), priv).toString("base64url");
  return { muse_id: ident.muse_id, timestamp, nonce, signature, ...fields };
}

async function apiGet(ep) {
  const signName = ep.replace(/\.json$/, "").replace(/^v2\//, "");
  const qs = new URLSearchParams(signFields(signName)).toString();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), REQ_TIMEOUT_MS);
  try {
    const res = await fetch(HOST + "/api/" + ep + "?" + qs, { signal: ctl.signal });
    const body = await res.text();
    if (res.status !== 200) throw new Error("http=" + res.status + " " + body.slice(0, 200));
    return JSON.parse(body);
  } finally { clearTimeout(t); }
}

function writeAtomic(outPath, data) {
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, "." + path.basename(outPath) + "." + process.pid + ".tmp");
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
    fs.renameSync(tmp, outPath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
}

// Run one plugin: resolves to its entry array, or null (logged) on failure,
// timeout, or invalid output. Never rejects.
function runPlugin(file) {
  const name = path.basename(file, ".js");
  return new Promise((resolve) => {
    execFile(process.execPath, [file], {
      cwd: PLUGIN_DIR,
      timeout: PLUGIN_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: 32 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (stderr) process.stderr.write(stderr.split("\n").filter(Boolean).map((l) => `  [plugin ${name}] ${l}\n`).join(""));
      if (err) {
        const why = err.killed ? `timed out after ${PLUGIN_TIMEOUT_MS / 1000}s` : `exit ${err.code != null ? err.code : err.signal}`;
        console.error(`plugin ${name} skipped: ${why}`);
        return resolve(null);
      }
      let entries;
      try { entries = JSON.parse(stdout); } catch (_) {
        console.error(`plugin ${name} skipped: stdout is not valid JSON`);
        return resolve(null);
      }
      if (!Array.isArray(entries)) {
        console.error(`plugin ${name} skipped: stdout is not a JSON array`);
        return resolve(null);
      }
      const valid = [];
      for (const e of entries) {
        if (!e || typeof e !== "object" || e.id === undefined || e.id === null) continue;
        valid.push({ ...e, source: e.source || name });
      }
      if (valid.length !== entries.length) console.error(`plugin ${name}: dropped ${entries.length - valid.length} malformed entries`);
      resolve({ name, entries: valid });
    });
  });
}

function discoverPlugins() {
  let names;
  try { names = fs.readdirSync(PLUGIN_DIR); } catch (e) {
    if (e.code !== "ENOENT") console.error(`plugin discovery failed: ${e.message}`);
    return [];
  }
  return names.filter((n) => n.endsWith(".js")).sort().map((n) => path.join(PLUGIN_DIR, n))
    .filter((f) => fs.statSync(f).isFile());
}

async function main() {
  const outPath = parseOut(process.argv.slice(2));
  loadIdentity();
  const [offersRes, pricesRes] = await Promise.all([apiGet("v2/offers.json"), apiGet("v2/prices.json")]);
  // Malformed responses count as API failure — don't overwrite a good snapshot with an empty one.
  if (!offersRes || !Array.isArray(offersRes.offers)) throw new Error("offers response missing offers[]");
  if (!pricesRes || !Array.isArray(pricesRes.prices)) throw new Error("prices response missing prices[]");

  const costs = {};
  for (const p of pricesRes.prices) costs[p.price] = p.today;
  const deals = [];
  for (const o of offersRes.offers) {
    const thing = o.thing;
    if (!thing) continue; // service offer, no item — skip per playbook
    const costKey = COST_MAP[thing.kind];
    if (!costKey || costs[costKey] == null) continue;
    const cost = costs[costKey];
    const discount = (cost - o.price) / cost;
    if (discount >= THRESHOLD) {
      deals.push({
        offer_id: o.id,
        title: thing.title,
        kind: thing.kind,
        seller: (o.by && o.by.name) || null,
        asking_musebucks: o.price,
        production_cost_musebucks: cost,
        discount_pct: Math.round(discount * 100),
        accept: `POST /api/v2/accept { offer: ${o.id} }`,
        source: "musebook",
        id: String(o.id),
        currency: "MUSEBUCKS",
        price: o.price,
        reference_price: cost,
        signal: "below_production_cost",
      });
    }
  }

  // Plugins run only once the Musebook core has succeeded, so a core failure
  // exits with no orphaned plugin processes or plugin state advanced for a
  // snapshot that is never written. Plugins run in parallel (distinct hosts).
  const results = (await Promise.all(discoverPlugins().map(runPlugin))).filter(Boolean);
  const sources = ["musebook", ...results.map((r) => r.name)];
  const seen = new Set();
  const merged = [];
  for (const e of [...deals, ...results.flatMap((r) => r.entries)]) {
    const key = e.source + ":" + e.id;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(e);
  }
  // discount desc, nulls (non-discount entries) last; sort is stable.
  const rank = (e) => (typeof e.discount_pct === "number" && Number.isFinite(e.discount_pct) ? e.discount_pct : null);
  merged.sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra === null || rb === null) return (ra === null) - (rb === null);
    return rb - ra;
  });

  writeAtomic(outPath, {
    version: 2,
    generated_at: new Date().toISOString(),
    sources,
    count: merged.length,
    deals: merged,
  });
  const perSource = sources.map((s) => `${s}=${merged.filter((e) => e.source === s).length}`).join(" ");
  console.log(`deals writer ok: ${offersRes.offers.length} offers scanned, ${merged.length} deals (${perSource}) -> ${outPath}`);
}

main().then(
  () => process.exit(0),
  (e) => { console.error("DEALS WRITER FAILED:", e.message); process.exit(2); }
);
