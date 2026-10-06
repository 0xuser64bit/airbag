// A wallet on Perpl mainnet, through Airbag: its open positions right now, read from the
// contract, with where Airbag's line would sit and what it would do there; then every
// liquidation of its account the backtest replayed. Nothing to link and nothing to sign.

import {
  closeFeeRate,
  collateralDecimals,
  fromChainPosition,
  perplChain,
  scaled,
  symbolOf,
} from '@airbag/perpl';
import {
  airbagLine,
  crossed,
  distanceToLiquidation,
  fmt,
  liquidationPrice,
  type Plan,
  type Position,
  planDeploy,
  SENSITIVITY,
} from '@airbag/risk';
import type { Metadata } from 'next';
import Link from 'next/link';
import { isAddress } from 'viem';
import d from '@/components/dashboard.module.css';
import { Runway } from '@/components/Runway.tsx';
import { lensLiquidations } from '@/lib/lens.ts';
import { mainnet, mainnetContext } from '@/lib/radar.ts';
import { engineMode } from '@/lib/stats.ts';
import s from '../backtest/backtest.module.css';
import { loadBacktest } from '../backtest/data.ts';
import { Footer, Gauge, Header, LiquidationTable, WalletForm } from '../backtest/parts.tsx';

export const metadata: Metadata = {
  title: 'Your Perpl positions, through Airbag',
  description:
    'Any wallet’s Perpl mainnet positions with where Airbag would act, and its past liquidations replayed.',
  alternates: { canonical: '/wallet' },
};

type Props = { searchParams: Promise<{ address?: string | string[] }> };

/** Airbag's defaults: Balanced, trims until liquidation is 10% away, at most half. */
const POLICY = { target: 0.1, maxTrim: 0.5, useSpare: true };

interface Live {
  symbol: string;
  perpId: number;
  priceDecimals: number;
  sizeDecimals: number;
  position: Position;
  mark: number;
  liquidation: number;
  distance: number;
  line: number;
  past: boolean;
  /** What Airbag would do: at the line, or now if the mark is already past it. */
  plan: Plan;
  /** The liquidation price AirbagLog computed onchain, when its address is configured. */
  onchain?: number;
}

type Reading = Awaited<ReturnType<typeof readChain>>;
/**
 * Readings by address for 30 s: a burst of requests for one wallet costs the public RPC one read,
 * so it can't get this server's IP refused and take the landing's radar down with it.
 */
const recent = new Map<string, { at: number; value: Promise<Reading> }>();

function read(address: `0x${string}`, now = Date.now()): Promise<Reading> {
  const key = address.toLowerCase();
  const hit = recent.get(key);
  if (hit && now - hit.at < 30_000) return hit.value;
  if (recent.size > 1_000) recent.clear();
  const value = readChain(address);
  recent.set(key, { at: now, value });
  // A failed read isn't kept: trying again should read again.
  void value.then((v) => {
    if (v === undefined && recent.get(key)?.value === value) recent.delete(key);
  });
  return value;
}

/** The wallet's account and open positions, or undefined if Perpl or Monad didn't answer. */
async function readChain(address: `0x${string}`) {
  try {
    const net = mainnet();
    const ctx = await mainnetContext();
    const cd = collateralDecimals(ctx);
    const chain = perplChain(net.rpcUrl, ctx.instances[0]?.address ?? '', net.chainId);
    const account = await chain.account(address);
    if (!account) return { account: null, positions: [] as Live[] };
    const spare = scaled(Number(account.balanceCns - account.lockedCns), cd);
    // Read together, these go out as one Multicall3 call.
    const positions = await Promise.all(
      ctx.markets
        .filter((m) => m.config.is_open)
        .map(async (m): Promise<Live | undefined> => {
          const p = await chain.position(m.perpetual_id, account.id);
          const base = fromChainPosition(p, m, cd);
          if (!base) return undefined;
          const position = { ...base, closeFeeRate: closeFeeRate(m) };
          const mark = scaled(Number(p.markPns), m.config.price_decimals);
          const line = airbagLine(position, position.entry, SENSITIVITY.balanced).price;
          const past = crossed(position.side, mark, line);
          return {
            symbol: symbolOf(m),
            perpId: m.perpetual_id,
            priceDecimals: m.config.price_decimals,
            sizeDecimals: m.config.size_decimals,
            position,
            mark,
            liquidation: liquidationPrice(position),
            distance: distanceToLiquidation(position, mark),
            line,
            past,
            plan: planDeploy(position, past ? mark : line, spare, POLICY),
          };
        }),
    );
    const open = positions.filter((x) => x !== undefined).sort((a, b) => a.distance - b.distance);
    // AirbagLog's own reading of each liquidation price, when the contract is configured.
    const onchain = await lensLiquidations(
      net.rpcUrl,
      open.map((x) => ({ perpId: x.perpId, accountId: account.id })),
    );
    return {
      account: { id: account.id, spare },
      positions: open.map((x, i) => {
        const raw = onchain?.[i];
        return raw == null ? x : { ...x, onchain: scaled(Number(raw), x.priceDecimals) };
      }),
    };
  } catch {
    return undefined;
  }
}

function whatAirbagDoes(x: Live): string {
  const p = x.plan;
  if (p.kind === 'none')
    return x.past
      ? `${x.symbol} is past its Airbag line, ${fmt.price(x.line)}, but liquidation is still more than 10% away, so Airbag would hold.`
      : `If ${x.symbol} reaches ${fmt.price(x.line)}, Airbag has nothing to do: liquidation is already 10% away.`;
  const at = x.past
    ? `${x.symbol} is past its Airbag line, ${fmt.price(x.line)}, so Airbag would act now: it`
    : `If ${x.symbol} reaches ${fmt.price(x.line)}, Airbag`;
  if (p.kind === 'margin')
    return `${at} adds ${fmt.usd(p.amount)} of spare margin, moving liquidation to ${fmt.price(p.liquidation)}.`;
  const size = `${fmt.size(p.fraction * x.position.size, x.sizeDecimals)} ${x.symbol}`;
  return `${at} trims ${size}${p.capped ? ', the most it allows,' : ''} and puts the margin back: liquidation ${p.liquidation === null ? 'gone with the position' : `moves to ${fmt.price(p.liquidation)}`}.`;
}

export default async function WalletPage({ searchParams }: Props) {
  const raw = (await searchParams).address;
  const address = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
  const valid = isAddress(address);
  const [live, mode] = await Promise.all([valid ? read(address) : undefined, engineMode()]);
  const account = live?.account;
  const bt = loadBacktest();
  const past = account ? bt.rows.filter((r) => r.accountId === account.id).reverse() : [];
  const returned = past.reduce((sum, r) => sum + r.returned, 0);
  const held = past.reduce((sum, r) => sum + r.atLiquidation, 0);
  const days = Math.round(bt.days);
  const status = !address
    ? 'Paste a wallet to see its Perpl mainnet positions, where Airbag would act on each, and every liquidation of it in the backtest.'
    : !valid
      ? 'That isn’t a wallet address.'
      : live === undefined
        ? 'Perpl or Monad didn’t answer. Try again in a minute.'
        : account === null || account === undefined
          ? 'This wallet has no Perpl mainnet account.'
          : `Perpl account #${account.id}: ${live.positions.length === 0 ? 'no open positions' : live.positions.length === 1 ? 'one open position' : `${live.positions.length} open positions`}, ${fmt.usd(account.spare)} spare, ${past.length === 0 ? 'no liquidation' : past.length === 1 ? 'one liquidation' : `${past.length} liquidations`} in the last ${days} days.`;
  return (
    <div className={s.page}>
      <Header />
      <main id="main" className={s.detail}>
        <p className="label">Perpl mainnet · read from the contract</p>
        <h1 className={`display ${s.h1} ${s.detailTitle}`}>
          Your Perpl positions, through Airbag.
        </h1>
        <div className={s.detailStory}>
          <WalletForm address={address} />
        </div>
        <p className={`${s.story} ${s.detailStory}`} role="status">
          {status}
        </p>

        {live && live.positions.length > 0 && (
          <section className={s.section} aria-labelledby="now">
            <h2 id="now" className={`display ${s.h2}`}>
              Right now
            </h2>
            <ul className={`well ${d.runways}`}>
              {live.positions.map((x) => (
                <li key={x.symbol} className={d.runwayRow}>
                  <div className={d.runwayHead}>
                    <h3 className={d.posName}>
                      <span className={d.symbol}>{x.symbol}</span> {x.position.side} ·{' '}
                      <span className="num">
                        {fmt.size(x.position.size, x.sizeDecimals)} {x.symbol}
                      </span>
                    </h3>
                    {x.past && (
                      <span className="ann" data-state="alert" data-size="sm">
                        Past the line
                      </span>
                    )}
                    <p className={d.posDistance}>
                      <span className={`num ${d.posPct}`}>{fmt.pct(x.distance)}</span>
                      <span className="faint">to liquidation</span>
                    </p>
                  </div>
                  <Runway
                    liquidation={x.liquidation}
                    line={x.line}
                    mark={x.mark}
                    entry={x.position.entry}
                    near={x.past}
                  />
                  <p className="muted">{whatAirbagDoes(x)}</p>
                  {x.onchain !== undefined && (
                    <p className="faint">
                      AirbagLog on Monad computes its liquidation price from Perpl’s contract:{' '}
                      <span className="num">{fmt.price(x.onchain)}</span>
                      {Math.abs(x.onchain - x.liquidation) <= 1.5 * 10 ** -x.priceDecimals
                        ? ', the same to the tick.'
                        : '.'}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <p className={s.note}>
              Airbag’s defaults: the line where half the margin cushion from entry is gone, trims
              until liquidation is 10% away, at most half the position, spare margin first when it’s
              enough, Perpl’s taker fee included. Marks as Perpl’s contract reads them now.
            </p>
            {mode === 'live' ? (
              <Link href="/connect" className={`btn btn-primary ${s.cta}`}>
                Protect them with Airbag
              </Link>
            ) : (
              // The public demo is a simulation: say so before anyone expects their own positions.
              <p className={s.story}>
                This site’s engine runs the simulation, on a paper exchange: it can’t act on these
                positions yet. <Link href="/connect">Try it with a test wallet</Link> to watch it
                trim a wick like the ones above.
              </p>
            )}
          </section>
        )}

        {past.length > 0 && (
          <section className={s.section} aria-labelledby="past">
            <h2 id="past" className={`display ${s.h2}`}>
              Liquidated {past.length === 1 ? 'once' : `${past.length} times`} in {days} days
            </h2>
            <p className={s.story}>
              Replayed through Airbag’s engine on the marks Perpl published: the liquidations
              returned {fmt.usd(returned)}; on the Airbag path, at the same blocks, the positions
              would have held {fmt.usd(held)}.
            </p>
            <div className={`well ${s.gauges}`}>
              <Gauge
                label="Returned by Perpl’s liquidations"
                value={returned}
                max={Math.max(returned, held, 1)}
                tone="liq"
              />
              <Gauge
                label="Held on the Airbag path, same blocks"
                value={held}
                max={Math.max(returned, held, 1)}
                tone="airbag"
              />
            </div>
            <LiquidationTable rows={past} />
          </section>
        )}

        <p className={`${s.note} ${s.detailStory}`}>
          <Link href="/backtest">
            How the backtest was run, and all {bt.rows.length} liquidations
          </Link>
        </p>
      </main>
      <Footer />
    </div>
  );
}
