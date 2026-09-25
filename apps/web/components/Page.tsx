'use client';

import { usePathname } from 'next/navigation';

/**
 * The page under a fixed masthead. Keyed by path, so a navigation repaints the new page top to
 * bottom (globals.css `.redraw`), the way a display unit redraws. Plain CSS on purpose: React's
 * ViewTransition left the document without a <title> for a moment after each navigation.
 */
export function Page({ className, children }: { className?: string; children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div key={path} className={`redraw ${className ?? ''}`}>
      {children}
    </div>
  );
}
