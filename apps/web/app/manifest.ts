import type { MetadataRoute } from 'next';

// Installable so Web Push works on phones (iOS only allows push for Home Screen apps).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Airbag',
    short_name: 'Airbag',
    description: 'Liquidation protection for Perpl traders on Monad.',
    id: '/app',
    scope: '/',
    start_url: '/app',
    display: 'standalone',
    background_color: '#11110F',
    theme_color: '#11110F',
    icons: [
      { src: '/pwa-icon/192', sizes: '192x192', type: 'image/png' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
