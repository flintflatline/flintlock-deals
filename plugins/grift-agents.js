// grift-agents plugin (read-only): enumerates the Grift agent factory's
// Launched(agent, token, curve) events over public Robinhood Chain RPC,
// caches them in state/grift-agents.json, and appends every launch not yet in
// state to ~/workspace/autonomo/watch-log.md (the new-launch watch).
// Emits [] — no curve spot prices yet; see README-grift-agents.md.
// Scanning starts at a fixed floor block and is incremental under a time
// budget so a run fits the writer's 30s timeout; the first full pass may take
// several runs.
// Usage: node plugins/grift-agents.js   (JSON array on stdout, logs on stderr)
const fs = require("fs");
const path = require("path");
const { log, readJson, writeJsonAtomic, statePath, fetchRetry, emit, fail } = require("./lib/common");

const NAME = "grift-agents";
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = "0xe8607242c9bd22c0062da897a1ce83020d163308";
const TOPIC0 = "0x84b21bef2ca786b6e266d3a3bad27be699c07a4438c206078ee9973ec10c1b45";
const WATCH_LOG = path.join(process.env.HOME, "workspace", "autonomo", "watch-log.md");
const BUDGET_MS = 20000;
const CHUNK_INIT = 50000;
const CHUNK_MIN = 100;
const CHUNK_MAX = 500000;
// Fixed scan floor. The RPC serves no historical state, so the factory's
// deploy block can't be found via eth_getCode.
const START_BLOCK = 100000000;

const started = Date.now();
const overBudget = () => Date.now() - started > BUDGET_MS;
const hex = (n) => "0x" + n.toString(16);
const topicAddr = (t) => "0x" + String(t).slice(-40).toLowerCase();

let rpcId = 0;
async function rpc(method, params) {
  const { status, body } = await fetchRetry(
    RPC,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) },
    { timeoutMs: 8000, retries: 2 },
  );
  if (status !== 200) throw new Error(`${method} http=${status} ${body.slice(0, 200)}`);
  let res;
  try { res = JSON.parse(body); } catch (_) { throw new Error(`${method} returned non-JSON`); }
  if (res.error) {
    const err = new Error(`${method} rpc error ${res.error.code}: ${res.error.message}`);
    err.rpc = true;
    throw err;
  }
  return res.result;
}

function appendWatch(lines) {
  if (!lines.length) return;
  fs.mkdirSync(path.dirname(WATCH_LOG), { recursive: true });
  if (!fs.existsSync(WATCH_LOG)) fs.writeFileSync(WATCH_LOG, "# watch-log\n\n");
  fs.appendFileSync(WATCH_LOG, lines.join("\n") + "\n");
}

async function main() {
  const file = statePath(NAME);
  const state = readJson(file, {});
  state.launches = state.launches || {};
  state.chunk = state.chunk || CHUNK_INIT;
  const save = () => writeJsonAtomic(file, state);

  const head = parseInt(await rpc("eth_blockNumber", []), 16);
  if (!Number.isFinite(head)) throw new Error("eth_blockNumber returned no block");

  // First run, or state left by the old deploy-block search (which fell back
  // to block 0): start or jump to the floor. Known launches are kept.
  if (state.start_block == null || state.last_block < START_BLOCK - 1) {
    state.start_block = START_BLOCK;
    state.last_block = START_BLOCK - 1;
    state.backfill_done = false;
    save();
  }
  if (head < START_BLOCK) log(NAME, `head ${head} is below the scan floor ${START_BLOCK}; nothing to scan yet`);

  let from = state.last_block + 1;
  let newCount = 0;
  while (from <= head && !overBudget()) {
    const to = Math.min(from + state.chunk - 1, head);
    let logs;
    try {
      logs = await rpc("eth_getLogs", [{ address: FACTORY, topics: [TOPIC0], fromBlock: hex(from), toBlock: hex(to) }]);
    } catch (e) {
      // Range/result-size refusals come back as RPC errors: shrink and retry.
      if (e.rpc && state.chunk > CHUNK_MIN) {
        state.chunk = Math.max(CHUNK_MIN, Math.floor(state.chunk / 2));
        continue;
      }
      throw e;
    }
    if (!Array.isArray(logs)) throw new Error("eth_getLogs returned no array");

    const now = new Date().toISOString();
    const tag = state.backfill_done ? "new launch" : "backfill";
    const lines = [];
    for (const l of logs) {
      if (!l.topics || l.topics.length < 4) continue;
      const agent = topicAddr(l.topics[1]);
      if (state.launches[agent]) continue;
      const rec = { token: topicAddr(l.topics[2]), curve: topicAddr(l.topics[3]), block: parseInt(l.blockNumber, 16), tx: l.transactionHash };
      state.launches[agent] = rec;
      lines.push(`- ${now} grift-agents ${tag}: agent ${agent} token ${rec.token} curve ${rec.curve} (block ${rec.block}, tx ${rec.tx})`);
    }
    // Record launches in the watch log before advancing state, so a crash
    // between the two re-logs rather than silently drops a launch.
    appendWatch(lines);
    newCount += lines.length;
    state.last_block = to;
    if (to === head) state.backfill_done = true;
    if (logs.length < 1000 && state.chunk < CHUNK_MAX) state.chunk = Math.min(CHUNK_MAX, state.chunk * 2);
    save();
    from = to + 1;
  }

  const behind = head - state.last_block;
  log(NAME, `${Object.keys(state.launches).length} launches known, ${newCount} added this run, ` +
    (behind > 0 ? `${behind} blocks still to scan (budget)` : "caught up to head"));
  emit([]);
}

main().catch((e) => fail(NAME, e.message));
