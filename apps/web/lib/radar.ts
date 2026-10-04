// Perpl mainnet right now, read from its contract on Monad: how many open positions sit near
// liquidation, and how many are already past the line where Airbag (Balanced, armed at entry)
// would have trimmed them. Server-only. Null when Perpl or the chain doesn't answer in time, so
// a page shows nothing rather than a stale or invented number.

import {
  collateralDecimals,
  fetchContext,
  fromChainPosition,
  networkFromEnv,
  perplChain,
  scaled,
} from '@airbag/perpl';
import { airbagLine, crossed, distanceToLiquidation, SENSITIVITY } from '@airbag/risk';

export interface Radar {
  /** When it was read. */
  at: number;
  positions: number;
  /** Notional at the mark, dollars. */
  notional: number;
  /** Within 5% of liquidation. */
  near: { count: number; notional: number };
  /** Past the Balanced line from entry: where Airbag would already have deployed. */
  pastLine: { count: number; notional: number };
}

const TTL_MS = 5 * 60_000;
let cached: { at: number; value: Promise<Radar | null> } | undefined;

/** The latest reading, at most five minutes old. */
export function liveRadar(now = Date.now()): Promise<Radar | null> {
  if (!cached || now - cached.at > TTL_MS) cached = { at: now, value: read(now) };
  return cached.value;
}

async function read(now: number): Promise<Radar | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((r) => {
    timer = setTimeout(() => r(null), 10_000);
  });
  try {
    return await Promise.race([scan(now).catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function scan(now: number): Promise<Radar> {
  // Mainnet's defaults, whatever network this site's engine runs on; only the RPC can change.
  const net = networkFromEnv({
    NODE_ENV: process.env.NODE_ENV,
    PERPL_NETWORK: 'mainnet',
    ...(process.env.RADAR_RPC_URL ? { MONAD_RPC_URL: process.env.RADAR_RPC_URL } : {}),
  });
  const ctx = await fetchContext(net.apiUrl);
  const cd = collateralDecimals(ctx);
  const chain = perplChain(net.rpcUrl, ctx.instances[0]?.address ?? '', net.chainId);
  const radar: Radar = {
    at: now,
    positions: 0,
    notional: 0,
    near: { count: 0, notional: 0 },
    pastLine: { count: 0, notional: 0 },
  };
  // One market at a time: public RPCs cap requests per second, and a page is 200 positions.
  for (const m of ctx.markets.filter((x) => x.config.is_open)) {
    const { positions, markPns, markValid } = await chain.openPositions(m.perpetual_id);
    if (!markValid) continue;
    const mark = scaled(Number(markPns), m.config.price_decimals);
    for (const p of positions) {
      const risk = fromChainPosition(p, m, cd);
      if (!risk) continue;
      const notional = risk.size * mark;
      radar.positions += 1;
      radar.notional += notional;
      if (distanceToLiquidation(risk, mark) < 0.05) {
        radar.near.count += 1;
        radar.near.notional += notional;
      }
      if (crossed(risk.side, mark, airbagLine(risk, risk.entry, SENSITIVITY.balanced).price)) {
        radar.pastLine.count += 1;
        radar.pastLine.notional += notional;
      }
    }
  }
  return radar;
}
