'use client';

// Telegram alerts for this wallet, in two steps that need no pop-up: get a one-time link to the
// bot, press Start in Telegram. It notices the chat land by itself; one press unlinks it.

import { useEffect, useState } from 'react';
import { api } from '@/lib/api.ts';
import type { Me } from '@/lib/types.ts';
import s from './AirbagForm.module.css';

export function TelegramAlerts({ bot }: { bot: string }) {
  const [linked, setLinked] = useState<boolean>();
  const [url, setUrl] = useState<string>();
  const [note, setNote] = useState<string>();

  useEffect(() => {
    void api<Me>('/v1/me')
      .then((m) => setLinked(m.telegram))
      .catch(() => setLinked(false));
  }, []);

  // While a link is out, watch for the chat to land: every 2 s for up to 3 minutes.
  useEffect(() => {
    if (!url || linked) return;
    let polls = 0;
    const timer = setInterval(async () => {
      if (++polls > 90) return clearInterval(timer);
      const me = await api<Me>('/v1/me').catch(() => undefined);
      if (me?.telegram) {
        setLinked(true);
        setUrl(undefined);
      }
    }, 2_000);
    return () => clearInterval(timer);
  }, [url, linked]);

  const toggle = async () => {
    setNote(undefined);
    try {
      if (linked) {
        await api('/v1/telegram', { method: 'DELETE' });
        setLinked(false);
      } else {
        setUrl((await api<{ url: string }>('/v1/telegram', { method: 'POST' })).url);
      }
    } catch (err) {
      setNote((err as Error).message);
    }
  };

  return (
    <div className={s.telegram}>
      <button
        type="button"
        className={`seg ${s.pushBtn}`}
        aria-pressed={linked === true}
        disabled={linked === undefined}
        onClick={toggle}
      >
        Telegram
      </button>
      <span className={s.help} role="status">
        {note ??
          (linked ? (
            `Alerts also go to your chat with @${bot}. Press again, or send /stop there, to end them.`
          ) : url ? (
            <>
              <a href={url} target="_blank" rel="noreferrer">
                Open @{bot} in Telegram
              </a>{' '}
              and press Start. This page notices when it’s done.
            </>
          ) : (
            'The same alerts in Telegram, on any phone, no app to install.'
          ))}
      </span>
    </div>
  );
}
