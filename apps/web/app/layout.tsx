import type { Metadata, Viewport } from 'next';
import { Archivo, Instrument_Sans, Martian_Mono } from 'next/font/google';
import { SITE_URL } from '@/lib/config.ts';
import './globals.css';

// Archivo at 125% width for display, Instrument Sans for UI, Martian Mono for every number.
const display = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--font-display' });
const ui = Instrument_Sans({ subsets: ['latin'], axes: ['wdth'], variable: '--font-ui' });
const mono = Martian_Mono({ subsets: ['latin'], axes: ['wdth'], variable: '--font-mono' });

const description =
  'Airbag checks your Perpl positions every Monad block and trims just enough, fee-free, before the liquidation engine can close all of it.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Airbag · Liquidation protection for Perpl', template: '%s · Airbag' },
  description,
  applicationName: 'Airbag',
  appleWebApp: { capable: true, title: 'Airbag', statusBarStyle: 'black-translucent' },
  openGraph: { title: 'Airbag: get trimmed, not liquidated', description, siteName: 'Airbag' },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = { themeColor: '#11110F', colorScheme: 'dark' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
