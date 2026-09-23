'use client';

// The airbag settings outside onboarding (brief §6: same controls as /setup), plus the key and
// the session.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AirbagForm } from '@/components/AirbagForm.tsx';
import { useLive } from '@/components/AppShell.tsx';
import { api, useEngineConfig } from '@/lib/api.ts';
import { clearSession } from '@/lib/session.ts';

export default function SettingsPage() {
  const router = useRouter();
  const { data } = useLive();
  const config = useEngineConfig();
  const [saved, setSaved] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  if (!data || !config.data) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 48, maxWidth: 1080 }}>
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
        onSubmit={async (draft) => {
          setSaved(false);
          await api('/v1/settings', { method: 'PUT', body: draft });
          setSaved(true);
        }}
        secondary={
          saved ? (
            <span className="muted" role="status">
              Saved. The engine uses it from the next block.
            </span>
          ) : null
        }
        heading={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h1 className="display" style={{ fontSize: 28 }}>
              Airbag settings
            </h1>
            <p className="muted" style={{ fontSize: 15 }}>
              These apply to every position.{' '}
              {data.settings.armed ? 'Airbag is armed.' : 'Airbag is paused.'}
            </p>
          </div>
        }
      />

      <section
        className="card"
        style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 680 }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Key and session</h2>
        <p className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
          Unlinking deletes the encrypted key from Airbag and stops protection at once. To make sure
          the key can never be used again, also revoke it on Perpl’s API keys page.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {confirmUnlink ? (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ borderColor: 'var(--liq)', color: 'var(--liq)' }}
                onClick={async () => {
                  await api('/v1/key', { method: 'DELETE' });
                  router.push('/link-key');
                }}
              >
                Unlink and stop protecting
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirmUnlink(false)}
              >
                Keep it
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setConfirmUnlink(true)}
            >
              Unlink key
            </button>
          )}
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
      </section>
    </div>
  );
}
