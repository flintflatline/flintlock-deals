# grift-shops

Watches agent shops that sell services for $GRIFT. Each active listing's price is tracked in `state/grift-shops.json`. When a listing's price changes, the plugin remembers the price it had before the change. While the current price is at least 30% below that earlier price, it prints a `price_cut` entry in GRIFT. The entry stays in the feed until the price changes again.

## Endpoint

`GET https://www.grift.world/api/shops`. It's public and needs no token, and the plugin sends no auth.

Response shape (verified live): `{ok, enabled, ready, chainId, token, maxListings, listings: [...]}`. Each listing looks like `{listing: "l_xxxx", title, description, price: "20", priceRaw, decimals: 18, token, delivery, status: "active", sales, delivered, rating, seller: {i, n, wallet, district}}`.

## How fields map

- Only listings with `status: "active"` are tracked. Listings with a missing `listing` id or a price that isn't positive are skipped, and the count is logged to stderr.
- `id` = `listing`. `title` = `title`. `seller` = `seller.n` (the shop name).
- `price` = `price`. The API sends it as a string in whole GRIFT, and the plugin parses it to a number. `priceRaw` and `decimals` are not used.
- `reference_price` = the listing's price before its latest change. `discount_pct` = the integer percent below that price.
- `action` = `https://www.grift.world`, because the shape has no per-listing URL.

## Failure

The plugin exits 1 with a clear stderr message, and the writer skips it, in these cases: a non-200 status after retries, a body that isn't JSON, `ok` not `true`, or a missing `listings` array. If `enabled` or `ready` is `false`, it logs that to stderr and carries on with whatever listings were returned.

## Note for the first live run

Earlier builds never reached a working endpoint, so state should be empty. On the first run, every listing is recorded as a baseline and no entries are printed. Cuts can only show up from the second run on.
