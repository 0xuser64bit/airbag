// The committed backtest results, read on the server only.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Backtest } from '@/lib/backtest.ts';
import type { FalseAlarms } from '@/lib/false-alarms.ts';

const read = <T>(file: string): T =>
  JSON.parse(readFileSync(join(process.cwd(), 'lib', file), 'utf8')) as T;

let cached: Backtest | undefined;
let alarms: FalseAlarms | undefined;

/** What tools/backtest.ts wrote. Read once per server process. */
export function loadBacktest(): Backtest {
  cached ??= read<Backtest>('backtest.json');
  return cached;
}

/** What tools/false-alarms.ts wrote, over the same window. */
export function loadFalseAlarms(): FalseAlarms {
  alarms ??= read<FalseAlarms>('false-alarms.json');
  return alarms;
}
