'use client';

// Step 2 (design/LinkKey.dc.html). The key and secret go over TLS straight to the engine, which
// verifies them with Perpl before storing anything (ADR 0006). Perpl doesn't expose a key's IP
// allow-list, so the user confirms it and the result says exactly what was checked.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Check, Copy, Cross, External } from '@/components/icons.tsx';
import { ApiError, api, useEngineConfig, useMe } from '@/lib/api.ts';
import { SOURCE_URL } from '@/lib/config.ts';
import { useSession } from '@/lib/session.ts';
import type { Linked } from '@/lib/types.ts';
import s from '../onboarding.module.css';

export default function LinkKeyPage() {
  const router = useRouter();
  const session = useSession();
  const config = useEngineConfig();
  const me = useMe(!!session);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [ipLocked, setIpLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [linked, setLinked] = useState<Linked | undefined>();
  const [replacing, setReplacing] = useState(false);

  useEffect(() => {
    if (session === null) router.replace('/connect');
  }, [session, router]);

  const cfg = config.data;
  const sim = cfg?.mode === 'simulation';
  const existing = me.data?.link;
  const showForm = !linked && (!existing || replacing);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      setLinked(
        await api<Linked>('/v1/key', { method: 'POST', body: { apiKey, apiSecret, ipLocked } }),
      );
      setApiSecret('');
      me.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Linking failed.');
    } finally {
      setBusy(false);
    }
  };

  const fillTestKey = () => {
    const hex = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    setApiKey(`sim-key-${hex.slice(0, 4)}`);
    setApiSecret(hex);
    setIpLocked(true);
  };

  // An existing link's forwarding state isn't known here; the dashboard shows it live.
  const done: (Omit<Linked, 'forwarding'> & { forwarding?: boolean }) | undefined =
    linked ??
    (existing && !replacing
      ? { accountId: existing.accountId, keyHint: existing.keyHint, simulated: sim }
      : undefined);

  return (
    <div className={s.withAside}>
      <div className={s.content} style={{ gap: 30 }}>
        <div className={s.head}>
          <span className="eyebrow" style={{ fontSize: 12 }}>
            Step 2 of 3
          </span>
          <h1 className={`display ${s.h1}`}>Link a key that can’t withdraw</h1>
          <p className={s.lede} style={{ fontSize: 16 }}>
            Airbag signs its trims with a Perpl API key. Three steps, about two minutes.
          </p>
        </div>

        {showForm && (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <ol style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
              <Step n="01" title="Create a Trade key on Perpl">
                <span className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>
                  On Perpl’s API keys page, create a key with the Trade scope.
                </span>
                <a
                  className="btn btn-secondary"
                  style={{ alignSelf: 'flex-start', fontSize: 14 }}
                  href={cfg ? `${cfg.perplUrl}/apikeys` : 'https://app.perpl.xyz/apikeys'}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Perpl API keys
                  <External />
                </a>
              </Step>
              <Step n="02" title="Lock it to Airbag’s servers">
                {cfg && cfg.egressIps.length > 0 ? (
                  <>
                    <span className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>
                      Add{' '}
                      {cfg.egressIps.length === 1
                        ? 'this range'
                        : `all ${cfg.egressIps.length} ranges`}{' '}
                      to the key’s IP allow-list, so it only works from our engine.
                    </span>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {cfg.egressIps.map((ip) => (
                        <CopyChip key={ip} value={ip} />
                      ))}
                    </div>
                  </>
                ) : (
                  <span className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>
                    {sim
                      ? 'In simulation there’s no allow-list to set: nothing is sent to Perpl.'
                      : 'This server hasn’t published fixed addresses, so the key can’t be IP-locked to it yet. Leave the allow-list empty, or wait until the addresses are published.'}
                  </span>
                )}
              </Step>
              <Step n="03" title="Paste it here">
                <div
                  className="paste"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 12,
                  }}
                >
                  <div className="field">
                    <label htmlFor="apikey">API key</label>
                    <input
                      id="apikey"
                      className="input"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      required
                      maxLength={512}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="apisecret">API secret</label>
                    <input
                      id="apisecret"
                      className="input"
                      type="password"
                      value={apiSecret}
                      onChange={(e) => setApiSecret(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      required
                      pattern="(0x)?[0-9a-fA-F]{64}"
                      title="64 hex characters"
                    />
                  </div>
                </div>
                <label
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'flex-start',
                    fontSize: 14,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={ipLocked}
                    onChange={(e) => setIpLocked(e.target.checked)}
                    required
                    style={{ width: 18, height: 18, marginTop: 2, accentColor: 'var(--airbag)' }}
                  />
                  <span>
                    {sim || (cfg && cfg.egressIps.length === 0)
                      ? 'I understand this key isn’t IP-locked to Airbag.'
                      : 'I set the key’s IP allow-list as above.'}{' '}
                    <span className="faint">
                      Perpl doesn’t let anyone read it back, so Airbag can’t check it for you.
                    </span>
                  </span>
                </label>
                <span className="faint" style={{ fontSize: 13, lineHeight: 1.5 }}>
                  Encrypted at rest. Used only to sign Airbag’s reduce-only orders.
                </span>
              </Step>
            </ol>

            {error && (
              <div className="notice notice-liq" role="alert">
                <Cross size={18} color="#FF6A55" />
                <span>{error}</span>
              </div>
            )}

            <div className={s.actions}>
              <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
                {busy && <span className="spinner" aria-hidden="true" />}
                {busy ? 'Checking with Perpl…' : 'Verify key'}
              </button>
              {sim && (
                <button type="button" className="btn btn-secondary btn-lg" onClick={fillTestKey}>
                  Use a test key
                </button>
              )}
              {existing && (
                <button
                  type="button"
                  className="btn btn-ghost btn-lg"
                  onClick={() => setReplacing(false)}
                >
                  Keep the current key
                </button>
              )}
            </div>
          </form>
        )}

        {done && (
          <>
            <div className="notice notice-airbag" role="status">
              <Check size={18} color="#F2C12E" />
              <span>
                Key verified{' '}
                <span className="muted">
                  · Trade scope · account <span className="num">#{done.accountId}</span> · key …
                  <span className="num">{done.keyHint}</span>
                </span>
                <br />
                <span className="faint" style={{ fontSize: 13 }}>
                  {done.simulated
                    ? 'Simulated: nothing was sent to Perpl.'
                    : 'IP lock confirmed by you. Perpl doesn’t expose it, so it isn’t something Airbag verified.'}
                </span>
              </span>
            </div>
            {done.forwarding === false && (
              <div className="notice notice-liq" role="alert">
                <span>
                  One-Click Trading is off on your Perpl account, so every order Airbag sent would
                  fail. Turn it on in Perpl’s settings; Airbag picks it up on its own.
                </span>
              </div>
            )}
            <div className={s.actions}>
              <Link href="/setup" className="btn btn-primary btn-lg">
                Set your airbag
              </Link>
              {!linked && (
                <button
                  type="button"
                  className="btn btn-ghost btn-lg"
                  onClick={() => setReplacing(true)}
                >
                  Replace key
                </button>
              )}
            </div>
          </>
        )}
        {!done && (
          <Link href="/connect" className="btn btn-ghost" style={{ alignSelf: 'flex-start' }}>
            Back
          </Link>
        )}
      </div>

      <aside className={`card ${s.sideCard}`} style={{ marginTop: 118 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>What this key can do</h2>
        <ul className="check-list">
          {[
            'Read your positions and orders',
            'Close or reduce a position',
            'Add spare margin to a position',
          ].map((t) => (
            <li key={t}>
              <Check color="#ECE9E0" />
              {t}
            </li>
          ))}
        </ul>
        <div style={{ height: 1, background: 'var(--line)' }} />
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>What it can’t do</h2>
        <ul className="check-list" style={{ gap: 14 }}>
          {[
            ['Withdraw or transfer funds', 'Blocked by Perpl for every API key'],
            ['Open, add to or flip a position', 'Airbag’s engine only sends reduce-only orders'],
            ['Work from any other server', 'Blocked by the IP allow-list'],
          ].map(([t, why]) => (
            <li key={t}>
              <Cross color="#86837A" />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>{t}</span>
                <span className="faint" style={{ fontSize: 12 }}>
                  {why}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <a
          href={`${SOURCE_URL}/tree/main/packages/perpl/src/orders.ts`}
          className="muted"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            textDecoration: 'none',
          }}
        >
          Read the engine’s source
          <External size={13} />
        </a>
      </aside>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '32px minmax(0, 1fr)', gap: 14 }}>
      <span className="num airbag" style={{ fontSize: 13, paddingTop: 2 }}>
        {n}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontSize: 17, fontWeight: 600 }}>{title}</span>
        {children}
      </div>
    </li>
  );
}

function CopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="card"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 6px 0 14px',
        height: 44,
        borderRadius: 'var(--r-control)',
      }}
    >
      <span className="num" style={{ fontSize: 13 }}>
        {value}
      </span>
      <button
        type="button"
        className="btn btn-ghost"
        aria-label={`Copy ${value}`}
        style={{ minHeight: 34, width: 34, padding: 0 }}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check size={15} color="#F2C12E" /> : <Copy />}
      </button>
      <span className="visually-hidden" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </div>
  );
}
