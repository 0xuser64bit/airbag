// Pieces both backtest pages share: the header and footer, a liquidation's story, its chart.

import { fmt } from '@airbag/risk';
import Link from 'next/link';
import { Brand } from '@/components/ui.tsx';
import { type BacktestRow, warningSeconds } from '@/lib/backtest.ts';
import s from './backtest.module.css';

export function Header() {
  return (
    <header className={s.header}>
      <Brand size={24} text={15} />
      <nav aria-label="Main" className={s.headerLinks}>
        <Link href="/#how">How it works</Link>
        <Link href="/backtest">Backtest</Link>
        <Link href="/connect" className="btn btn-primary btn-sm">
          Protect my positions
        </Link>
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className={s.footer}>
      <p className={`display ${s.tagline}`}>Get trimmed, not liquidated.</p>
      <p className="muted">
        Airbag checks Perpl positions every Monad block and trims just enough before the liquidation
        engine can close all of it.
      </p>
      <Link href="/connect" className="btn btn-secondary">
        Try the simulation
      </Link>
    </footer>
  );
}

export function story(r: BacktestRow): string {
  const warning = warningSeconds(r);
  const trims = r.deploys.filter((d) => d.trimmed > 0 && d.block < r.block);
  const firstTrim = trims[0];
  const lead =
    warning === null
      ? ''
      : `Its Airbag line, ${fmt.price(r.line)}, was crossed ${fmt.duration(warning * 1000)} earlier. `;
  const what = firstTrim
    ? `Airbag’s replay trimmed ${fmt.pct(firstTrim.trimmed, 1)} at ${fmt.price(firstTrim.fill)}${trims.length > 1 ? `, then ${trims.length - 1} more time${trims.length > 2 ? 's' : ''}` : ''}, and liquidation moved to ${fmt.price(trims.at(-1)?.liquidationAfter)}. `
    : 'It was one lot, too small to trim within the 50% cap. ';
  const held =
    r.outcome === 'open' || r.outcome === 'liquidated-later'
      ? `When Perpl liquidated the original, the trimmed position was still open, worth ${fmt.usd(r.atLiquidation)}.`
      : '';
  return `Perpl liquidated this ${r.market} ${r.side} at a mark of ${fmt.price(r.markAtLiquidation)} and returned ${fmt.usd(r.returned)}. ${lead}${what}${held}`;
}

export function traceProps(r: BacktestRow) {
  const before = r.deploys.filter((d) => d.trimmed > 0 && d.block < r.block);
  return {
    symbol: r.market,
    path: r.path,
    line: r.line,
    liquidation: r.liquidation,
    after: before.at(-1)?.liquidationAfter ?? null,
    trims: r.deploys
      .filter((d) => d.trimmed > 0 && d.fill !== null)
      .map((d) => [(d.filled ?? d.block) - r.block, d.fill ?? 0] as [number, number])
      .filter(([b]) => b >= (r.path[0]?.[0] ?? 0) && b <= (r.path.at(-1)?.[0] ?? 0)),
    liquidatedMark: r.markAtLiquidation,
  };
}

export function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd className="num">{v}</dd>
    </div>
  );
}

export function Gauge({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: 'liq' | 'airbag';
}) {
  return (
    <div className={s.gauge}>
      <div className={s.gaugeHead}>
        <span>{label}</span>
        <span className={`num ${tone} ${s.gaugeValue}`}>{fmt.usd(value)}</span>
      </div>
      <div className={s.track}>
        <div
          className={s.fill}
          style={{ width: `${Math.max(2, (value / max) * 100)}%`, background: `var(--${tone})` }}
        />
      </div>
    </div>
  );
}
