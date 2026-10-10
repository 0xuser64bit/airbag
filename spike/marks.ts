// Perpl's Exchange history from the chain, by block: every MarkUpdated(perpId, pricePNS) it
// emitted, and any other events a script asks for. Read in fixed chunks and cached under
// spike/out/<name>, so a rerun only fetches blocks it hasn't seen. rpc2.monad.xyz answers up to
// ~10k logs over 20k blocks, and Perpl emits ~4k mark updates per 10k blocks across its markets,
// so a chunk is 12k blocks; an RPC with tighter caps gets it in halves.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { toEventSelector } from 'viem';

const CHUNK = 12_000;
const MARK = toEventSelector('MarkUpdated(uint256,uint256)');

export interface Log {
  blockNumber: string;
  topics: string[];
  data: string;
}

/** The `i`th 32-byte word of a log's data. Perpl indexes none of its event fields. */
export const word = (l: Log, i: number) =>
  Number.parseInt(l.data.slice(2 + 64 * i, 66 + 64 * i), 16);

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
async function logs(
  url: string,
  exchange: string,
  topics: string[],
  from: number,
  to: number,
): Promise<Log[]> {
  try {
    return await rpc<Log[]>(url, 'eth_getLogs', [
      {
        address: exchange,
        topics: [topics],
        fromBlock: `0x${from.toString(16)}`,
        toBlock: `0x${to.toString(16)}`,
      },
    ]);
  } catch (err) {
    if (from === to || !/size|limit|exceed|range/i.test(String(err))) throw err;
    const mid = Math.floor((from + to) / 2);
    return [
      ...(await logs(url, exchange, topics, from, mid)),
      ...(await logs(url, exchange, topics, mid + 1, to)),
    ];
  }
}

export interface History {
  /** The cache folder under spike/out, one per set of topics. */
  name: string;
  topics: string[];
  /** A log as a row of `width` numbers; the block comes first. */
  row: (log: Log) => number[];
  width: number;
}

/**
 * Every row from `from` to `to` (inclusive), in chain order. Whole chunks are cached, flat;
 * the one holding the head is not, since it is still filling up.
 */
export async function logHistory(
  url: string,
  exchange: string,
  { name, topics, row, width }: History,
  from: number,
  to: number,
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const dir = new URL(`./out/${name}/`, import.meta.url);
  mkdirSync(dir, { recursive: true });
  const starts: number[] = [];
  for (let s = Math.floor(from / CHUNK) * CHUNK; s <= to; s += CHUNK) starts.push(s);
  let done = 0;
  const results = new Array<number[]>(starts.length);
  // Four requests at a time: fast, and well under a public RPC's per-second limit.
  const queue = [...starts.keys()];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
        const s = starts[i] ?? 0;
        const file = new URL(`${s}.json`, dir);
        let flat: number[];
        if (existsSync(file)) flat = JSON.parse(readFileSync(file, 'utf8')) as number[];
        else {
          flat = (await logs(url, exchange, topics, s, Math.min(s + CHUNK - 1, to))).flatMap(row);
          if (s + CHUNK - 1 < to) writeFileSync(file, JSON.stringify(flat));
        }
        results[i] = flat;
        onProgress?.(++done, starts.length);
      }
    }),
  );
  const rows: number[][] = [];
  for (const flat of results)
    for (let i = 0; i < flat.length; i += width) {
      const block = flat[i] ?? 0;
      if (block >= from && block <= to) rows.push(flat.slice(i, i + width));
    }
  return rows;
}

/** Every mark from `from` to `to` (inclusive). */
export async function markHistory(
  url: string,
  exchange: string,
  from: number,
  to: number,
  onProgress?: (done: number, total: number) => void,
): Promise<MarkHistory> {
  const rows = await logHistory(
    url,
    exchange,
    {
      name: 'marks',
      topics: [MARK],
      row: (l) => [Number.parseInt(l.blockNumber, 16), word(l, 0), word(l, 1)],
      width: 3,
    },
    from,
    to,
    onProgress,
  );
  const out: MarkHistory = new Map();
  for (const [block = 0, perp = 0, price = 0] of rows) {
    const list = out.get(perp) ?? [];
    list.push([block, price]);
    out.set(perp, list);
  }
  return out;
}
