import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell.tsx';
import { engineMode } from '@/lib/stats.ts';

export const metadata: Metadata = { title: 'Positions', robots: { index: false } };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell serverMode={await engineMode()}>{children}</AppShell>;
}
