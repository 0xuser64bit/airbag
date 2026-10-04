// One wallet's Perpl liquidations in the backtest: its mainnet account read from the chain, then
// every replay of a position of that account, and what the Airbag path would have held.

import { perplChain } from '@airbag/perpl';
import { fmt } from '@airbag/risk';
import type { Metadata } from 'next';
import Link from 'next/link';
import { isAddress } from 'viem';
import { mainnet } from '@/lib/radar.ts';
import s from '../backtest.module.css';
import { loadBacktest } from '../data.ts';
import { Footer, Gauge, Header, LiquidationTable, WalletForm } from '../parts.tsx';

export const metadata: Metadata = {
  title: 'Your liquidations, replayed through Airbag',
  description: 'A wallet’s Perpl mainnet liquidations, and what Airbag would have kept.',
};

type Props = { searchParams: Promise<{ address?: string | string[] }> };

/** The wallet's Perpl mainnet account id, null if it has none, undefined if the chain failed. */
async function accountOf(address: `0x${string}`): Promise<number | null | undefined> {
  try {
    const net = mainnet();
    const chain = perplChain(net.rpcUrl, loadBacktest().exchange, net.chainId);
    return (await chain.account(address))?.id ?? null;
  } catch {
    return undefined;
  }
}

export default async function WalletPage({ searchParams }: Props) {
  const raw = (await searchParams).address;
  const address = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
  const valid = isAddress(address);
  const account = valid ? await accountOf(address) : undefined;
  const bt = loadBacktest();
  const rows = account ? bt.rows.filter((r) => r.accountId === account).reverse() : [];
  const returned = rows.reduce((sum, r) => sum + r.returned, 0);
  const held = rows.reduce((sum, r) => sum + r.atLiquidation, 0);
  const max = Math.max(returned, held, 1);
  return (
    <div className={s.page}>
      <Header />
      <main className={s.detail}>
        <p className="label">
          Backtest · Perpl {bt.network} · {Math.round(bt.days)} days to {fmt.block(bt.head)}
        </p>
        <h1 className={`display ${s.h1} ${s.detailTitle}`}>
          {rows.length > 0
            ? `Perpl liquidated this wallet ${rows.length === 1 ? 'once' : `${rows.length} times`}.`
            : 'Your liquidations, replayed.'}
        </h1>
        <div className={s.detailStory}>
          <WalletForm address={address} />
        </div>
        <p className={`${s.story} ${s.detailStory}`} role="status">
          {!address
            ? 'Paste a wallet to find its Perpl mainnet account and every liquidation of it the backtest replayed.'
            : !valid
              ? 'That isn’t a wallet address.'
              : account === undefined
                ? 'Monad didn’t answer. Try again in a minute.'
                : account === null
                  ? 'This wallet has no Perpl mainnet account.'
                  : rows.length === 0
                    ? `Perpl account #${account} had no full liquidation in these ${Math.round(bt.days)} days.`
                    : `Perpl account #${account}. The liquidations returned ${fmt.usd(returned)}; on the Airbag path, at the same blocks, the positions would have held ${fmt.usd(held)}.`}
        </p>
        {rows.length > 0 && (
          <>
            <div className={`well ${s.gauges}`}>
              <Gauge
                label="Returned by Perpl’s liquidations"
                value={returned}
                max={max}
                tone="liq"
              />
              <Gauge
                label="Held on the Airbag path, same blocks"
                value={held}
                max={max}
                tone="airbag"
              />
            </div>
            <section className={s.section} aria-labelledby="yours">
              <h2 id="yours" className={`display ${s.h2}`}>
                Each one
              </h2>
              <LiquidationTable rows={rows} />
            </section>
          </>
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
