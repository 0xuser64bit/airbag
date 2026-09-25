'use client';

// The dashboard, one panel: the primary flight display for the closest position (in its deploy
// state for ten minutes after Airbag acts), a runway per position and the per-block strip in the
// main bay; mode, key and deploys in the side bay.

import { useEffect, useState } from 'react';
import { useLive } from '@/components/AppShell.tsx';
import s from '@/components/dashboard.module.css';
import {
  AirbagSummary,
  BlockStrip,
  FlightDisplay,
  InterventionDisplay,
  KeepsFalling,
  KeyHealth,
  PausedBanner,
  Positions,
  RecentDeploys,
  SimControls,
  StatusBanner,
  useDeploy,
} from '@/components/dashboard.tsx';
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

  const [first] = data.positions;
  const deployed = detail ? data.positions.find((p) => p.marketId === detail.marketId) : undefined;

  return (
    <div className={s.grid}>
      <h1 className="visually-hidden">Positions</h1>
      <div className={s.main}>
        <StatusBanner data={data} />
        {data.status === 'paused' && <PausedBanner />}
        {detail ? (
          <InterventionDisplay d={detail} p={deployed} />
        ) : (
          first && <FlightDisplay p={first} settings={data.settings} />
        )}
        <Positions data={data} />
        <BlockStrip tape={data.tape} />
      </div>
      <aside className={s.aside} aria-label="Airbag, key and deploys">
        {detail?.phase === 'done' && detail.kind === 'trim' && (
          <KeepsFalling d={detail} p={deployed} />
        )}
        <AirbagSummary settings={data.settings} slippageBps={config.data?.slippageBps} />
        <KeyHealth data={data} now={now} perplUrl={config.data?.perplUrl} />
        <RecentDeploys deploys={data.deploys} />
        {data.mode === 'simulation' && (
          <SimControls symbols={config.data?.markets.map((m) => m.symbol) ?? []} />
        )}
      </aside>
    </div>
  );
}
