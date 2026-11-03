# grift-agents

Lists every agent launched by the Grift agent factory (`0xE8607242C9BD22c0062dA897a1cE83020D163308`) on Robinhood Chain. It reads the factory's `Launched(agent, token, curve)` logs over public RPC. It's a new-launch watch only: for now it always prints `[]`.

## What it does

- Starts scanning at a fixed floor, block `100000000` (`START_BLOCK`). The public RPC serves no historical state, so the old `eth_getCode` deploy-block search could never work and has been removed. If state from an older build points below the floor (that build's fallback started at block 0), the next run jumps to the floor, keeps the launches it already knows, and restarts backfill tagging. From there it scans `eth_getLogs` in chunks that resize themselves: they halve when the RPC rejects a range and double when a chunk comes back small. Progress (`last_block`, chunk size, known launches) is saved to `state/grift-agents.json` after every chunk.
- Each run stops scanning after about 20 seconds so it stays inside the writer's 30-second plugin timeout. If the factory is old, the first full pass can take several runs. Later runs only scan the new blocks.
- Every launch whose agent isn't in state yet gets a line in `~/workspace/autonomo/watch-log.md` with the detection time, agent, token, curve, block and tx. Launches found before the first catch-up to the chain head are tagged `backfill`, and everything after is tagged `new launch`, so the first run's backlog can't be mistaken for fresh launches. The log line is written before state moves forward, so a crash can only log a launch twice, never drop it.

## Limitation: no curve prices yet

The contract asks for curve spot prices using the peak method, but only if `~/workspace/grift/launchpad-recipe.md` documents a clean way to read them. The Claude lane that wrote this plugin could not open that file: its sandbox only reads inside `autonomo/app`. It did not guess at a curve ABI. So the plugin ships enumeration and the watch only, and never prints a price.

To add prices later, take the curve's read-only spot-price call from the recipe. Read it per known `curve` address in `state.launches`, track `peak` and `sightings` per agent the way `grift-coins.js` does, and emit `curve_discount` / `below_peak` entries when the price is at least 20% below a peak recorded over 6 or more prior runs. Skip any curve where the read is unclear. Prices are omitted, never estimated.

## To check on the first live run

- That the factory's first `Launched` event is at or above block `100000000`. Any launch below the floor is never seen. If the real deploy block turns out to be known, raising `START_BLOCK` to it shortens the first pass.
- The RPC's `eth_getLogs` range limit. The chunk size settles on it automatically and is saved in state.
