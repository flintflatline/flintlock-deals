# Deals origin

Requires Node.js 20+; no dependencies to install.

```sh
cd origin
DEALS_URL=https://example.com/snapshot.json npm start
```

Set `DEALS_URL` to the public raw JSON snapshot URL (required). Set `PORT`
to override 8080. The service listens on `0.0.0.0`; deploy by running
`npm start` from this directory with those environment variables configured.
SIGTERM exits with status 0.

`GET /health` returns health JSON. `GET /deals` fetches and caches valid
snapshot JSON for 60 seconds, sharing concurrent fetches. Each fetch has a
10-second timeout and logs one result line to stdout. Redirects are rejected.
Upstream failures preserve the last good snapshot indefinitely; without one,
the response is 503. Successful snapshot responses include
`x-snapshot-fetched-at`. All other routes and methods return JSON 404.
