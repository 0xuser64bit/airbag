import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/config.ts';

// Public pages crawlers may index: the landing, the backtest and its rows, the wallet check and
// public save reports. Onboarding and the signed-in app stay out.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/backtest', '/wallet', '/s/'],
        disallow: ['/app/', '/connect', '/link-key', '/setup'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
