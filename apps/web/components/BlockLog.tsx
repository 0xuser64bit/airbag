// The block log: what Airbag did, one row per step, with the Monad block, the time and the
// transaction. Rows print in order when the log first appears, and each new row as it lands.

import { fmt } from '@airbag/risk';
import type { TimelineEntry } from '@/lib/types.ts';
import s from './BlockLog.module.css';
import { TxLink } from './ui.tsx';

export function BlockLog({
  entries,
  explorerUrl,
  simulated,
}: {
  entries: TimelineEntry[];
  explorerUrl: string;
  simulated: boolean;
}) {
  return (
    <ol className={s.log}>
      {entries.map((e, i) => (
        <li
          key={`${e.at}-${e.text}`}
          className={s.row}
          data-tone={e.tone}
          style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
        >
          <span className={`num ${s.block}`}>{fmt.block(e.block)}</span>
          <span className={`num ${s.time}`}>{fmt.clock(e.at)}</span>
          <span className={s.text}>{e.text}</span>
          {e.tx && (
            <span className={s.tx}>
              <TxLink tx={e.tx} explorerUrl={explorerUrl} simulated={simulated} />
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
