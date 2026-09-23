'use client';

// The airbag settings with a live preview (design/Settings.dc.html). The preview runs
// @airbag/risk in the browser on the user's riskiest covered position, the same math the engine
// runs, so what it shows is what the engine will do. Used by /setup and /app/settings.

import {
  airbagLine,
  direction,
  equity,
  fmt,
  liquidationPrice,
  type Position,
  planDeploy,
  SENSITIVITY,
  triggered,
} from '@airbag/risk';
import { useEffect, useState } from 'react';
import { disablePush, enablePush, pushSupported, subscribed } from '@/lib/push.ts';
import type { PositionView, Sensitivity, Settings } from '@/lib/types.ts';
import s from './AirbagForm.module.css';
import { Minus, Plus } from './icons.tsx';
import { Runway } from './Runway.tsx';

const PRESETS: { id: Sensitivity; name: string; caption: string }[] = [
  { id: 'early', name: 'Early', caption: 'A third of the cushion gone' },
  { id: 'balanced', name: 'Balanced', caption: 'Half of the cushion gone' },
  { id: 'late', name: 'Late', caption: 'Three quarters gone' },
];
const CAPS = [25, 50, 75, 100] as const;
const DEMO_MOVE = 0.003;

/** The design's example, used (and labelled) when there's no open position to preview on. */
const SAMPLE = {
  symbol: 'BTC',
  sizeDecimals: 5,
  nominalLeverage: 10,
  mark: 99_420,
  position: {
    side: 'long',
    size: 1,
    entry: 100_000,
    deposit: 10_000,
    funding: 0,
    maintenance: 0.04,
  } as Position,
};

export type SettingsDraft = Pick<
  Settings,
  'sensitivity' | 'targetPct' | 'maxTrimPct' | 'useSpare' | 'push' | 'demo'
>;

export interface AirbagFormProps {
  initial: Settings;
  view: PositionView | undefined;
  spare: number;
  demoAllowed: boolean;
  vapidPublicKey: string | null;
  slippageBps: number;
  /** Saves; throw to show a message. */
  onSubmit: (draft: SettingsDraft) => Promise<void>;
  submitLabel: string;
  busyLabel: string;
  secondary?: React.ReactNode;
  heading: React.ReactNode;
}

export function AirbagForm(props: AirbagFormProps) {
  const { initial, view, spare } = props;
  const [draft, setDraft] = useState<SettingsDraft>({
    sensitivity: initial.sensitivity,
    targetPct: initial.targetPct,
    maxTrimPct: initial.maxTrimPct,
    useSpare: initial.useSpare,
    push: initial.push,
    demo: initial.demo,
  });
  const [pushHere, setPushHere] = useState(false);
  // Known only in the browser; reading it during render would break hydration.
  const [canPush, setCanPush] = useState(false);
  const [pushNote, setPushNote] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const set = <K extends keyof SettingsDraft>(k: K, v: SettingsDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  useEffect(() => {
    setCanPush(pushSupported());
    void subscribed().then(setPushHere);
  }, []);

  const togglePush = async () => {
    setPushNote(undefined);
    try {
      if (pushHere) {
        await disablePush();
        setPushHere(false);
        set('push', false);
      } else {
        if (!props.vapidPublicKey) throw new Error('Push alerts aren’t set up on this server yet.');
        await enablePush(props.vapidPublicKey);
        setPushHere(true);
        set('push', true);
      }
    } catch (err) {
      setPushNote((err as Error).message);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      await props.onSubmit(draft);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ---- Preview ----
  const sample = !view;
  const pos = view?.position ?? SAMPLE.position;
  const symbol = view?.symbol ?? SAMPLE.symbol;
  const mark = view?.mark ?? SAMPLE.mark;
  const sd = view?.sizeDecimals ?? SAMPLE.sizeDecimals;
  const reference = view?.reference ?? pos.entry;
  const dir = direction(pos.side);
  const line = draft.demo
    ? (() => {
        const price = reference * (1 - dir * DEMO_MOVE);
        return { ...airbagLine(pos, reference, 0.5), price, triggerEquity: equity(pos, price) };
      })()
    : airbagLine(pos, reference, SENSITIVITY[draft.sensitivity]);
  const plan = planDeploy(pos, line.price, spare, {
    target: draft.targetPct / 100,
    maxTrim: draft.maxTrimPct / 100,
    useSpare: draft.useSpare,
  });
  const liq = liquidationPrice(pos);
  const past = triggered(pos, mark, line);
  const liqAfter = plan.liquidation;
  const away = liqAfter === null ? null : (dir * (line.price - liqAfter)) / line.price;
  const down = (dir * (mark - line.price)) / mark;
  const worst = `${fmt.pct(props.slippageBps / 10_000, 1).replace('.0%', '%')} ${pos.side === 'long' ? 'below' : 'above'} mark`;
  const r = pos.maintenance;

  return (
    <div className={s.layout}>
      <form className={s.form} onSubmit={submit}>
        {props.heading}

        <fieldset className={s.group}>
          <legend className={s.groupLabel}>When it deploys</legend>
          <div className={s.presets}>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`seg ${s.preset}`}
                aria-pressed={!draft.demo && draft.sensitivity === p.id}
                onClick={() => setDraft((d) => ({ ...d, sensitivity: p.id, demo: false }))}
              >
                <span style={{ fontSize: 15, fontWeight: 600 }}>{p.name}</span>
                <span className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>
                  {p.caption}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className={s.group}>
          <legend className={s.groupLabel}>How far it trims</legend>
          <div className={s.stepperRow}>
            <div className={s.stepper}>
              <button
                type="button"
                aria-label="Less distance"
                disabled={draft.targetPct <= 6}
                onClick={() => set('targetPct', Math.max(6, draft.targetPct - 1))}
              >
                <Minus />
              </button>
              <output className="num" aria-live="polite" aria-label={`${draft.targetPct} percent`}>
                {draft.targetPct}%
              </output>
              <button
                type="button"
                aria-label="More distance"
                disabled={draft.targetPct >= 20}
                onClick={() => set('targetPct', Math.min(20, draft.targetPct + 1))}
              >
                <Plus />
              </button>
            </div>
            <span className="muted" style={{ fontSize: 14, lineHeight: 1.45 }}>
              Trims the smallest amount that puts liquidation at least this far from the price.
            </span>
          </div>
        </fieldset>

        <fieldset className={s.group}>
          <legend className={s.groupLabel}>Most it trims in one deploy</legend>
          <div className={s.caps}>
            {CAPS.map((c) => (
              <button
                key={c}
                type="button"
                className="seg num"
                style={{ height: 44, fontSize: 14 }}
                aria-pressed={draft.maxTrimPct === c}
                onClick={() => set('maxTrimPct', c)}
              >
                {c}%
              </button>
            ))}
          </div>
        </fieldset>

        <div className={s.switchRow}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span id="l-spare" className={s.groupLabel}>
              Use spare margin first
            </span>
            <span className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
              Only when it’s enough to reach your target. If not, Airbag keeps it and trims.
            </span>
          </div>
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={draft.useSpare}
            aria-labelledby="l-spare"
            onClick={() => set('useSpare', !draft.useSpare)}
          >
            <span />
          </button>
        </div>

        <fieldset className={s.group}>
          <legend className={s.groupLabel}>Alerts</legend>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="seg"
              style={{ height: 44, padding: '0 16px', fontSize: 14, fontWeight: 500 }}
              aria-pressed={pushHere && draft.push}
              disabled={!canPush}
              onClick={togglePush}
            >
              Push to this browser
            </button>
          </div>
          <span className="faint" style={{ fontSize: 13 }}>
            {pushNote ??
              (canPush
                ? 'Deploys, saves and key problems. Turn it on in each browser you want alerts in.'
                : "This browser can't receive push alerts. On an iPhone, add Airbag to your Home Screen first.")}
          </span>
        </fieldset>

        {props.demoAllowed && (
          <div className={s.switchRow}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span id="l-demo" className={s.groupLabel}>
                Demo mode
              </span>
              <span className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
                Deploys after a {fmt.pct(DEMO_MOVE, 1)} move against you, to record a real deploy.
                Not for real protection.
              </span>
            </div>
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={draft.demo}
              aria-labelledby="l-demo"
              onClick={() => set('demo', !draft.demo)}
            >
              <span />
            </button>
          </div>
        )}

        {past && (
          <div className="notice notice-airbag" role="status">
            Your {symbol} {pos.side} is already past this line. Once armed, Airbag deploys on the
            next block.
          </div>
        )}
        {error && (
          <div className="notice notice-liq" role="alert">
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? props.busyLabel : props.submitLabel}
          </button>
          {props.secondary}
        </div>
      </form>

      <aside className={`card ${s.preview}`} aria-live="polite">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="eyebrow">
            {sample ? 'Preview on a sample position' : `Preview on your ${symbol} ${pos.side}`}
          </span>
          <span className="muted" style={{ fontSize: 14 }}>
            {fmt.size(pos.size, sd)} {symbol} ·{' '}
            {Math.round(view?.nominalLeverage ?? SAMPLE.nominalLeverage)}x · mark {fmt.usd(mark)}
          </span>
        </div>
        <Runway
          side={pos.side}
          liquidation={liq}
          line={line.price}
          mark={mark}
          size="md"
          near={past}
        />
        <dl className={s.dl}>
          <div>
            <dt>Deploys at</dt>
            <dd className="num">
              {fmt.usd(line.price)}{' '}
              <span className="muted">
                ({fmt.pct(Math.abs(down))}{' '}
                {down >= 0 ? (pos.side === 'long' ? 'down' : 'up') : 'past'})
              </span>
            </dd>
          </div>
          <div>
            <dt>Would trim</dt>
            <dd className="num">
              {plan.kind === 'trim' ? (
                <>
                  {fmt.size(plan.fraction * pos.size, sd)} {symbol}{' '}
                  <span className="muted">({fmt.pct(plan.fraction, 1)})</span>
                </>
              ) : plan.kind === 'margin' ? (
                'Nothing: spare margin covers it'
              ) : (
                'Nothing: already far enough'
              )}
            </dd>
          </div>
          <div>
            <dt>Liquidation after</dt>
            <dd className="num">
              {liqAfter === null ? 'Closed' : fmt.usd(liqAfter)}{' '}
              {away !== null && <span className="muted">({fmt.pct(away)} away)</span>}
            </dd>
          </div>
          <div>
            <dt>Spare margin</dt>
            <dd>
              {!draft.useSpare
                ? 'Off'
                : plan.kind === 'margin'
                  ? `Adds ${fmt.usd(plan.amount)} instead of trimming`
                  : `${fmt.usd(spare)} isn’t enough here`}
            </dd>
          </div>
          <div>
            <dt>Fee</dt>
            <dd className="num">$0</dd>
          </div>
          <div>
            <dt>Worst fill</dt>
            <dd>{worst}</dd>
          </div>
        </dl>
        {plan.kind === 'trim' && plan.capped && (
          <p className={s.capped}>
            Capped at {draft.maxTrimPct}%. Liquidation ends up {fmt.pct(away)} away, short of your{' '}
            {draft.targetPct}% target.
          </p>
        )}
        <p className="faint" style={{ fontSize: 12, lineHeight: 1.5 }}>
          Uses Perpl’s {symbol} rules: {fmt.pct(r, Number.isInteger(r * 100) ? 0 : 2)} maintenance
          margin, fee-free closes.
          {sample ? ' Sample position: no open position to preview on yet.' : ''}
        </p>
      </aside>
    </div>
  );
}
