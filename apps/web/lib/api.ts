'use client';

import { useCallback, useEffect, useState } from 'react';
import { ENGINE_URL } from './config.ts';
import { clearSession, currentToken } from './session.ts';
import type { EngineConfig, Me } from './types.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Calls the engine. Throws ApiError with the engine's user-facing message. */
export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const token = currentToken();
  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(
      0,
      'offline',
      "Can't reach Airbag's engine. Check your connection and try again.",
    );
  }
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code: string; message: string };
  };
  if (!res.ok) {
    if (res.status === 401 && token) clearSession();
    throw new ApiError(
      res.status,
      body.error?.code ?? 'error',
      body.error?.message ?? `Request failed (${res.status}).`,
    );
  }
  return body as T;
}

type Loadable<T> = { data?: T; error?: ApiError; loading: boolean; reload: () => void };

/** Fetches once on mount (and on reload). */
export function useApi<T>(path: string | null): Loadable<T> {
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({
    loading: path !== null,
  });
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `n` is the reload counter
  useEffect(() => {
    if (path === null) return;
    const ctl = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    api<T>(path, { signal: ctl.signal })
      .then((data) => setState({ data, loading: false }))
      .catch((error: unknown) => {
        if ((error as Error).name === 'AbortError') return;
        setState({ error: error as ApiError, loading: false });
      });
    return () => ctl.abort();
  }, [path, n]);
  return { ...state, reload };
}

export const useEngineConfig = () => useApi<EngineConfig>('/v1/config');
export const useMe = (enabled: boolean) => useApi<Me>(enabled ? '/v1/me' : null);
