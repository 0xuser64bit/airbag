// Server-side read of a public save report, shared by the page and its share image.

import { ENGINE_URL_SERVER } from './config.ts';
import type { SaveReport } from './types.ts';

export async function getSave(id: string): Promise<SaveReport | null> {
  if (!/^[\w-]{6,40}$/.test(id)) return null;
  const res = await fetch(`${ENGINE_URL_SERVER}/v1/saves/${id}`, {
    // The kept amount moves with the price while the position is open.
    next: { revalidate: 30 },
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`save report ${id}: engine returned ${res.status}`);
  return (await res.json()) as SaveReport;
}

/** Fonts for the share image: static TTF instances at the design's widths (satori can't read woff2). */
export async function ogFonts(): Promise<
  { name: string; data: ArrayBuffer; weight: 400 | 500 | 600 | 700 | 800 }[]
> {
  fontsPromise ??= loadFonts().catch(() => []);
  return fontsPromise;
}

let fontsPromise:
  | Promise<{ name: string; data: ArrayBuffer; weight: 400 | 500 | 600 | 700 | 800 }[]>
  | undefined;

async function loadFonts() {
  const css = await fetch(
    'https://fonts.googleapis.com/css2?family=Martian+Mono:wdth,wght@75,400&family=Archivo:wdth,wght@125,700;125,800&family=Instrument+Sans:wght@400;500;600&display=swap',
    { signal: AbortSignal.timeout(8_000) },
  ).then((r) => r.text());
  const faces = [
    ...css.matchAll(
      /font-family: '([^']+)';[^}]*?font-weight: (\d+);[^}]*?src: url\(([^)]+\.ttf)\)/g,
    ),
  ];
  return Promise.all(
    faces.map(async ([, name, weight, url]) => ({
      name: name === 'Martian Mono' ? 'Mono' : (name ?? 'Sans'),
      weight: Number(weight) as 400 | 500 | 600 | 700 | 800,
      data: await fetch(url ?? '', { signal: AbortSignal.timeout(8_000) }).then((r) =>
        r.arrayBuffer(),
      ),
    })),
  );
}
