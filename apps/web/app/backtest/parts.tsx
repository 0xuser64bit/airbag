// Pieces both backtest pages share: the header and footer, a liquidation's story, its chart.

import { fmt } from '@airbag/risk';
import Link from 'next/link';
import { Brand } from '@/components/ui.tsx';
import { type BacktestRow, utc, warningSeconds } from '@/lib/backtest.ts';
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
      : `Its Airbag line, ${fmt.usd(r.line)}, was crossed ${fmt.duration(warning * 1000)} earlier. `;
  const what = firstTrim
    ? `Airbag’s replay trimmed ${fmt.pct(firstTrim.trimmed, 1)} at ${fmt.usd(firstTrim.fill)}${trims.length > 1 ? `, then ${trims.length - 1} more time${trims.length > 2 ? 's' : ''}` : ''}, and liquidation moved to ${fmt.usd(trims.at(-1)?.liquidationAfter)}. `
    : 'It was one lot, too small to trim within the 50% cap. ';
  const held =
    r.outcome === 'open' || r.outcome === 'liquidated-later'
      ? `When Perpl liquidated the original, the trimmed position was still open, worth ${fmt.usd(r.atLiquidation)}.`
      : '';
  return `Perpl liquidated this ${r.market} ${r.side} at a mark of ${fmt.usd(r.markAtLiquidation)} and returned ${fmt.usd(r.returned)}. ${lead}${what}${held}`;
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

/** Fixed column widths, so the folded rows line up with the ones above them. */
export function LiquidationTable({ rows, head = true }: { rows: BacktestRow[]; head?: boolean }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead className={head ? undefined : 'visually-hidden'}>
          <tr>
            <th scope="col">Position</th>
            <th scope="col">Liquidated</th>
            <th scope="col">Warning</th>
            <th scope="col" className={s.money}>
              Perpl returned
            </th>
            <th scope="col" className={s.money}>
              Airbag path
            </th>
            <th scope="col" className={s.money}>
              A day later
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <LiquidationRow key={r.id} r={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LiquidationRow({ r }: { r: BacktestRow }) {
  const warning = warningSeconds(r);
  const untrimmed = r.outcome === 'untrimmed' || r.outcome === 'liquidated';
  return (
    <tr>
      <th scope="row">
        <Link href={`/backtest/${r.id}`} prefetch={false}>
          {r.market} {r.side} · <span className="num">{Math.round(r.leverage)}x</span>
        </Link>
        <span className={`num ${s.sub}`}>
          {fmt.size(r.size, r.sizeDecimals)} {r.market}
        </span>
      </th>
      <td data-label="Liquidated" className="num">
        {utc(r.at)}
      </td>
      <td data-label="Warning" className="num">
        {warning === null ? '—' : fmt.duration(warning * 1000)}
      </td>
      <td data-label="Perpl returned" className={`num liq ${s.money}`}>
        {fmt.usd(r.returned)}
      </td>
      <td data-label="Airbag path" className={`num ${untrimmed ? 'liq' : 'airbag'} ${s.money}`}>
        {fmt.usd(r.atLiquidation)}
        {untrimmed && <span className={s.sub}>one lot, not trimmable</span>}
      </td>
      <td data-label="A day later" className={`num ${s.money}`}>
        {fmt.usd(r.end.value)}
        {r.end.liquidated && r.outcome === 'liquidated-later' && (
          <span className={s.sub}>liquidated at its new price</span>
        )}
      </td>
    </tr>
  );
}

/** Opens a wallet's page: a plain GET form, so it works before any script loads. */
export function WalletForm({ address = '' }: { address?: string }) {
  return (
    <form action="/wallet" method="get" className={s.walletForm}>
      <div className="field">
        <label htmlFor="wallet-address">
          Check a Perpl wallet: its positions now and its liquidations
        </label>
        <div className={s.walletRow}>
          <input
            id="wallet-address"
            name="address"
            className="input"
            defaultValue={address}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            pattern="^0x[0-9a-fA-F]{40}$"
            required
          />
          <button type="submit" className="btn btn-secondary">
            Check
          </button>
        </div>
      </div>
    </form>
  );
}
