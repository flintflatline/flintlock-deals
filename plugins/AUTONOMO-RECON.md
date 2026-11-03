# Autonomo public catalog reconnaissance

Checked 2026-11-03 using unauthenticated GET requests only. No dashboard,
login, payment, or signed request was used.

- `https://autonomo.fun/` links Explore APIs to `/projects` and individual
  listings to `/projects/<slug>`. Its server-rendered HTML includes “from”
  prices and links, plus Next.js Flight payloads.
- `/docs` and `/api-docs` explicitly document the free, public JSON discovery
  API: `/api/v1/projects`, `/api/v1/projects/<slug>`, `/api/v1/stats`, and
  `/api/v1/gateways`. There is no need to parse Next.js internal payloads.
- `/api/v1/projects?limit=100&page=1` returned `data` and `meta` containing
  `total: 4292`, `pages: 43`, `limit: 100`, and `page: 1`. Projects include
  `slug`, `name`, `host`, `category`, `endpointCount`, `minPriceUsd`,
  `networks`, and a public relative `url`.
- The documented page-size maximum is 100. The plugin walks all pages,
  checks counts, rejects duplicate slugs and changing totals, then groups
  priced projects by the public category. Sorting by price produced duplicate
  slugs across page boundaries in the initial live run; it was rejected
  without output. The documented `sort=name` also repeated `defi-yield` across pages 11
  and 12 (4,292 raw rows, 4,291 unique slugs). The final plugin uses
  documented `sort=new`: its live run returned all 4,292 unique projects
  across 43 pages and passed the completeness checks.
- `/api/v1/projects/token-price` includes endpoint prices, networks, payment
  assets, and amounts. `/api/v1/gateways` provides explicit human-unit
  `price.usdg` and `price.autonomo` for hosted gateways, but does not cover
  the entire directory.

A clean machine-readable path exists, so the directory plugin is implemented.
Its comparison uses each project's minimum advertised per-call USD quote,
not every endpoint independently. Missing prices and projects without paid
endpoints are excluded. Categories are the site's broad taxonomy (for example
`service`), not inferred task categories. Tied cheapest projects are resolved
by slug. The median includes the cheapest project itself.

Currency caveat: the contract requests `currency: "USDG"`, while the directory
field is `minPriceUsd`. The plugin preserves that requested label and records
this quote basis in `extra.price_basis`, along with advertised networks. It
performs no conversion and does not claim every service accepts USDG; the
public docs explicitly say many external services settle in USDC. Consumers
must read the listing's payment terms before any use.

The paid `/api/v1/pro/endpoints` API is unnecessary and was not called.
No access blocker was found for the free discovery API. HTTP or schema errors
fail the run with nonzero status and no partial JSON output.

Final live result: 1 entry from the `service` category (4,053 priced
projects), median USD quote 0.01. The deterministic cheapest listing was
`2captcha-x402-paysponge-com`, whose API-reported minimum quote is 0. Zero
is preserved as an advertised quote; the plugin does not call the service
or independently validate its payment requirements.
