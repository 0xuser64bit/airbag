import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/config.ts';
import { loadBacktest } from './backtest/data.ts';

// Static public pages plus one entry per replayed liquidation. Save reports (/s/[id]) are
// per-deploy and unbounded, so they are indexed via robots allow but not enumerated here.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE_URL.replace(/\/$/, '');
  const bt = loadBacktest();
  const updated = new Date(bt.generatedAt);
  return [
    { url: `${base}/`, lastModified: updated },
    { url: `${base}/backtest`, lastModified: updated },
    { url: `${base}/wallet`, lastModified: updated },
    ...bt.rows.map((r) => ({
      url: `${base}/backtest/${r.id}`,
      lastModified: new Date(r.at),
    })),
  ];
}
