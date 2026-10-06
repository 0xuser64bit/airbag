// The landing's crash test as data, shared by the replay and the site's share image: the same BTC
// long, the same scripted wick, and what @airbag/risk (the engine's own math) says happens. The
// engine's test plays this exact path and fires at frame 14, fills at 15.

import {
  applyTrim,
  CRASH_BACK_AT,
  CRASH_FILL_AT,
  CRASH_LINE_AT,
  CRASH_LIQ_AT,
  CRASH_PATH,
  counterfactualReturn,
  type Position,
  planDeploy,
} from '@airbag/risk';

export const PATH = CRASH_PATH;
export const LINE_AT = CRASH_LINE_AT;
export const FILL_AT = CRASH_FILL_AT;
export const LIQ_AT = CRASH_LIQ_AT;
export const BACK_AT = CRASH_BACK_AT;

export const btc: Position = {
  side: 'long',
  size: 1,
  entry: 100_000,
  deposit: 10_000,
  funding: 0,
  maintenance: 0.04,
};
export const plan = planDeploy(btc, 97_000, 0, { target: 0.1, maxTrim: 0.5, useSpare: false });
export const trim = plan.kind === 'trim' ? plan.fraction : 0;
export const trimmed = applyTrim(btc, trim, 97_000).position;
/** What the liquidation at $94,000 returns: 80% of what's left. */
export const returned = counterfactualReturn(btc);
