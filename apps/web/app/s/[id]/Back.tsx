'use client';

import Link from 'next/link';
import { useSession } from '@/lib/session.ts';

/** For the trader who opened their own report from the dashboard: the way back to it. */
export function BackToPositions() {
  const session = useSession();
  if (!session) return null;
  return (
    <Link href="/app" className="btn btn-ghost btn-lg">
      Your positions
    </Link>
  );
}
