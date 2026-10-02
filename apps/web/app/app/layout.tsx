import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell.tsx';
import { engineMode } from '@/lib/stats.ts';

// A template of its own: without one the root's stops here, and Settings would read 'Settings'.
export const metadata: Metadata = {
  title: { default: 'Positions', template: '%s · Airbag' },
  robots: { index: false },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell serverMode={await engineMode()}>{children}</AppShell>;
}
