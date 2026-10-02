// The landing's crash test as data, shared by the replay and the site's share image: the same BTC
// long, the same scripted wick, and what @airbag/risk (the engine's own math) says happens. The
// engine's test plays this exact path and fires at frame 14, fills at 15.

import { applyTrim, counterfactualReturn, type Position, planDeploy } from '@airbag/risk';

export const PATH = [
  100000, 99900, 99960, 99700, 99420, 99500, 99100, 98800, 98900, 98400, 98100, 98200, 97700, 97300,
  97000, 97000, 96400, 95900, 95300, 94800, 94400, 94000, 94500, 95200, 95900, 96600, 97200, 97700,
  98200, 98600, 98900, 99200, 99100, 99400, 99600, 99500, 99800, 99900, 100000, 100000, 100000,
];
export const LINE_AT = 14;
export const FILL_AT = 15;
export const LIQ_AT = 21;
export const BACK_AT = 38;

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
