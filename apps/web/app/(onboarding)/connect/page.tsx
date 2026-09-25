'use client';

// Step 1 (design/Connect.dc.html). Connecting only reads an address; the Perpl account is
// looked up onchain. The SIWE signature comes when the user moves on to link a key.

import { fmt } from '@airbag/risk';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { EIP1193Provider } from 'viem';
import { Check, Chevron } from '@/components/icons.tsx';
import { Annunciator } from '@/components/instruments.tsx';
import { Runway } from '@/components/Runway.tsx';
import { ApiError, api, useEngineConfig } from '@/lib/api.ts';
import { clearSession, useSession } from '@/lib/session.ts';
import type { Lookup } from '@/lib/types.ts';
import {
  discoverWallets,
  requestAddress,
  signIn,
  type WalletOption,
  walletError,
} from '@/lib/wallet.ts';
import s from '../onboarding.module.css';

export default function ConnectPage() {
  const router = useRouter();
  const session = useSession();
  const config = useEngineConfig();
  const [wallets, setWallets] = useState<WalletOption[] | undefined>(undefined);
  const [picked, setPicked] = useState<
    { address: `0x${string}`; provider?: EIP1193Provider } | undefined
  >();
  const [lookup, setLookup] = useState<{ data?: Lookup; error?: string; loading: boolean }>({
    loading: false,
  });
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => discoverWallets(setWallets), []);
  useEffect(() => {
    // A signed-in wallet counts as connected; its session can link a key without signing again.
    if (session && !picked) setPicked({ address: session.wallet as `0x${string}` });
  }, [session, picked]);

  const address = picked?.address;
  useEffect(() => {
    if (!address) return;
    const ctl = new AbortController();
    setLookup({ loading: true });
    api<Lookup>(`/v1/lookup/${address}`, { signal: ctl.signal })
      .then((data) => setLookup({ data, loading: false }))
      .catch((err: unknown) => {
        if ((err as Error).name !== 'AbortError')
          setLookup({ error: (err as ApiError).message, loading: false });
      });
    return () => ctl.abort();
  }, [address]);

  const connect = async (w: WalletOption) => {
    setError(undefined);
    setBusy(w.id);
    try {
      const a = await requestAddress(w.provider);
      if (session && session.wallet !== a.toLowerCase()) clearSession();
      setPicked({ address: a, provider: w.provider });
    } catch (err) {
      setError(walletError(err));
    } finally {
      setBusy(undefined);
    }
  };

  const change = () => {
    clearSession();
    setPicked(undefined);
    setLookup({ loading: false });
  };

  const next = async () => {
    setError(undefined);
    if (session && address && session.wallet === address.toLowerCase())
      return router.push('/link-key');
    if (!picked?.provider || !address || !config.data) return;
    setBusy('sign');
    try {
      await signIn(picked.provider, address, config.data.chainId);
      router.push('/link-key');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : walletError(err));
    } finally {
      setBusy(undefined);
    }
  };

  const data = lookup.data;
  const covered = data?.positions.filter((p) => p.covered) ?? [];
  const riskiest = [...covered].sort((a, b) => a.distance - b.distance)[0];

  return (
    <div className={s.content}>
      <div className={s.head}>
        <h1 className={`display ${s.h1}`}>Connect the wallet you trade on Perpl</h1>
        <p className={s.lede}>
          Airbag reads your Perpl account from this address. Connecting doesn’t approve anything or
          move funds.
        </p>
      </div>

      {!address ? (
        <WalletPicker wallets={wallets} busy={busy} onPick={connect} />
      ) : (
        <div className={s.connected}>
          <div className={s.connectedWho}>
            <Check size={18} />
            <span className="num">{fmt.short(address)}</span>
            <Annunciator state="on" size="sm">
              {session ? 'Signed in' : 'Connected'}
            </Annunciator>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={change}>
            Change wallet
          </button>
        </div>
      )}

      {address && lookup.loading && (
        <p className={s.looking} role="status">
          Looking up your Perpl account onchain
        </p>
      )}
      {address && lookup.error && (
        <div className="notice" data-tone="alert" role="alert">
          <span>{lookup.error}</span>
        </div>
      )}

      {data && !data.account && (
        <div className={s.panel}>
          <div className={s.panelBody}>
            <h2 className="title">No Perpl account for this wallet</h2>
            <p className="muted">
              Airbag protects positions on Perpl. Deposit on Perpl to open an account, then come
              back. If you trade from another wallet, connect that one.
            </p>
            {config.data && (
              <a className="btn btn-secondary btn-sm" href={config.data.perplUrl}>
                Open Perpl
              </a>
            )}
          </div>
        </div>
      )}

      {data?.account && (
        <section className={s.panel} aria-labelledby="found">
          <div className={s.panelHead}>
            <h2 id="found" className="title">
              Found your Perpl account <span className="num faint">#{data.account.id}</span>
            </h2>
            <p className="muted">
              <span className="num">{data.positions.length}</span> open position
              {data.positions.length === 1 ? '' : 's'} ·{' '}
              <span className="num">{fmt.usd(data.account.spare)}</span> spare margin
            </p>
          </div>
          {data.positions.length === 0 && (
            <p className={`muted ${s.panelBody}`}>
              No open positions right now. Once armed, Airbag covers anything you open in{' '}
              {config.data?.markets.map((m) => m.symbol).join(' or ') ?? 'covered markets'}.
            </p>
          )}
          {data.positions.map((p) => (
            <div key={p.marketId} className={s.row}>
              <span className={s.rowName}>
                <span className={s.symbol}>{p.symbol}</span>{' '}
                <span className="muted">
                  {p.side} · <span className="num">{fmt.size(p.size, p.sizeDecimals)}</span> ·{' '}
                  <span className="num">{Math.round(p.nominalLeverage)}x</span>
                </span>
              </span>
              <span className={s.rowTrack}>
                <Runway liquidation={p.liquidation} mark={p.mark} size="sm" />
              </span>
              <span className={`num ${s.rowDistance}`}>
                {fmt.pct(p.distance)} <span className="faint">to liq</span>
              </span>
              <span className={s.rowLamp}>
                <Annunciator state="off" size="sm">
                  {p.covered ? 'No airbag' : 'Not covered yet'}
                </Annunciator>
              </span>
            </div>
          ))}
        </section>
      )}

      {riskiest && (
        <p className={s.risk}>
          Your {riskiest.symbol} {riskiest.side} is{' '}
          <span className="num">{fmt.pct(riskiest.distance)}</span> from liquidation. A wick that
          size closes all of it and keeps a fifth of what’s left.
        </p>
      )}

      {error && (
        <div className="notice" data-tone="alert" role="alert">
          {error}
        </div>
      )}

      <div className={s.actions}>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          onClick={next}
          disabled={!data?.account || busy === 'sign' || !config.data}
        >
          {busy === 'sign' ? <span className="spinner" aria-hidden="true" /> : null}
          {busy === 'sign' ? 'Sign in your wallet' : 'Link a Perpl key'}
        </button>
        <Link href="/" className="btn btn-ghost btn-lg">
          Back
        </Link>
      </div>
      {address && !session && data?.account && (
        <p className={s.note}>
          Next, your wallet asks you to sign a message so Airbag knows it’s you. It doesn’t move
          funds.
        </p>
      )}
    </div>
  );
}

function WalletPicker({
  wallets,
  busy,
  onPick,
}: {
  wallets: WalletOption[] | undefined;
  busy: string | undefined;
  onPick: (w: WalletOption) => void;
}) {
  if (wallets === undefined)
    return (
      <p className={s.looking} role="status">
        Looking for wallets in this browser
      </p>
    );
  if (wallets.length === 0) {
    return (
      <div className={s.panel}>
        <div className={s.panelBody}>
          <h2 className="title">No browser wallet found</h2>
          <p className="muted">
            Install a wallet extension such as Rabby or MetaMask, or open this page in your wallet
            app’s browser.
          </p>
        </div>
      </div>
    );
  }
  return (
    <ul className={s.walletList} aria-label="Choose a wallet">
      {wallets.map((w) => (
        <li key={w.id}>
          <button
            type="button"
            className={s.walletBtn}
            onClick={() => onPick(w)}
            disabled={busy !== undefined}
          >
            {/* biome-ignore lint/performance/noImgElement: EIP-6963 icons are data URIs from the wallet */}
            {w.icon ? <img src={w.icon} alt="" /> : <span className={s.walletBlank} />}
            <span>{busy === w.id ? 'Check your wallet…' : `Connect ${w.name}`}</span>
            <Chevron className={s.walletChev} />
          </button>
        </li>
      ))}
    </ul>
  );
}
