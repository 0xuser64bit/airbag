// The platform's loader: the crash-test mark with its quadrants turning a quarter at a time, so
// the yellow and the black trade places on every beat. Damped like the rest of the panel's
// instruments; still under reduced motion, where the label carries the meaning.

import s from './Loader.module.css';

/** The mark, its quadrants turning. `color` defaults to Airbag yellow; buttons pass currentColor. */
export function LoaderMark({ size = 44, color = '#F2C12E' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={s.mark}>
      <circle cx="12" cy="12" r="10.75" fill="none" stroke={color} strokeWidth="1.5" />
      <g className={s.quads}>
        <path d="M12 12 L12 3.5 A8.5 8.5 0 0 1 20.5 12 Z" fill={color} />
        <path d="M12 12 L12 20.5 A8.5 8.5 0 0 1 3.5 12 Z" fill={color} />
      </g>
    </svg>
  );
}

/** A page or panel that's waiting on the engine: the turning mark and what it's waiting for. */
export function Loader({ label, detail }: { label: string; detail?: React.ReactNode }) {
  return (
    <div className={s.loader} role="status">
      <LoaderMark />
      <p className={s.label}>{label}</p>
      {detail && <p className={s.detail}>{detail}</p>}
    </div>
  );
}

/** Inside a busy button, in the button's own ink. */
export function Spinner() {
  return <LoaderMark size={18} color="currentColor" />;
}
