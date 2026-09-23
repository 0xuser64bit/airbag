'use client';

// The dashboard (design/Dashboard.dc.html; Deployed.dc.html when Airbag has just acted;
// MobileHome.dc.html on a phone).

import { fmt } from '@airbag/risk';
import { useEffect, useState } from 'react';
import { useLive } from '@/components/AppShell.tsx';
import s from '@/components/dashboard.module.css';
import {
  AirbagSummary,
  Closest,
  DeployDetailCard,
  KeepsFalling,
  KeyHealth,
  PausedBanner,
  PositionCards,
  PositionsTable,
  RecentDeploys,
  SimControls,
  StatusBanner,
  useDeploy,
} from '@/components/dashboard.tsx';
import { BlockTape } from '@/components/ui.tsx';
import { useEngineConfig } from '@/lib/api.ts';

/** A deploy stays on the dashboard for ten minutes, then moves to the list. */
const FRESH_MS = 10 * 60_000;

export default function DashboardPage() {
  const { data } = useLive();
  const config = useEngineConfig();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const latest = data?.deploys[0];
  const fresh =
    latest &&
    (latest.phase === 'closing' ||
      latest.phase === 'readding' ||
      now - latest.createdAt < FRESH_MS);
  const detail = useDeploy(fresh ? latest : undefined);
  if (!data) return null;

  const [first, ...rest] = data.positions;
  const deployed = detail ? data.positions.find((p) => p.marketId === detail.marketId) : undefined;
  const others = detail ? data.positions.filter((p) => p !== deployed) : rest;

  return (
    <div className={s.grid}>
      <main className={s.main}>
        <StatusBanner data={data} />
        {data.status === 'paused' && <PausedBanner />}
        {detail ? (
          <DeployDetailCard d={detail} />
        ) : (
          first && <Closest p={first} settings={data.settings} />
        )}
        <PositionsTable data={data} />
        <PositionCards positions={others} />
        {data.account && (
          <div className={s.tiles}>
            <div>
              <span className="muted" style={{ fontSize: 12 }}>
                Account value
              </span>
              <span className="num" style={{ fontSize: 16 }}>
                {fmt.usd(data.account.value)}
              </span>
            </div>
            <div>
              <span className="muted" style={{ fontSize: 12 }}>
                Spare margin
              </span>
              <span className="num" style={{ fontSize: 16 }}>
                {fmt.usd(data.account.spare)}
              </span>
            </div>
          </div>
        )}
        {!first && data.positions.length === 0 && (
          <section
            className="card"
            style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <h2 style={{ fontSize: 17, fontWeight: 600 }}>No open positions</h2>
            <p className="muted" style={{ fontSize: 15 }}>
              Airbag checks every block and arms on anything you open in{' '}
              {config.data?.markets.map((m) => m.symbol).join(' or ') ?? 'a covered market'}.
            </p>
          </section>
        )}
        <BlockTape tape={data.tape} />
      </main>
      <aside className={s.aside}>
        {detail?.phase === 'done' && detail.kind === 'trim' && (
          <KeepsFalling d={detail} p={deployed} />
        )}
        <AirbagSummary settings={data.settings} slippageBps={config.data?.slippageBps} />
        <KeyHealth data={data} now={now} />
        <RecentDeploys deploys={data.deploys} />
        {data.mode === 'simulation' && (
          <SimControls symbols={config.data?.markets.map((m) => m.symbol) ?? []} />
        )}
      </aside>
    </div>
  );
}
