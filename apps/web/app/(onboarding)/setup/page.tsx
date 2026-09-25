'use client';

// Step 3: choose the airbag, watch it on the tape, arm it.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AirbagForm } from '@/components/AirbagForm.tsx';
import { api, useEngineConfig, useMe } from '@/lib/api.ts';
import { useSession } from '@/lib/session.ts';
import { useDashboard } from '@/lib/useDashboard.ts';
import s from '../onboarding.module.css';

export default function SetupPage() {
  const router = useRouter();
  const session = useSession();
  const me = useMe(!!session);
  const config = useEngineConfig();
  const live = useDashboard(!!session);

  useEffect(() => {
    if (session === null) router.replace('/connect');
    else if (me.data && !me.data.link) router.replace('/link-key');
  }, [session, me.data, router]);

  if (!me.data || !config.data) {
    const problem = me.error?.message ?? config.error?.message;
    return (
      <p className={problem ? undefined : 'muted'} role={problem ? 'alert' : 'status'}>
        {problem ?? 'Loading your settings'}
      </p>
    );
  }
  const view = live.data?.positions.find((p) => p.covered);

  return (
    <AirbagForm
      initial={me.data.settings}
      view={view}
      spare={live.data?.account?.spare ?? 0}
      demoAllowed={me.data.demoAllowed}
      vapidPublicKey={config.data.vapidPublicKey}
      slippageBps={config.data.slippageBps}
      submitLabel="Arm Airbag"
      busyLabel="Arming…"
      onSubmit={async (draft) => {
        await api('/v1/settings', { method: 'PUT', body: { ...draft, armed: true } });
        router.push('/app');
      }}
      secondary={
        <Link href="/link-key" className="btn btn-ghost btn-lg">
          Back
        </Link>
      }
      heading={
        <div className={s.head}>
          <h1 className={`display ${s.h1}`}>Set your airbag</h1>
          <p className={s.lede}>
            These apply to every position. Watch the preview: it runs the engine’s own math on your
            riskiest position.
          </p>
        </div>
      }
    />
  );
}
