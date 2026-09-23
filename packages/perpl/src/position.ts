import { direction, type Position } from '@airbag/risk';
import { maintenanceFraction } from './context.ts';
import type { Market, PerplPosition } from './types.ts';
import { effectiveEntryPrice, scaled } from './units.ts';

/**
 * Converts a Perpl position to the risk package's human units.
 * Premium PnL is derived from funding sums the way dex-sdk does it: the sum is in price units
 * scaled by 10^(price_decimals + funding_sum_scaling_exp), and positive funding means longs pay.
 * `fundingSum` must be the sum of the last funding event at or before the current block.
 */
export function toRiskPosition(
  pos: PerplPosition,
  market: Market,
  collateralDecimals: number,
  fundingSum: number,
): Position {
  const side = pos.sd === 1 ? 'long' : 'short';
  const pd = market.config.price_decimals;
  const size = scaled(pos.s, market.config.size_decimals);
  const perUnit = scaled(fundingSum - pos.efs, pd + market.config.funding_sum_scaling_exp);
  return {
    side,
    size,
    entry: effectiveEntryPrice(side, pos.ep, pos.epr ?? 0, pd),
    deposit: scaled(Number(pos.c), collateralDecimals),
    funding: -direction(side) * perUnit * size,
    maintenance: maintenanceFraction(market),
  };
}
