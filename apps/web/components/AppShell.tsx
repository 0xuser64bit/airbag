'use client';

// The signed-in app's frame (design/Dashboard.dc.html header, MobileHome tab bar). It owns the
// live stream so every page shares one connection to the engine.

import { fmt } from '@airbag/risk';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { useSession } from '@/lib/session.ts';
import { type Live, useDashboard } from '@/lib/useDashboard.ts';
import s from './AppShell.module.css';
import { DeploysIcon, ListIcon, Sliders } from './icons.tsx';
import { StatusAnnunciator } from './instruments.tsx';
import { Brand, SimBanner } from './ui.tsx';

const LiveContext = createContext<Live>({ connected: false, failed: false, unauthorized: false });
export const useLive = () => useContext(LiveContext);

/** Re-renders every 100 ms so "checked 0.3 s ago" counts up between blocks. */
function useNow(ms = 100) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const session = useSession();
  const live = useDashboard(!!session);
  const now = useNow();
  const data = live.data;

  useEffect(() => {
    if (session === null || live.unauthorized) router.replace('/connect');
    else if (data?.status === 'unlinked') router.replace('/link-key');
  }, [session, live.unauthorized, data?.status, router]);

  const nav = [
    { href: '/app', label: 'Positions', icon: ListIcon, exact: true },
    { href: '/app/deploys', label: 'Deploys', icon: DeploysIcon, exact: false },
    {
      href: '/app/settings',
      label: 'Airbag settings',
      short: 'Airbag',
      icon: Sliders,
      exact: false,
    },
  ];
  const active = (href: string, exact: boolean) => (exact ? path === href : path.startsWith(href));
  const age = data?.block.at ? Math.max(0, (now - data.block.at) / 1000) : undefined;

  return (
    <LiveContext.Provider value={live}>
      {data?.mode === 'simulation' && <SimBanner />}
      <div className={s.frame}>
        <header className={s.header}>
          <div className={s.left}>
            <Brand href="/app" size={22} text={15} />
            <nav aria-label="App" className={s.nav}>
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={s.navLink}
                  {...(active(n.href, n.exact) ? { 'aria-current': 'page' as const } : {})}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className={s.right}>
            {data && <StatusAnnunciator status={data.status} />}
            {data && (
              <span className={`num muted ${s.ticker}`}>
                Block {fmt.block(data.block.head)}
                {age !== undefined && ` · checked ${age.toFixed(1)} s ago`}
              </span>
            )}
            {data?.account && (
              <>
                <span className={s.divider} />
                <span className={s.account}>
                  Perpl{' '}
                  <span className="num" style={{ fontSize: 13 }}>
                    #{data.account.id}
                  </span>
                </span>
                <span className={`num muted ${s.wallet}`}>{fmt.short(data.wallet)}</span>
              </>
            )}
          </div>
        </header>
        {data && (
          <div className={`num muted ${s.mobileTicker}`}>
            Block {fmt.block(data.block.head)}
            {age !== undefined && ` · checked ${age.toFixed(1)} s ago`}
          </div>
        )}
        {data && !live.connected && (
          <div className={s.offline} role="status">
            Reconnecting to Airbag’s engine. What you see may be out of date.
          </div>
        )}
        <div className={s.body}>
          {data ? (
            children
          ) : (
            <p className="muted" role="status">
              {session === undefined
                ? ''
                : live.failed
                  ? 'Can’t reach Airbag’s engine. Retrying every few seconds…'
                  : 'Connecting to Airbag’s engine…'}
            </p>
          )}
        </div>
        <nav aria-label="App" className={s.tabs}>
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={s.tab}
              {...(active(n.href, n.exact) ? { 'aria-current': 'page' as const } : {})}
            >
              <n.icon />
              {n.short ?? n.label}
            </Link>
          ))}
        </nav>
      </div>
    </LiveContext.Provider>
  );
}
