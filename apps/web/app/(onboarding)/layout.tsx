// Onboarding shell: the three steps as a preflight checklist in the masthead, the step below.

import { ModeBanner } from '@/components/ModeBanner.tsx';
import { Page } from '@/components/Page.tsx';
import { Brand } from '@/components/ui.tsx';
import s from './onboarding.module.css';
import { Steps } from './Steps.tsx';

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ModeBanner />
      <div className={s.frame}>
        <header className={s.masthead}>
          <Brand size={24} text={15} />
          <Steps />
        </header>
        <Page className={s.main}>
          <main>{children}</main>
        </Page>
        <footer className={s.foot}>
          <span className="label">Safety</span>
          <span>
            Airbag’s key can trim. It can’t take. Perpl blocks withdrawals for every API key.
          </span>
        </footer>
      </div>
    </>
  );
}
