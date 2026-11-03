# deals_writer (v2)

`deals_writer.js` builds a single `deals.json` from the Musebook core plus every plugin in `app/plugins/`. Flint runs it with `node writer/deals_writer.js`. Add `--out <path>` to write somewhere other than `writer/deals.json`; `publish.sh` depends on that flag. The contract for plugins and entries is in `app/PLUGINS.md`.

## Sources

- **musebook** (core): the writer signs read-only requests for Musebook's market offers and production prices. It lists item offers priced at least 20% below production cost. Entries keep their v1 fields (`offer_id`, `kind`, `asking_musebucks`, `production_cost_musebucks`, `accept`, …) and add the v2 fields `source: "musebook"`, `id`, `currency: "MUSEBUCKS"`, `price`, `reference_price` and `signal: "below_production_cost"`.
- **Plugins**: the writer finds plugins by listing `app/plugins/*.js`, top level only. Helpers in `app/plugins/lib/` and state in `app/plugins/state/` are never run. The current plugins are `grift-coins`, `grift-agents` (a watch only; it always prints `[]`) and `grift-shops` (endpoint not confirmed yet). Each has a README note.

## Output

The output is `{ version: 2, generated_at, sources, count, deals }`. `sources` lists `musebook` plus each plugin that ran successfully. Deals are deduplicated by `source + ":" + id` (first one wins), then sorted by `discount_pct` from highest to lowest. Entries with a null `discount_pct` go last. The file is written atomically: a temp file, then a rename.

## Failure semantics

- **Musebook fails** (identity, API, or a malformed response): the writer exits 2 and leaves the existing `deals.json` untouched, the same as v1. Plugins run only after the Musebook core succeeds. So a core failure doesn't leave plugin processes running, and plugin state never advances for a snapshot that won't be written.
- **A plugin fails**: if it exits non-zero, runs past 30 seconds (it is then killed with SIGKILL), prints invalid JSON, or prints something other than an array, the writer logs it to stderr as `plugin <name> skipped: …` and leaves it out of `sources`. The run still writes. Entries without an `id` are dropped and the number dropped is logged. Plugin stderr is passed through with the prefix `[plugin <name>]`.
- Plugins run in parallel. They hit different hosts, and each one handles its own retries.
- Exit 0 means the snapshot was written. The stdout summary shows the deal count for each source.
