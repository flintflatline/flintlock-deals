// grift-coins plugin (read-only): public Grift coin list -> curve_discount
// entries. Tracks each launched, non-graduated coin's peak market.priceUsd in
// state/grift-coins.json. Emits below_peak (price <= 80% of a peak recorded
// over >= 6 prior runs) or dip_24h (change24hPct <= -20). Dead coins
// (24h volume 0 and fees 0) are skipped.
// Usage: node plugins/grift-coins.js   (JSON array on stdout, logs on stderr)
const { log, readJson, writeJsonAtomic, statePath, fetchRetry, num, emit, fail } = require("./lib/common");

const NAME = "grift-coins";
const API = "https://www.grift.world/api/coins";
const SITE = "https://www.grift.world";
const PEAK_RATIO = 0.80;
const MIN_PRIOR_RUNS = 6;
const DIP_PCT = -20;

// Field access is defensive: the contract names market.priceUsd,
// market.change24hPct, volume24hUsd, feesEth and page; volume/fees are read
// from the coin or its market object, whichever carries them.
function coinList(res) {
  if (Array.isArray(res)) return res;
  for (const k of ["coins", "data", "items", "results"]) if (res && Array.isArray(res[k])) return res[k];
  return null;
}

function pick(c, key) {
  if (c[key] !== undefined) return c[key];
  if (c.market && c.market[key] !== undefined) return c.market[key];
  return undefined;
}

function isLive(c) {
  const status = String(c.status || c.phase || "").toLowerCase();
  if (c.graduated === true || status === "graduated" || c.graduatedAt) return false;
  if (c.launched === false || ["pending", "draft", "unlaunched", "scheduled"].includes(status)) return false;
  return true;
}

function sellerOf(c) {
  const cr = c.creator || c.owner || c.agent;
  if (cr && typeof cr === "object") return cr.name || cr.displayName || cr.handle || cr.username || null;
  return c.creatorName || (typeof cr === "string" ? cr : null);
}

function pageOf(c, ticker) {
  const p = c.page || c.url;
  if (typeof p === "string" && p) return p.startsWith("http") ? p : SITE + (p.startsWith("/") ? "" : "/") + p;
  return `${SITE}/coins?t=${encodeURIComponent(ticker)}`;
}

const pct = (price, ref) => Math.round(((ref - price) / ref) * 100);

async function main() {
  const { status, body } = await fetchRetry(API, { headers: { accept: "application/json" } });
  if (status !== 200) throw new Error(`GET ${API} http=${status} ${body.slice(0, 200)}`);
  let res;
  try { res = JSON.parse(body); } catch (_) { throw new Error(`GET ${API} returned non-JSON`); }
  const coins = coinList(res);
  if (!coins) throw new Error(`GET ${API}: no coin array in response (keys: ${Object.keys(res || {}).join(",")})`);

  const file = statePath(NAME);
  const state = readJson(file, { coins: {} });
  state.coins = state.coins || {};
  const now = new Date().toISOString();
  const entries = [];
  let tracked = 0;

  for (const c of coins) {
    if (!c || typeof c !== "object" || !isLive(c)) continue;
    const ticker = c.ticker || c.symbol;
    const price = num(c.market && c.market.priceUsd);
    if (!ticker || price === null || price <= 0) continue; // no clean price -> omit
    tracked++;

    const prev = state.coins[ticker];
    // Signals use the peak/sightings from prior runs only; this run's price
    // feeds the next run.
    const priorPeak = prev ? prev.peak : null;
    const priorRuns = prev ? prev.sightings : 0;
    state.coins[ticker] = {
      peak: priorPeak === null ? price : Math.max(priorPeak, price),
      sightings: priorRuns + 1,
      last_price: price,
      last_seen: now,
    };

    const volume = num(pick(c, "volume24hUsd"));
    const fees = num(pick(c, "feesEth"));
    if (volume === 0 && fees === 0) continue; // dead coin

    const candidates = [];
    if (priorRuns >= MIN_PRIOR_RUNS && priorPeak > 0 && price <= PEAK_RATIO * priorPeak) {
      candidates.push({ signal: "below_peak", reference_price: priorPeak, discount_pct: pct(price, priorPeak) });
    }
    const ch = num(c.market && c.market.change24hPct);
    if (ch !== null && ch <= DIP_PCT && ch > -100) {
      const ref = price / (1 + ch / 100);
      candidates.push({ signal: "dip_24h", reference_price: ref, discount_pct: pct(price, ref) });
    }
    if (!candidates.length) continue;
    candidates.sort((a, b) => b.discount_pct - a.discount_pct);
    const best = candidates[0];

    entries.push({
      source: NAME,
      kind: "curve_discount",
      id: String(ticker),
      title: c.name ? `${c.name} (${ticker})` : String(ticker),
      seller: sellerOf(c),
      currency: "USD",
      price,
      reference_price: best.reference_price,
      discount_pct: best.discount_pct,
      signal: best.signal,
      action: pageOf(c, ticker),
      extra: {
        change24h_pct: ch,
        volume24h_usd: volume,
        fees_eth: fees,
        recorded_peak_usd: priorPeak,
        prior_runs: priorRuns,
        ...(candidates[1] ? { also: candidates[1].signal } : {}),
      },
    });
  }

  writeJsonAtomic(file, state);
  entries.sort((a, b) => b.discount_pct - a.discount_pct);
  log(NAME, `${coins.length} coins, ${tracked} live with price, ${entries.length} deals`);
  emit(entries);
}

main().catch((e) => fail(NAME, e.message));
