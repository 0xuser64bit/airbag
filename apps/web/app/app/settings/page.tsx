'use client';

// The airbag settings outside onboarding (same controls as /setup), plus the key and the
// session. Unlinking is guarded: the first press only lifts the guard.

import { fmt } from '@airbag/risk';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AirbagForm } from '@/components/AirbagForm.tsx';
import { useLive } from '@/components/AppShell.tsx';
import { Annunciator } from '@/components/instruments.tsx';
import { api, useEngineConfig } from '@/lib/api.ts';
import { clearSession } from '@/lib/session.ts';
import s from './settings.module.css';

export default function SettingsPage() {
  const router = useRouter();
  const { data } = useLive();
  const config = useEngineConfig();
  const [saved, setSaved] = useState(false);
  const [guardUp, setGuardUp] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  if (!data || !config.data) return null;

  return (
    <div className={s.page}>
      <AirbagForm
        // Remount on a fresh save so the form starts from what the engine stored.
        key={data.settings.updatedAt}
        initial={data.settings}
        view={data.positions.find((p) => p.covered)}
        spare={data.account?.spare ?? 0}
        demoAllowed={data.demoAllowed}
        vapidPublicKey={config.data.vapidPublicKey}
        slippageBps={config.data.slippageBps}
        submitLabel="Save changes"
        busyLabel="Saving…"
        requireChange
        onSubmit={async (draft) => {
          setSaved(false);
          await api('/v1/settings', { method: 'PUT', body: draft });
          setSaved(true);
        }}
        secondary={
          saved ? (
            <span className={s.saved} role="status">
              <Annunciator state="on" size="sm">
                Saved
              </Annunciator>
              The engine uses it from the next block.
            </span>
          ) : null
        }
        heading={
          <div className={s.head}>
            <h1 className={`display ${s.h1}`}>Airbag settings</h1>
            <p className="muted">
              These apply to every position.{' '}
              {data.settings.armed ? 'Airbag is armed.' : 'Airbag is paused.'}
            </p>
          </div>
        }
      />

      <section className={s.key} aria-labelledby="key-session">
        <div className={s.keyHead}>
          <h2 id="key-session" className="title">
            Key and session
          </h2>
          {data.key && (
            <p className="num muted">
              Key …{data.key.keyHint} · linked {fmt.date(data.key.linkedAt)}
            </p>
          )}
        </div>
        <p className={s.keyText}>
          Unlinking deletes the encrypted key from Airbag and stops protection at once. To make sure
          the key can never be used again, also revoke it on Perpl’s API keys page.
        </p>
        {guardUp ? (
          <div className={s.guard}>
            <p>
              <strong>Protection stops the moment you confirm.</strong> Open positions stay open,
              with nothing watching them.
            </p>
            <div className={s.row}>
              <button
                type="button"
                className={`btn ${s.danger}`}
                disabled={unlinking}
                onClick={async () => {
                  setUnlinking(true);
                  setProblem(undefined);
                  try {
                    await api('/v1/key', { method: 'DELETE' });
                    router.push('/link-key');
                  } catch (err) {
                    setProblem((err as Error).message);
                    setUnlinking(false);
                  }
                }}
              >
                {unlinking ? 'Unlinking…' : 'Unlink and stop protecting'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setGuardUp(false)}>
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <div className={s.row}>
            <button type="button" className="btn btn-secondary" onClick={() => setGuardUp(true)}>
              Unlink key
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={async () => {
                await api('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
                clearSession();
                router.push('/');
              }}
            >
              Sign out
            </button>
          </div>
        )}
        {problem && (
          <p className="notice" data-tone="alert" role="alert">
            {problem}
          </p>
        )}
      </section>
    </div>
  );
}
