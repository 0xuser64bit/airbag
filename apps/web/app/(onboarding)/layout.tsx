// Onboarding shell (design/Connect.dc.html, LinkKey, Settings): a stepper on the left, the
// step on the right. On a phone the stepper folds into a header.

import { ModeBanner } from '@/components/ModeBanner.tsx';
import { Brand } from '@/components/ui.tsx';
import s from './onboarding.module.css';
import { Steps } from './Steps.tsx';

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ModeBanner />
      <div className={s.shell}>
        <aside className={s.aside}>
          <Brand size={24} text={16} />
          <Steps />
          <div className={s.safety}>
            <span className="eyebrow">Safety</span>
            <p>Airbag’s key can trim. It can’t take. Perpl blocks withdrawals for every API key.</p>
          </div>
        </aside>
        <main className={s.main}>{children}</main>
      </div>
    </>
  );
}
