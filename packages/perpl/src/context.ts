import type { Context, Market } from './types.ts';

/** GET /api/v1/pub/context: chain, exchange, collateral token, markets. Read at startup. */
export async function fetchContext(apiUrl: string): Promise<Context> {
  const res = await fetch(`${apiUrl}/v1/pub/context`);
  if (!res.ok) throw new Error(`GET /v1/pub/context failed: ${res.status}`);
  return (await res.json()) as Context;
}

export function marketBySymbol(ctx: Context, symbol: string): Market {
  const m = ctx.markets.find((x) => (x.symbol || x.name).toUpperCase() === symbol.toUpperCase());
  if (!m) throw new Error(`market ${symbol} not in context`);
  return m;
}

export function collateralDecimals(ctx: Context): number {
  const tokenId = ctx.instances[0]?.collateral_token_id;
  const token = ctx.tokens.find((t) => t.id === tokenId) ?? ctx.tokens[0];
  if (!token) throw new Error('no collateral token in context');
  return token.decimals;
}

/** `maintenance_margin` is leverage in hundredths (2500 = 25x), so the fraction is 100 / value. */
export const maintenanceFraction = (m: Market): number => 100 / m.config.maintenance_margin;
