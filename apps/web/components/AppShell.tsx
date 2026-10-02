'use client';

// The signed-in app's frame: the masthead, an annunciator strip (protection, mode, key, feed),
// the page, and a tab bar on phones. It owns the live stream so every page shares one connection
// to the engine.

import { fmt } from '@airbag/risk';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { useSession } from '@/lib/session.ts';
import type { Dashboard, Settings } from '@/lib/types.ts';
import { type Live, useDashboard } from '@/lib/useDashboard.ts';
import s from './AppShell.module.css';
import { DeploysIcon, ListIcon, Sliders } from './icons.tsx';
import { Annunciator, type Lamp, Readout, StatusAnnunciator, useFresh } from './instruments.tsx';
import { Loader } from './Loader.tsx';
import { Page } from './Page.tsx';
import { Brand, SimBanner } from './ui.tsx';

const LiveContext = createContext<Live>({ connected: false, failed: false, unauthorized: false });
export const useLive = () => useContext(LiveContext);

/** Re-renders every `ms` so "checked 0.3 s ago" counts up between blocks. */
export function useNow(ms = 100) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const NAV = [
  { href: '/app', label: 'Positions', icon: ListIcon, exact: true },
  { href: '/app/deploys', label: 'Deploys', icon: DeploysIcon, exact: false },
  { href: '/app/settings', label: 'Settings', icon: Sliders, exact: false },
] as const;

/** "Balanced · 10% · max 50%": the mode Airbag is flying in. Short drops the cap, for phones. */
export function modeText(st: Settings, short = false): string {
  if (!st.armed) return 'Paused';
  if (st.demo) return short ? 'Demo' : 'Demo · 0.3% move';
  return `${st.sensitivity} · ${st.targetPct}%${short ? '' : ` · max ${st.maxTrimPct}%`}`;
}

/** The key lamp: OK while Perpl accepts it, inverted when the trader has to fix something. */
function keyLamp(data: Dashboard): [Lamp, string] {
  const key = data.key;
  if (!key) return ['off', 'None'];
  if (key.state === 'rejected') return ['alert', 'Rejected'];
  if (key.state === 'limited') return ['alert', 'Conn. limit'];
  if (data.account && !data.account.forwarding) return ['alert', 'One-Click off'];
  if (key.state === 'live') return ['on', 'OK'];
  return ['off', 'Connecting'];
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const session = useSession();
  const live = useDashboard(!!session, session?.token);
  const now = useNow();
  const data = live.data;

  useEffect(() => {
    if (session === null || live.unauthorized) router.replace('/connect');
    else if (data?.status === 'unlinked') router.replace('/link-key');
  }, [session, live.unauthorized, data?.status, router]);

  const active = (n: (typeof NAV)[number]) => (n.exact ? path === n.href : path.startsWith(n.href));
  const age = data?.block.at ? Math.max(0, (now - data.block.at) / 1000) : undefined;
  const reconnecting = !!data && !live.connected;
  const mode = data ? modeText(data.settings) : '';
  const modeFresh = useFresh(mode);
  const [keyState, keyText]: [Lamp, string] = data ? keyLamp(data) : ['off', ''];
  const keyFresh = useFresh(data ? keyText : undefined);
  const feedFresh = useFresh(reconnecting || data?.block.stale);

  return (
    <LiveContext.Provider value={live}>
      {data?.mode === 'simulation' && <SimBanner />}
      <div className={s.frame}>
        <header className={s.masthead}>
          <div className={s.lead}>
            <Brand href="/app" size={24} text={15} />
            <nav aria-label="App" className={s.nav}>
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={s.navLink}
                  {...(active(n) ? { 'aria-current': 'page' as const } : {})}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          {data?.account && (
            <p className={s.account}>
              <span>
                Perpl <span className="num">#{data.account.id}</span>
              </span>
              <span className="num faint">{fmt.short(data.wallet)}</span>
            </p>
          )}
        </header>

        {/* The annunciator strip: what the system is doing, block by block. */}
        <div className={s.strip}>
          <div className={s.cell}>
            <span className="label">Protection</span>
            {reconnecting ? (
              <Annunciator state="off" role="status">
                Unknown
              </Annunciator>
            ) : data ? (
              <StatusAnnunciator status={data.status} />
            ) : (
              <Annunciator state="off" role="status">
                {live.failed ? 'Engine unreachable' : 'Connecting'}
              </Annunciator>
            )}
          </div>
          {data && (
            <div className={s.cell}>
              <span className="label">Mode</span>
              <Annunciator state={data.settings.armed ? 'on' : 'off'} fresh={modeFresh}>
                <span className={s.long}>{mode}</span>
                <span className={s.short}>{modeText(data.settings, true)}</span>
              </Annunciator>
            </div>
          )}
          {data && (
            <div className={s.cell}>
              <span className="label">Key</span>
              <Annunciator state={keyState} fresh={keyFresh}>
                {keyText}
              </Annunciator>
            </div>
          )}
          {data && (
            <div className={s.cell}>
              <span className="label">Feed</span>
              <Annunciator
                state={reconnecting ? 'off' : data.block.stale ? 'alert' : 'on'}
                fresh={feedFresh}
              >
                {reconnecting ? 'Reconnecting' : data.block.stale ? 'Stale' : 'Live'}
              </Annunciator>
              <span className={`num ${s.block}`}>
                {data.block.onchain ? (
                  <a
                    className={s.blockLink}
                    href={`${data.explorerUrl}/block/${data.block.head}`}
                    target="_blank"
                    rel="noreferrer"
                    title="This Monad block on the explorer"
                  >
                    <Readout value={fmt.block(data.block.head)} />
                  </a>
                ) : (
                  <Readout value={fmt.block(data.block.head)} />
                )}
                <span className={`faint ${s.age}`}>
                  {age === undefined ? '' : ` · ${age.toFixed(1)} s ago`}
                </span>
              </span>
            </div>
          )}
        </div>

        {reconnecting && (
          <p className={s.offline} role="status">
            Can’t reach Airbag’s engine right now. What you see is the last block it sent, and it
            may be out of date.
          </p>
        )}

        <Page className={s.body}>
          {data ? (
            children
          ) : live.failed ? (
            <Loader
              label="Can’t reach Airbag’s engine"
              detail="Retrying every few seconds. Your positions show up as soon as it answers."
            />
          ) : (
            <Loader
              label="Connecting to Airbag’s engine"
              detail="Your positions show up with the next Monad block."
            />
          )}
        </Page>

        <nav aria-label="App" className={s.tabs}>
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={s.tab}
              {...(active(n) ? { 'aria-current': 'page' as const } : {})}
            >
              <n.icon />
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </LiveContext.Provider>
  );
}
