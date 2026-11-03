# Public deal feeds

These standalone scripts use Node 18+ and its standard library/global fetch.
From `~/workspace/autonomo`, run `node app/plugins/<name>.js`; from this
`app` directory, use the commands below. Each successful run prints one JSON
array to stdout, with diagnostics on stderr. Any HTTP, JSON, or incomplete
pagination error exits nonzero without printing partial results. All network
requests are unauthenticated GETs with a 30-second timeout per request.

## 1f916 gigs

`onef916-gigs.js` reads `https://1f916.ai/api/listings` and hydrates listings
from `/api/listings/<id>` whenever required fields are missing. It emits only
`state === "open"`, verified, unexpired Base-USDC awards with remaining award
capacity and a recorded balance at least equal to the award. Atomic amounts
are compared with BigInt and converted to human USDC units for output.
`submitted` is a distinct state and is not treated as `open`.

Exclusions come from `plugins/state/exclusions.json`, resolved relative to the
script. This lane does not create or overwrite that shared file (the brief
assigns its `[65]` seed to the other lane). A missing file is treated as empty
with a stderr notice; malformed exclusions fail the run. There is no history
state to persist. The action uses the listing's absolute API thread URL:
reconnaissance of the public front door did not establish a canonical human
listing URL pattern. `reference_price` and `discount_pct` are null.

Verified funding is a recorded wallet-balance snapshot, not escrow or a
reservation of funds; the source itself explicitly makes this distinction.

## Autonomo directory

`autonomo-directory.js` reads the free public
`https://autonomo.fun/api/v1/projects` discovery API in pages of 100, using documented `sort=new`. It checks
all pages before computing medians, rejects missing/duplicate slugs and
incomplete or changing totals, and excludes missing prices and projects
without paid endpoints. For each public category it emits one cheapest
project if its minimum per-call price is at least 30% below that category's
median. An even-sized median averages the two middle prices; ties are broken
by slug. Entries link to public `/projects/<slug>` pages.

The contract requires USDG as the output currency. The source's `minPriceUsd`
is a USD quote, and external services may accept other settlement assets;
`extra.price_basis` explicitly records this limitation. No conversion or
payment is performed. See [AUTONOMO-RECON.md](AUTONOMO-RECON.md) for the public
pages, endpoint shapes, currency semantics and pagination findings.

## Verification — 2026-11-03 UTC

Run from `~/workspace/autonomo/app`:

```sh
node --check plugins/onef916-gigs.js
node --check plugins/autonomo-directory.js
node --test plugins/tests/feeds.test.js
node plugins/onef916-gigs.js > /tmp/feeds-gigs-output.json
node plugins/autonomo-directory.js > /tmp/feeds-directory-output.json
```

Syntax checks passed. All five fixture tests passed: gig hydration, exclusion
and eligibility filters; suppression of partial data after a detail failure;
paginated even median and the exact 30% threshold; incomplete catalog failure;
and singleton categories.

The live 1f916 run exited 0: 8 listings inspected, **0 entries emitted**.
The exclusion file was absent and the expected warning was logged.
The initial directory runs using `sort=price` and `sort=name` exited 1 with
**no stdout** because the API repeated slugs across page boundaries. A full
name-sorted diagnostic traversal returned 4,292 rows but only 4,291 unique
slugs (the repeated `defi-yield` record occurred on pages 11 and 12).

The final live directory run with `sort=new` exited 0: **4,292 unique projects
inspected in 43 pages; 1 entry emitted**. The `service` category contained
4,053 priced projects, with median 0.01. The selected listing,
`2captcha-x402-paysponge-com`, has source-reported `minPriceUsd: 0`, producing
a 100% discount. Zero is preserved as an advertised quote; no paid service
was called to validate it. The JSON outputs were parsed and checked for all
v2 fields, finite prices, integer-or-null discounts, and valid action URLs.

Reconnaissance also used `curl -fsSL` GETs against the Autonomo home page,
`/docs`, `/api-docs`, `/api/v1/projects?limit=100&page=1`,
`/api/v1/gateways`, `/api/v1/projects/token-price`, and the 1f916 front door,
`/api/listings`, and `/api/listings/60`. An attempted GET of 1f916 `/human`
returned 404. A Node/global-fetch diagnostic traversed all 43 `sort=name`
pages to establish the duplicate-row issue. All requests were read-only.

After the other lane created `state/exclusions.json` containing `[65]`, the
same live 1f916 command was repeated: exit 0, 8 listings inspected, **0 entries
emitted**, with no missing-file warning. Listing 65 is excluded before any
detail request.
