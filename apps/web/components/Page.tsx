'use client';

import { usePathname } from 'next/navigation';
import { ViewTransition } from 'react';

/**
 * The page under a fixed masthead. Keyed by path, so a navigation cross-fades the old page out
 * and brings the new one up a few pixels (globals.css `.page`); reduced motion swaps at once.
 */
export function Page({ className, children }: { className?: string; children: React.ReactNode }) {
  const path = usePathname();
  return (
    <ViewTransition key={path} name="page" share="page" default="none">
      <div className={className}>{children}</div>
    </ViewTransition>
  );
}
