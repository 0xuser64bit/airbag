'use client';

// The dashboard's live state: the engine's per-block server-sent events, read with fetch so the
// bearer token rides in a header (EventSource can't send one). Reconnects with backoff.

import { useEffect, useState } from 'react';
import { ENGINE_URL } from './config.ts';
import { clearSession, currentToken } from './session.ts';
import type { Dashboard } from './types.ts';

export interface Live {
  data?: Dashboard;
  /** False while reconnecting; the last state stays on screen, marked as such. */
  connected: boolean;
  /** The last attempt to reach the engine failed. */
  failed: boolean;
  unauthorized: boolean;
}

export function useDashboard(enabled = true, sessionToken?: string): Live {
  const [live, setLive] = useState<Live>({
    connected: false,
    failed: false,
    unauthorized: false,
  });
  useEffect(() => {
    setLive({ connected: false, failed: false, unauthorized: false });
    if (!enabled) return;
    const ctl = new AbortController();
    let attempt = 0;
    const run = async () => {
      while (!ctl.signal.aborted) {
        const token = sessionToken ?? currentToken();
        if (!token) {
          setLive((l) => ({ ...l, unauthorized: true }));
          return;
        }
        const connection = new AbortController();
        let lastFrame = Date.now();
        const watch = setInterval(() => {
          if (Date.now() - lastFrame > 10_000) connection.abort();
        }, 1_000);
        try {
          const res = await fetch(`${ENGINE_URL}/v1/stream`, {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.any([ctl.signal, connection.signal]),
            cache: 'no-store',
          });
          if (res.status === 401) {
            clearSession();
            setLive((l) => ({ ...l, unauthorized: true, connected: false }));
            return;
          }
          if (!res.ok || !res.body) throw new Error(String(res.status));
          attempt = 0;
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            lastFrame = Date.now();
            buffer += value;
            let end = buffer.indexOf('\n\n');
            while (end >= 0) {
              const event = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              const data = event
                .split('\n')
                .filter((l) => l.startsWith('data: '))
                .map((l) => l.slice(6))
                .join('\n');
              if (data)
                setLive({
                  data: JSON.parse(data) as Dashboard,
                  connected: true,
                  failed: false,
                  unauthorized: false,
                });
              end = buffer.indexOf('\n\n');
            }
          }
        } catch {
          if (ctl.signal.aborted) return;
        } finally {
          clearInterval(watch);
          connection.abort();
        }
        setLive((l) => ({ ...l, connected: false, failed: true }));
        const wait = Math.min(15_000, 500 * 2 ** attempt++);
        await new Promise((r) => setTimeout(r, wait));
      }
    };
    void run();
    return () => ctl.abort();
    // The identity changes even when both the previous and next sessions are signed in.
  }, [enabled, sessionToken]);
  return live;
}
