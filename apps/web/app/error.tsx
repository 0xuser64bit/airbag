'use client';

import Link from 'next/link';
import { Brand } from '@/components/ui.tsx';
import s from './status.module.css';

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className={s.page}>
      <header className={s.masthead}>
        <Brand size={24} text={15} />
        <span className="ann" data-state="alert">
          Page fault
        </span>
      </header>
      <main className={s.main}>
        <h1 className={`display ${s.title}`}>This page didn’t load.</h1>
        <p className={s.lede}>
          Something broke while drawing it. Trying again usually clears it. The web app never sends
          orders, so a fault here can’t touch your positions.
        </p>
        {error.digest && (
          <p className="faint">
            Reference <span className="num">{error.digest}</span>
          </p>
        )}
        <div className={s.actions}>
          <button type="button" className="btn btn-primary btn-lg" onClick={retry}>
            Try again
          </button>
          <Link href="/" className="btn btn-secondary btn-lg">
            Back to Airbag
          </Link>
        </div>
      </main>
    </div>
  );
}
