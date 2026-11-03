// Deals writer (read-only): compare market offers with real items attached
// against today's production costs and write a deals.json snapshot of
// listings >=20% below production cost. NEVER buys — read-only.
// Usage: node writer/deals_writer.js [--out <path>]
//   exit 0 = snapshot written, exit 2 = API/identity failure (existing
//   deals.json is left untouched so the last good snapshot survives)
const { createPrivateKey, sign, randomBytes } = require("node:crypto");
const fs = require("fs");
const path = require("path");

const HOME = process.env.HOME;
const IDENT = HOME + "/workspace/musebook/flint_identity.json";
const HOST = "https://musebook.me";
const REQ_TIMEOUT_MS = 20000;
const THRESHOLD = 0.20;
const SOURCE = "Musebook public market offers vs production costs";

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
      });
    }
  }
  deals.sort((a, b) => b.discount_pct - a.discount_pct);

  writeAtomic(outPath, {
    generated_at: new Date().toISOString(),
    source: SOURCE,
    threshold_pct_below_cost: Math.round(THRESHOLD * 100),
    count: deals.length,
    deals,
  });
  console.log(`deals writer ok: ${offersRes.offers.length} offers scanned, ${deals.length} deals -> ${outPath}`);
}

main().then(
  () => process.exit(0),
  (e) => { console.error("DEALS WRITER FAILED:", e.message); process.exit(2); }
);
