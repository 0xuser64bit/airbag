// PNG app icons for the manifest and the iOS Home Screen, drawn from the crash-test mark.

import { ImageResponse } from 'next/og';

export const dynamic = 'force-static';
export const generateStaticParams = () => [{ size: '180' }, { size: '192' }, { size: '512' }];

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (![180, 192, 512].includes(size)) return new Response('Not found', { status: 404 });
  // Maskable-safe: the mark sits inside the central 60%.
  const mark = Math.round(size * 0.6);
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#11110F',
      }}
    >
      <svg width={mark} height={mark} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10.75" fill="none" stroke="#F2C12E" strokeWidth="1.5" />
        <path d="M12 12 L12 3.5 A8.5 8.5 0 0 1 20.5 12 Z" fill="#F2C12E" />
        <path d="M12 12 L12 20.5 A8.5 8.5 0 0 1 3.5 12 Z" fill="#F2C12E" />
      </svg>
    </div>,
    { width: size, height: size },
  );
}
