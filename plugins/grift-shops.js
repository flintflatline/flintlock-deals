// grift-shops plugin (read-only, GET only): agent shops selling services for
// $GRIFT, read from the public GET https://www.grift.world/api/shops (no token).
// Tracks each active listing's price in state/grift-shops.json and emits a
// price_cut entry while a listing sits >= 30% below the price it had before
// its latest change. See README-grift-shops.md.
// Usage: node plugins/grift-shops.js   (JSON array on stdout, logs on stderr)
const { log, readJson, writeJsonAtomic, statePath, fetchRetry, num, emit, fail } = require("./lib/common");

const NAME = "grift-shops";
const URL_SHOPS = "https://www.grift.world/api/shops";
const SITE = "https://www.grift.world";
const CUT_RATIO = 0.70;

// Response: {ok, enabled, ready, chainId, token, maxListings, listings: [...]}.
// Listing: {listing: id, title, price: "20" (string, whole GRIFT), status,
// seller: {n: shop name, ...}, ...}. Only active listings with a positive
// price are tracked.
async function fetchListings() {
  const { status, body } = await fetchRetry(URL_SHOPS, { headers: { accept: "application/json" } }, { timeoutMs: 10000, retries: 2 });
  if (status !== 200) throw new Error(`${URL_SHOPS} http=${status} ${body.slice(0, 200)}`);
  let res;
  try { res = JSON.parse(body); } catch (_) { throw new Error(`${URL_SHOPS} returned non-JSON`); }
  if (!res || typeof res !== "object" || res.ok !== true) throw new Error(`${URL_SHOPS} ok=${res && res.ok}`);
  if (!Array.isArray(res.listings)) throw new Error(`${URL_SHOPS} has no listings array`);
  if (res.enabled === false || res.ready === false) log(NAME, `shops enabled=${res.enabled} ready=${res.ready}`);

  const out = [];
  let skipped = 0;
  for (const l of res.listings) {
    if (!l || typeof l !== "object" || l.status !== "active") continue;
    const id = typeof l.listing === "string" && l.listing ? l.listing : null;
    const price = num(l.price);
    if (!id || price === null || price <= 0) { skipped++; continue; }
    out.push({
      id,
      price,
      title: typeof l.title === "string" && l.title ? l.title : id,
      seller: l.seller && typeof l.seller.n === "string" ? l.seller.n : null,
    });
  }
  if (skipped) log(NAME, `${skipped} active listings skipped (missing id or price)`);
  return { total: res.listings.length, listings: out };
}

async function main() {
  const { total, listings } = await fetchListings();
  const file = statePath(NAME);
  const state = readJson(file, { listings: {} });
  state.listings = state.listings || {};
  const now = new Date().toISOString();
  const entries = [];

  for (const l of listings) {
    const prev = state.listings[l.id];
    let rec;
    if (!prev) rec = { price: l.price, prev: null, changed_at: now };
    else if (prev.price !== l.price) rec = { price: l.price, prev: prev.price, changed_at: now };
    else rec = prev;
    rec.last_seen = now;
    state.listings[l.id] = rec;

    if (rec.prev !== null && rec.prev > 0 && rec.price <= CUT_RATIO * rec.prev) {
      entries.push({
        source: NAME,
        kind: "price_cut",
        id: l.id,
        title: l.title,
        seller: l.seller,
        currency: "GRIFT",
        price: rec.price,
        reference_price: rec.prev,
        discount_pct: Math.round(((rec.prev - rec.price) / rec.prev) * 100),
        signal: "price_cut",
        action: SITE,
        extra: { cut_seen_at: rec.changed_at },
      });
    }
  }

  writeJsonAtomic(file, state);
  entries.sort((a, b) => b.discount_pct - a.discount_pct);
  log(NAME, `${listings.length} active listings tracked (of ${total}), ${entries.length} price cuts`);
  emit(entries);
}

main().catch((e) => fail(NAME, e.message));
