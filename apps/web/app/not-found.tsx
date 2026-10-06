import Link from 'next/link';
import { Brand } from '@/components/ui.tsx';
import s from './status.module.css';

export default function NotFound() {
  return (
    <div className={s.page}>
      <header className={s.masthead}>
        <Brand size={24} text={15} />
        <span className="ann" data-state="off">
          Error 404
        </span>
      </header>
      <main id="main" className={s.main}>
        <h1 className={`display ${s.title}`}>Page not found.</h1>
        <p className={s.lede}>
          Nothing is filed at this address. If a save report link brought you here, that report
          doesn’t exist or was never made public.
        </p>
        <div className={s.actions}>
          <Link href="/" className="btn btn-primary btn-lg">
            Back to Airbag
          </Link>
          <Link href="/app" className="btn btn-secondary btn-lg">
            Your positions
          </Link>
        </div>
      </main>
    </div>
  );
}
