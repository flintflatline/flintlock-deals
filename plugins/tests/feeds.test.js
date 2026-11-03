'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
async function run(name, respond, exclusions = '[65]') {
  let stdout = '', stderr = '', exitCode = 0;
  const calls = [];
  const context = {
    __dirname: path.resolve(__dirname, '..'), URL, AbortSignal, console: { error: s => { stderr += s; } },
    require: name => name === 'node:fs/promises' ? { readFile: async () => exclusions } : require(name),
    fetch: async url => { calls.push(String(url)); return { ok: true, json: async () => respond(String(url)) }; },
    process: { stdout: { write: s => { stdout += s; } }, set exitCode(v) { exitCode = v; } }
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '..', name + '.js'), 'utf8'), context);
  for (let i = 0; i < 50; i++) await new Promise(resolve => setImmediate(resolve));
  return { stdout, stderr, exitCode, calls };
}
const gig = { state: 'open', funding_mode: 'verified', amount_atomic: '1234567',
  funds_seen_atomic: '1234567', economics: { available_award_capacity: 1 },
  expiry: 4102444800, token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  title: 'Example', funder: 'Funder', thread: '/api/post/10', max_awards: 1, submissions_count: 2 };
test('gigs: detail hydration, all funding filters and exclusions', async () => {
  const variants = [gig, { ...gig, state: 'submitted' }, { ...gig, funding_mode: 'promise' },
    { ...gig, economics: { available_award_capacity: 0 } }, { ...gig, expiry: 1 },
    { ...gig, funds_seen_atomic: '1234566' }, { ...gig, token: 'other' }];
  const result = await run('onef916-gigs', url => url.endsWith('/api/listings')
    ? { listings: [...variants.map((_, id) => ({ id })), { id: 65 }], has_more: false }
    : variants[Number(url.split('/').pop())]);
  assert.equal(result.exitCode, 0);
  const entries = JSON.parse(result.stdout);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].price, 1.234567);
  assert.equal(entries[0].discount_pct, null);
  assert.ok(!result.calls.some(url => url.endsWith('/65')));
});
test('gigs: any detail failure suppresses already collected entries', async () => {
  const result = await run('onef916-gigs', url => {
    if (url.endsWith('/api/listings')) return { listings: [{ id: 1 }, { id: 2 }] };
    if (url.endsWith('/1')) return gig;
    throw new Error('HTTP 429');
  });
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /429/);
});
const project = (slug, price) => ({ slug, name: slug, category: 'service', minPriceUsd: price,
  endpointCount: 1, url: '/projects/' + slug });
test('directory: paginated even median, null prices, threshold, deterministic ties', async () => {
  const result = await run('autonomo-directory', url => {
    const page = Number(new URL(url).searchParams.get('page'));
    return { data: page === 1 ? [project('b', 7), project('a', 7)]
      : [project('c', 13), project('d', 20), project('unpriced', null)],
    meta: { page, pages: 2, total: 5 } };
  });
  const entries = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 0); assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'a'); assert.equal(entries[0].reference_price, 10);
  assert.equal(entries[0].discount_pct, 30);
});
test('directory: incomplete catalogs fail without partial output', async () => {
  const result = await run('autonomo-directory', () => ({ data: [project('a', 1)], meta: { page: 1, pages: 1, total: 2 } }));
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, '');
});
test('directory: singleton category cannot be a discount', async () => {
  const result = await run('autonomo-directory', () => ({ data: [project('a', 1)], meta: { page: 1, pages: 1, total: 1 } }));
  assert.equal(result.exitCode, 0); assert.deepEqual(JSON.parse(result.stdout), []);
});
