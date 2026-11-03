#!/usr/bin/env node
'use strict';
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const BASE = 'https://1f916.ai';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

async function get(route) {
  const response = await fetch(new URL(route, BASE), { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`GET ${route}: HTTP ${response.status}`);
  return response.json();
}
function atomic(value) {
  if (!/^[0-9]+$/.test(String(value))) throw new Error('Invalid atomic USDC amount');
  return BigInt(value);
}
async function main() {
  let exclusions = [];
  try {
    exclusions = JSON.parse(await readFile(path.join(__dirname, 'state/exclusions.json'), 'utf8'));
    if (!Array.isArray(exclusions) || exclusions.some(id => !/^\d+$/.test(String(id)))) {
      throw new Error('Expected an array of numeric listing ids');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.error('1f916: state/exclusions.json missing; treating exclusions as empty');
  }
  const excluded = new Set(exclusions.map(String));
  const payload = await get('/api/listings');
  if (!Array.isArray(payload.listings)) throw new Error('Missing listings array');
  if (payload.has_more) throw new Error('Listings response is incomplete (has_more); refusing partial feed');
  const entries = [];
  for (const summary of payload.listings) {
    const id = String(summary.listing_id ?? summary.id);
    if (!/^\d+$/.test(id)) throw new Error('Invalid listing id');
    if (excluded.has(id)) continue;
    const complete = ['state', 'funding_mode', 'amount_atomic', 'funds_seen_atomic', 'expiry',
      'funder', 'title', 'thread', 'max_awards', 'submissions_count', 'token'].every(k => Object.hasOwn(summary, k))
      && summary.economics?.available_award_capacity != null;
    const listing = complete ? summary : await get(`/api/listings/${id}`);
    if (listing.state !== 'open' || listing.funding_mode !== 'verified') continue;
    if (!(Number(listing.economics?.available_award_capacity) > 0)) continue;
    const expiry = Number(listing.expiry) * 1000;
    if (!Number.isFinite(expiry) || expiry <= Date.now() || listing.expired === true) continue;
    // This rail also lists other tokens; never label those awards USDC.
    if (String(listing.token).toLowerCase() !== USDC) continue;
    const amount = atomic(listing.amount_atomic);
    if (listing.funds_seen_atomic == null || atomic(listing.funds_seen_atomic) < amount) continue;
    const price = Number(amount) / 1e6;
    if (!Number.isFinite(price) || amount <= 0n) throw new Error(`Invalid award on listing ${id}`);
    const action = new URL(listing.thread, BASE);
    if (action.origin !== BASE || !/^\/api\/post\/\d+$/.test(action.pathname)) {
      throw new Error(`Invalid thread URL on listing ${id}`);
    }
    entries.push({ source: '1f916', kind: 'funded_gig', id, title: listing.title,
      seller: listing.funder, currency: 'USDC', price, reference_price: null,
      discount_pct: null, signal: 'verified_funded', action: action.href,
      extra: { max_awards: listing.max_awards, expiry: new Date(expiry).toISOString(),
        submissions_count: listing.submissions_count ?? listing.submissions?.length ?? 0 } });
  }
  console.error(`1f916: inspected ${payload.listings.length} listings; emitted ${entries.length}`);
  process.stdout.write(JSON.stringify(entries) + '\n');
}
main().catch(error => { console.error(`1f916: ${error.message}`); process.exitCode = 1; });
