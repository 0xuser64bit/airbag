'use client';

import { usePathname } from 'next/navigation';
import { Check } from '@/components/icons.tsx';
import s from './onboarding.module.css';

const STEPS = [
  { href: '/connect', title: 'Connect wallet' },
  { href: '/link-key', title: 'Link a Perpl key' },
  { href: '/setup', title: 'Set your airbag' },
];

/** The preflight checklist: done items checked, the current one lit, the rest dark. */
export function Steps() {
  const path = usePathname();
  const current = STEPS.findIndex((x) => path.startsWith(x.href));
  return (
    <ol className={s.steps} aria-label="Setup steps">
      {STEPS.map((step, i) => (
        <li
          key={step.href}
          className={i === current ? s.current : i < current ? s.done : ''}
          {...(i === current ? { 'aria-current': 'step' as const } : {})}
        >
          <span className={`num ${s.stepNo}`} aria-hidden="true">
            {i < current ? <Check size={13} /> : i + 1}
          </span>
          <span className={s.stepTitle}>
            {step.title}
            {i < current && <span className="visually-hidden"> (done)</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
