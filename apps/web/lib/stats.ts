// Server-side reads for the landing page. "Liquidated on Perpl in the last 30 days", from
// Airbag's Envio indexer (indexer/), is null when no indexer is configured or it doesn't answer:
// the landing page then shows nothing rather than an invented number.

import { ENGINE_URL_SERVER } from './config.ts';

const INDEXER_URL = process.env.INDEXER_URL;

/** True when the engine behind this site runs the simulation; false when live or unreachable. */
export async function isSimulation(): Promise<boolean> {
  try {
    const res = await fetch(`${ENGINE_URL_SERVER}/v1/config`, {
      next: { revalidate: 3_600 },
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok && ((await res.json()) as { mode?: string }).mode === 'simulation';
  } catch {
    return false;
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
