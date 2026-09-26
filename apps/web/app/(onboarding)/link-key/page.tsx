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

  // An existing link's forwarding and scope checks aren't known here; the dashboard shows it live.
  const done:
    | (Omit<Linked, 'forwarding' | 'tradeScope'> & { forwarding?: boolean; tradeScope?: boolean })
    | undefined =
    linked ??
    (existing && !replacing
      ? { accountId: existing.accountId, keyHint: existing.keyHint, simulated: sim }
      : undefined);

  return (
    <div className={s.withAside}>
      <div className={s.content}>
        {(config.error || me.error) && (
          <div className="notice" data-tone="alert" role="alert">
            <span>{config.error?.message ?? me.error?.message}</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                config.reload();
                me.reload();
              }}
            >
              Try again
            </button>
          </div>
        )}
        <div className={s.head}>
          <h1 className={`display ${s.h1}`}>Link a key that can’t withdraw</h1>
          <p className={s.lede}>
            Airbag signs its trims with a Perpl API key. Three steps, about two minutes.
          </p>
        </div>

        {showForm && (
          <form onSubmit={submit} className={s.keyForm}>
            <ol className={s.keySteps}>
              <Step n="01" title="Create a Trade key on Perpl">
                <p className="muted">
                  On Perpl’s API keys page, create a key with the Trade scope.
                </p>
                <a
                  className="btn btn-secondary btn-sm"
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
                    <p className="muted">
                      Add{' '}
                      {cfg.egressIps.length === 1
                        ? 'this range'
                        : `all ${cfg.egressIps.length} ranges`}{' '}
                      to the key’s IP allow-list, so it only works from our engine.
                    </p>
                    <div className={s.chips}>
                      {cfg.egressIps.map((ip) => (
                        <CopyChip key={ip} value={ip} />
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="muted">
                    {sim
                      ? 'In simulation there’s no allow-list to set: nothing is sent to Perpl.'
                      : 'This server hasn’t published fixed addresses, so the key can’t be IP-locked to it yet. Leave the allow-list empty, or wait until the addresses are published.'}
                  </p>
                )}
              </Step>
              <Step n="03" title="Paste it here">
                <div className={s.fields}>
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
                <label className={s.confirm}>
                  <input
                    type="checkbox"
                    checked={ipLocked}
                    onChange={(e) => setIpLocked(e.target.checked)}
                    required
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
                <p className={s.note}>
                  Encrypted at rest. Used only to sign Airbag’s reduce-only orders.
                </p>
              </Step>
            </ol>

            {error && (
              <div className="notice" data-tone="alert" role="alert">
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
            <div className={`notice ${s.verified}`} data-tone="airbag" role="status">
              <Check size={18} />
              <div className={s.verifiedText}>
                <p>
                  <strong>{linked ? 'Key verified' : 'Key linked'}</strong>
                  {done.tradeScope && ' · Trade scope'} · account{' '}
                  <span className="num">#{done.accountId}</span> · key …
                  <span className="num">{done.keyHint}</span>
                </p>
                <p className="muted">
                  {done.simulated
                    ? 'Simulated: nothing was sent to Perpl.'
                    : 'IP allow-list acknowledged by you. Perpl doesn’t expose it, so Airbag cannot verify the restriction.'}
                </p>
              </div>
            </div>
            {done.forwarding === false && (
              <div className="notice" data-tone="alert" role="alert">
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
          <Link href="/connect" className={`btn btn-ghost ${s.back}`}>
            Back
          </Link>
        )}
      </div>

      <aside className={s.sideCard} aria-labelledby="can-do">
        <h2 id="can-do" className="title">
          What this key can do
        </h2>
        <ul className={s.can}>
          {[
            'Read your positions and orders',
            'Close or reduce a position',
            'Add spare margin to a position',
          ].map((t) => (
            <li key={t}>
              <Check />
              {t}
            </li>
          ))}
        </ul>
        <h2 className="title">What it can’t do</h2>
        <ul className={s.cant}>
          {[
            ['Withdraw or transfer funds', 'Blocked by Perpl for every API key'],
            ['Open, add to or flip a position', 'Airbag’s engine only sends reduce-only orders'],
            ['Work from any other server', 'Blocked by the IP allow-list'],
          ].map(([t, why]) => (
            <li key={t}>
              <Cross />
              <span>
                {t}
                <span className="faint">{why}</span>
              </span>
            </li>
          ))}
        </ul>
        <a href={`${SOURCE_URL}/tree/main/packages/perpl/src/orders.ts`} className={s.source}>
          Read the engine’s source
          <External size={13} />
        </a>
      </aside>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <li className={s.keyStep}>
      <span className={`num ${s.keyStepNo}`}>{n}</span>
      <div className={s.keyStepBody}>
        <span className={s.keyStepTitle}>{title}</span>
        {children}
      </div>
    </li>
  );
}

function CopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={s.chip}>
      <span className="num">{value}</span>
      <button
        type="button"
        className={s.chipBtn}
        aria-label={`Copy ${value}`}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check size={15} /> : <Copy />}
      </button>
      <span className="visually-hidden" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </div>
  );
}
