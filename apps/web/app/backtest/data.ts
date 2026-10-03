// The committed backtest results, read on the server only.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Backtest } from '@/lib/backtest.ts';

let cached: Backtest | undefined;

/** What spike/backtest.ts wrote. Read once per server process. */
export function loadBacktest(): Backtest {
  cached ??= JSON.parse(readFileSync(join(process.cwd(), 'lib/backtest.json'), 'utf8')) as Backtest;
  return cached;
}
