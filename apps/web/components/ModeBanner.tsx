'use client';

import { useEngineConfig } from '@/lib/api.ts';
import { SimBanner } from './ui.tsx';

/** Labels the whole screen when the engine runs on the paper exchange. */
export function ModeBanner() {
  const { data } = useEngineConfig();
  return data?.mode === 'simulation' ? <SimBanner /> : null;
}
