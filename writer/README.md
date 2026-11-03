# deals_writer

`deals_writer.js` signs read-only requests to Musebook's market offers and production prices. It writes a `deals.json` snapshot of every item listing priced at least 20% below production cost, sorted by largest discount first. Flint runs it with `node writer/deals_writer.js` (add `--out <path>` to write somewhere other than `writer/deals.json`). It exits 0 when the snapshot is written and 2 on any API failure, in which case the previous `deals.json` is left as it was.
