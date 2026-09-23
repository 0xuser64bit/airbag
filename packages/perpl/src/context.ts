import type { Context, FundingEvent, Market } from './types.ts';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

/** GET /api/v1/pub/context: chain, exchange, collateral token, markets. Read at startup. */
export async function fetchContext(apiUrl: string): Promise<Context> {
  const ctx = await getJson<Context>(`${apiUrl}/v1/pub/context`);
  if (!ctx.instances?.[0]?.address || !Array.isArray(ctx.markets)) {
    throw new Error('Perpl context is missing the exchange instance or markets');
  }
  return ctx;
}

/**
 * Recent funding events for every market, oldest first. The newest event can apply ahead of
 * the head, so the engine needs the one before it too. `to` may run a funding interval past now.
 */
export async function fetchRecentFunding(
  apiUrl: string,
  intervalSec: number,
  now = Date.now(),
): Promise<Record<string, FundingEvent[]>> {
  const from = now - 3 * intervalSec * 1000;
  const to = now + intervalSec * 1000;
  const res = await getJson<{ d?: Record<string, FundingEvent[]> }>(
    `${apiUrl}/v1/market-data/funding/${from}-${to}`,
  );
  return res.d ?? {};
}

/** A market's display symbol. Some mainnet markets have an empty `symbol`. */
export const symbolOf = (m: Market): string => (m.symbol || m.name.replace(/\s*perp$/i, '')).trim();

export function marketBySymbol(ctx: Context, symbol: string): Market {
  const m = ctx.markets.find((x) => symbolOf(x).toUpperCase() === symbol.toUpperCase());
  if (!m) throw new Error(`market ${symbol} not in context`);
  return m;
}

export function collateralDecimals(ctx: Context): number {
  const tokenId = ctx.instances[0]?.collateral_token_id;
  const token = ctx.tokens.find((t) => t.id === tokenId);
  if (!token) throw new Error(`collateral token ${tokenId} not in context`);
  return token.decimals;
}

/** `maintenance_margin` is leverage in hundredths (2500 = 25x), so the fraction is 100 / value. */
export const maintenanceFraction = (m: Market): number => 100 / m.config.maintenance_margin;
