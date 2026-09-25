'use client';

// Instrument primitives: annunciators, rolling readouts, and the hook that boxes a lamp for ten
// seconds after it changes (the way a flight-mode annunciator marks a new mode).

import { useEffect, useRef, useState } from 'react';
import type { DeploySummary, GuardStatus, PositionStatus } from '@/lib/types.ts';

/**
 * True for `ms` after `value` changes. The first real value (arriving after undefined or an
 * empty string, as live data does) is a reading, not a change, so it doesn't count.
 */
export function useFresh(value: unknown, ms = 10_000): boolean {
  const [fresh, setFresh] = useState(false);
  const prev = useRef<unknown>(undefined);
  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    if (before === undefined || before === '' || before === value) return;
    setFresh(true);
    const t = setTimeout(() => setFresh(false), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return fresh;
}

/** Lamp states. 'liq' is only ever for liquidation itself. */
export type Lamp = 'off' | 'on' | 'airbag' | 'airbag-line' | 'alert' | 'liq';

export function Annunciator({
  state,
  children,
  size,
  fresh = false,
  role,
}: {
  state: Lamp;
  children: React.ReactNode;
  size?: 'sm';
  fresh?: boolean;
  role?: 'status';
}) {
  return (
    <span
      className="ann"
      data-state={state}
      {...(size ? { 'data-size': size } : {})}
      {...(fresh ? { 'data-fresh': 'true' } : {})}
      {...(role ? { role } : {})}
    >
      {children}
    </span>
  );
}

const STATUS: Record<GuardStatus, { text: string; lamp: Lamp }> = {
  armed: { text: 'Armed', lamp: 'on' },
  're-armed': { text: 'Deployed · re-armed', lamp: 'airbag-line' },
  deploying: { text: 'Deploying', lamp: 'airbag' },
  paused: { text: 'Paused', lamp: 'off' },
  'key-rejected': { text: 'Key rejected · relink', lamp: 'alert' },
  'forwarding-off': { text: 'One-Click Trading off', lamp: 'alert' },
  'too-many-connections': { text: 'Perpl connection limit', lamp: 'alert' },
  frozen: { text: 'Account frozen', lamp: 'alert' },
  connecting: { text: 'Connecting to Perpl', lamp: 'off' },
  stale: { text: 'Data stale · holding', lamp: 'on' },
  unlinked: { text: 'No key linked', lamp: 'off' },
};

/** The protection lamp: Airbag's state, boxed for ten seconds whenever it changes. */
export function StatusAnnunciator({ status }: { status: GuardStatus }) {
  const s = STATUS[status];
  const fresh = useFresh(status);
  return (
    <Annunciator state={s.lamp} fresh={fresh} role="status">
      {s.text}
    </Annunciator>
  );
}

const ROW: Record<PositionStatus, { text: string; lamp: Lamp }> = {
  armed: { text: 'Armed', lamp: 'on' },
  're-armed': { text: 'Re-armed', lamp: 'airbag-line' },
  deploying: { text: 'Deploying', lamp: 'airbag' },
  paused: { text: 'Paused', lamp: 'off' },
  blocked: { text: 'Held', lamp: 'off' },
  'not-covered': { text: 'Not covered', lamp: 'off' },
};

export function RowAnnunciator({ status }: { status: PositionStatus }) {
  const r = ROW[status];
  return (
    <Annunciator state={r.lamp} size="sm">
      {r.text}
    </Annunciator>
  );
}

export function OutcomeAnnunciator({ d }: { d: Pick<DeploySummary, 'phase' | 'outcome'> }) {
  const [text, lamp]: [string, Lamp] =
    d.outcome === 'save'
      ? ['Saved', 'airbag']
      : d.phase === 'failed'
        ? ['Didn’t fill', 'off']
        : d.outcome === 'precaution'
          ? ['Precaution', 'on']
          : d.phase !== 'done'
            ? ['Deploying', 'airbag']
            : ['Deployed', 'airbag-line'];
  return (
    <Annunciator state={lamp} size="sm">
      {text}
    </Annunciator>
  );
}

/** A number whose changed digits roll into place when a new block moves them. */
export function Readout({ value, className }: { value: string; className?: string }) {
  const prev = useRef<string | null>(null);
  const before = prev.current;
  useEffect(() => {
    prev.current = value;
  });
  return (
    <span className={className}>
      {[...value].map((ch, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: position and glyph together are the identity
          key={`${i}:${ch}`}
          className={before !== null && before[i] !== ch ? 'roll' : undefined}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}
