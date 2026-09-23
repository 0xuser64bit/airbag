import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell.tsx';

export const metadata: Metadata = { title: 'Positions', robots: { index: false } };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
