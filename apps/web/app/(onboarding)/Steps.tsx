'use client';

import { usePathname } from 'next/navigation';
import s from './onboarding.module.css';

const STEPS = [
  { href: '/connect', title: 'Connect wallet', caption: 'Find your Perpl account' },
  { href: '/link-key', title: 'Link a Perpl key', caption: 'Trade-only, IP-locked' },
  { href: '/setup', title: 'Set your airbag', caption: 'When it deploys, how far it trims' },
];

export function Steps() {
  const path = usePathname();
  const current = STEPS.findIndex((x) => path.startsWith(x.href));
  return (
    <ol className={s.steps}>
      {STEPS.map((step, i) => (
        <li
          key={step.href}
          className={i === current ? s.current : i < current ? s.done : ''}
          {...(i === current ? { 'aria-current': 'step' as const } : {})}
        >
          <span className={`num ${s.stepNo}`}>{i + 1}</span>
          <span className={s.stepText}>
            <span className={s.stepTitle}>{step.title}</span>
            <span className={s.stepCaption}>{step.caption}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
