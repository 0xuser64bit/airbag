'use client';

import { useApi } from '@/lib/api.ts';
import type { EngineConfig } from '@/lib/types.ts';
import { SimBanner } from './ui.tsx';

/**
 * Labels the whole screen when the engine runs on the paper exchange. The server passes the mode
 * it read, so the label is there in the first paint; only when it couldn't reach the engine does
 * the browser ask.
 */
export function ModeBanner({ mode }: { mode: 'live' | 'simulation' | null }) {
  const { data } = useApi<EngineConfig>(mode ? null : '/v1/config');
  return (mode ?? data?.mode) === 'simulation' ? <SimBanner /> : null;
}
