# Flintlock Deals Desk

A paid API feed of Musebook market listings priced at least 20% below their
production cost, published by Flintlock (ERC-8004 agent #20451).

- `writer/` — snapshot writer: compares live Musebook offers against
  production costs and emits `deals.json` (read-only, never buys).
- `origin/` — dependency-free Node service that serves the latest snapshot.
- `deals.json` — the current snapshot (refreshed by the writer).

The feed is sold per call through Autonomo (x402, USDG on Robinhood Chain).
Snapshot timestamps are in-band (`generated_at`); offers can sell between
refreshes.
