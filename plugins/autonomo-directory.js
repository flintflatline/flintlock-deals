#!/usr/bin/env node
'use strict';
const BASE = 'https://autonomo.fun';
async function get(page) {
  const route = `/api/v1/projects?limit=100&page=${page}&sort=new`;
  const response = await fetch(BASE + route, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`GET ${route}: HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload.data) || !Number.isInteger(payload.meta?.pages)
      || payload.meta.pages < 0 || payload.meta.page !== page) throw new Error('Invalid catalog pagination');
  return payload;
}
async function main() {
  const groups = new Map();
  const seen = new Set();
  const first = await get(1);
  const pages = first.meta.pages;
  if (pages > 1000) throw new Error('Unexpected catalog size');
  for (let page = 1; page <= Math.max(pages, 1); page++) {
    const payload = page === 1 ? first : await get(page);
    if (payload.meta.pages !== pages || payload.meta.total !== first.meta.total) {
      throw new Error('Catalog changed during pagination; retry next run');
    }
    for (const project of payload.data) {
      if (typeof project.slug !== 'string' || seen.has(project.slug)) throw new Error('Missing or duplicate project slug');
      seen.add(project.slug);
      const price = project.minPriceUsd;
      if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0
          || !(project.endpointCount > 0) || typeof project.category !== 'string') continue;
      if (!groups.has(project.category)) groups.set(project.category, []);
      groups.get(project.category).push(project);
    }
  }
  if (seen.size !== first.meta.total) throw new Error('Incomplete catalog; refusing partial medians');
  const entries = [];
  for (const [category, projects] of groups) {
    projects.sort((a, b) => a.minPriceUsd - b.minPriceUsd || a.slug.localeCompare(b.slug));
    const middle = Math.floor(projects.length / 2);
    const median = projects.length % 2 ? projects[middle].minPriceUsd
      : (projects[middle - 1].minPriceUsd + projects[middle].minPriceUsd) / 2;
    const cheapest = projects[0];
    if (median <= 0 || cheapest.minPriceUsd > median * 0.7) continue;
    const action = new URL(cheapest.url, BASE);
    if (action.origin !== BASE || !action.pathname.startsWith('/projects/')) throw new Error('Invalid public project URL');
    entries.push({ source: 'autonomo', kind: 'api_deal', id: cheapest.slug,
      title: cheapest.name, seller: cheapest.host ?? cheapest.name, currency: 'USD',
      price: cheapest.minPriceUsd, reference_price: median,
      discount_pct: Math.round((1 - cheapest.minPriceUsd / median) * 100),
      signal: 'cheapest_in_category', action: action.href,
      extra: { category, category_size: projects.length, price_basis: 'minPriceUsd — a USD quote per call from the public directory; the listing\'s own settlement asset varies (USDC, USDG, …) — check the listing before use',
        networks: cheapest.networks ?? [] } });
  }
  entries.sort((a, b) => b.discount_pct - a.discount_pct || a.id.localeCompare(b.id));
  console.error(`autonomo: inspected ${seen.size} projects in ${pages} pages; emitted ${entries.length}`);
  process.stdout.write(JSON.stringify(entries) + '\n');
}
main().catch(error => { console.error(`autonomo: ${error.message}`); process.exitCode = 1; });
