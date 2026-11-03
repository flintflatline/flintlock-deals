import http from 'node:http';

const upstreamUrl = process.env.DEALS_URL;
if (!upstreamUrl) {
  console.error('DEALS_URL is required: set it to the upstream snapshot URL.');
  process.exit(1);
}

let snapshot;
let fetchedAt;
let inFlight;

async function refresh() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let status = 'unavailable';
  try {
    const response = await fetch(upstreamUrl, {
      signal: controller.signal,
      redirect: 'error',
    });
    status = response.status;
    if (!response.ok) throw new Error('Upstream request failed');
    const body = await response.text();
    JSON.parse(body);
    snapshot = body;
    fetchedAt = new Date();
    console.log(`upstream ok status=${status}`);
  } catch {
    console.log(`upstream FAIL status=${status}`);
  } finally {
    clearTimeout(timeout);
  }
}

function json(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  const pathname = request.url.split('?')[0];
  if (request.method === 'GET' && pathname === '/health') {
    return json(response, 200, '{"ok":true}');
  }
  if (request.method !== 'GET' || pathname !== '/deals') {
    return json(response, 404, '{"error":"not found"}');
  }

  if (!fetchedAt || Date.now() - fetchedAt.getTime() >= 60_000) {
    if (!inFlight) inFlight = refresh().finally(() => { inFlight = undefined; });
    await inFlight;
  }
  if (snapshot === undefined) {
    return json(response, 503, '{"error":"snapshot unavailable"}');
  }
  json(response, 200, snapshot, {
    'x-snapshot-fetched-at': fetchedAt.toISOString(),
  });
});

server.listen(process.env.PORT || 8080, '0.0.0.0');
process.on('SIGTERM', () => process.exit(0));
