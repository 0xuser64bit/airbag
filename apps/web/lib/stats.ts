// Server-side reads for the pages the server renders. "Liquidated on Perpl in the last 30 days", from
// Airbag's Envio indexer (indexer/), is null when no indexer is configured or it doesn't answer:
// the landing page then shows nothing rather than an invented number.

import { ENGINE_URL_SERVER } from './config.ts';

const INDEXER_URL = process.env.INDEXER_URL;

/**
 * The mode of the engine behind this site, so a page can label a simulation in its first paint
 * instead of a moment later. Null when the engine didn't answer.
 */
export async function engineMode(): Promise<'live' | 'simulation' | null> {
  try {
    const res = await fetch(`${ENGINE_URL_SERVER}/v1/config`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return null;
    const { mode } = (await res.json()) as { mode?: string };
    return mode === 'live' || mode === 'simulation' ? mode : null;
  } catch {
    return null;
  }
}

export async function liquidationsLast30Days(now = Date.now()): Promise<number | null> {
  if (!INDEXER_URL) return null;
  const since = Math.floor(now / 86_400_000) - 30;
  try {
    const res = await fetch(INDEXER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query:
          'query ($since: Int!) { DailyLiquidations(where: { day: { _gte: $since } }) { count } }',
        variables: { since },
      }),
      next: { revalidate: 3_600 },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { DailyLiquidations?: { count: number }[] } };
    const rows = body.data?.DailyLiquidations;
    return rows ? rows.reduce((sum, r) => sum + r.count, 0) : null;
  } catch {
    return null;
  }
}
