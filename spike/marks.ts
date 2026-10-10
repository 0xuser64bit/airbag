// Perpl's mark price history from the chain: every MarkUpdated(perpId, pricePNS) the Exchange
// emitted, by block. Read in fixed chunks and cached under spike/out/marks, so a rerun only
// fetches blocks it hasn't seen. rpc2.monad.xyz answers up to ~10k logs over 20k blocks, and Perpl
// emits ~4k mark updates per 10k blocks across its markets, so a chunk is 12k blocks; an RPC with
// tighter caps gets it in halves.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { toEventSelector } from 'viem';

const CHUNK = 12_000;
const DIR = new URL('./out/marks/', import.meta.url);
const TOPIC = toEventSelector('MarkUpdated(uint256,uint256)');

interface Log {
  blockNumber: string;
  data: string;
}

/** Scaled marks per perp id, each a list of [block, price] in block order. */
export type MarkHistory = Map<number, [block: number, price: number][]>;

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(60_000),
      });
      const body = (await res.json()) as { result?: T; error?: { message: string } };
      if (body.error) throw new Error(body.error.message);
      return body.result as T;
    } catch (err) {
      if (attempt >= 4 || /size|limit|exceed|range/i.test(String(err))) throw err;
      await new Promise((r) => setTimeout(r, 1_000 * 2 ** attempt));
    }
  }
}

/** Logs in [from, to], halving the range whenever the RPC says the answer is too big. */
async function logs(url: string, exchange: string, from: number, to: number): Promise<Log[]> {
  try {
    return await rpc<Log[]>(url, 'eth_getLogs', [
      {
        address: exchange,
        topics: [TOPIC],
        fromBlock: `0x${from.toString(16)}`,
        toBlock: `0x${to.toString(16)}`,
      },
    ]);
  } catch (err) {
    if (from === to || !/size|limit|exceed|range/i.test(String(err))) throw err;
    const mid = Math.floor((from + to) / 2);
    return [...(await logs(url, exchange, from, mid)), ...(await logs(url, exchange, mid + 1, to))];
  }
}

/** One chunk's marks as flat [block, perpId, price] triples. */
async function chunk(url: string, exchange: string, from: number, to: number): Promise<number[]> {
  const file = new URL(`${from}.json`, DIR);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as number[];
  const flat: number[] = [];
  for (const l of await logs(url, exchange, from, Math.min(from + CHUNK - 1, to))) {
    flat.push(
      Number.parseInt(l.blockNumber, 16),
      Number.parseInt(l.data.slice(2, 66), 16),
      Number.parseInt(l.data.slice(66, 130), 16),
    );
  }
  return flat;
}

/**
 * Every mark from `from` to `to` (inclusive). Whole chunks are cached; the one holding the head
 * is not, since it is still filling up.
 */
export async function markHistory(
  url: string,
  exchange: string,
  from: number,
  to: number,
  onProgress?: (done: number, total: number) => void,
): Promise<MarkHistory> {
  mkdirSync(DIR, { recursive: true });
  const starts: number[] = [];
  for (let s = Math.floor(from / CHUNK) * CHUNK; s <= to; s += CHUNK) starts.push(s);
  const out: MarkHistory = new Map();
  let done = 0;
  const results = new Array<number[]>(starts.length);
  // Four requests at a time: fast, and well under a public RPC's per-second limit.
  const queue = [...starts.keys()];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
        const s = starts[i] ?? 0;
        const flat = await chunk(url, exchange, s, to);
        if (s + CHUNK - 1 < to) writeFileSync(new URL(`${s}.json`, DIR), JSON.stringify(flat));
        results[i] = flat;
        onProgress?.(++done, starts.length);
      }
    }),
  );
  for (const flat of results) {
    for (let i = 0; i < flat.length; i += 3) {
      const block = flat[i] ?? 0;
      if (block < from || block > to) continue;
      const perp = flat[i + 1] ?? 0;
      const list = out.get(perp) ?? [];
      list.push([block, flat[i + 2] ?? 0]);
      out.set(perp, list);
    }
  }
  return out;
}
