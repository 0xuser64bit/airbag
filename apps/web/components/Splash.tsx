'use client';

import { useEffect, useRef, useState } from 'react';
import { LoaderMark } from './Loader.tsx';
import s from './Splash.module.css';

// One cycle of the loader's quarter turn (Loader.module.css), then the no-JS fade. The script
// reads the turn's own clock, so a slow load never waits out the cycle twice.
const FADE_AT = 2200;
const FLIGHT = { duration: 520, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'forwards' } as const;

// A client navigation can remount this layout. The flag lives on the window, so that remount
// does not replay the splash; a refresh gets a new window and plays it again. Set in a frame, not
// during render, so a strict-mode remount still gets to play.
const PLAYED = '__airbagSplashPlayed';
type SplashWindow = Window & { [PLAYED]?: boolean };

function splashAlreadyPlayed(): boolean {
  return typeof window !== 'undefined' && (window as SplashWindow)[PLAYED] === true;
}

/**
 * Every full page load opens on the crash-test mark: the loader's quadrants turn through one
 * cycle, yellow and black trading places, then the mark docks in the masthead as the curtain
 * lifts. Drawn in CSS from the first paint, so it never waits for JavaScript.
 * Without JavaScript the curtain fades. A click or a key skips to the docking.
 */
export function Splash() {
  const [done, setDone] = useState(splashAlreadyPlayed);
  const ref = useRef<HTMLDivElement>(null);
  const flying = useRef(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      (window as SplashWindow)[PLAYED] = true;
    });
    const intro = ref.current;
    // The fallback fade on the root started with the first frame: it is the splash's clock.
    const clock = intro?.getAnimations()[0];
    if (!intro || !clock) {
      (window as SplashWindow)[PLAYED] = true;
      setDone(true); // reduced motion: the splash is display: none and has nothing to play
      return () => cancelAnimationFrame(frame);
    }
    const elapsed = Number(clock.currentTime ?? 0);
    // Hydrated after the fade began: let it finish on its own, or clear it if the fade is over.
    if (elapsed >= FADE_AT) {
      (window as SplashWindow)[PLAYED] = true;
      if (clock.playState === 'finished') setDone(true);
      return () => cancelAnimationFrame(frame);
    }
    const turn = intro.querySelector('[data-turn]')?.getAnimations()[0];
    const end = endOf(turn);
    const soFar = Number(turn?.currentTime ?? elapsed);
    let timer = 0;
    let cancelled = false;
    const stop = () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
    };
    const fly = () => {
      stop();
      if (flying.current) return;
      flying.current = true;
      // Land on the pose the masthead wears, even if the cycle was skipped mid-turn.
      for (const a of intro.getAnimations({ subtree: true })) if (a !== clock) a.finish();
      void handOff(intro, clock).finally(() => {
        if (!cancelled) setDone(true);
      });
    };
    const skip = () => fly();
    timer = window.setTimeout(fly, Math.max(0, end - soFar));
    window.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stop();
      delete document.documentElement.dataset.splashHandoff;
    };
  }, []);

  // The curtain covers the page: keep the page behind it still until it lifts.
  useEffect(() => {
    if (done) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [done]);

  if (done) return null;
  return (
    <div
      ref={ref}
      className={s.intro}
      data-splash=""
      aria-hidden="true"
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) setDone(true);
      }}
    >
      <div className={s.curtain} />
      <div className={s.stage}>
        <LoaderMark size={104} once />
      </div>
    </div>
  );
}

/** When the turn animation ends, in ms. Falls back to the stylesheet's 1.4s cycle. */
function endOf(anim: Animation | undefined): number {
  const end = anim?.effect?.getComputedTiming().endTime;
  return typeof end === 'number' ? end : 1400;
}

/**
 * Docks the splash's mark in the masthead's: it scales and moves onto its twin, which stays
 * hidden until it lands. The curtain holds, then lifts.
 */
async function handOff(intro: HTMLElement, clock: Animation): Promise<void> {
  try {
    clock.cancel();
    intro.style.pointerEvents = 'none';
    const art = intro.querySelector('svg');
    const curtain = intro.querySelector<HTMLElement>(`.${s.curtain}`);
    const mark = document.querySelector('[data-brand] svg');
    if (!art || !curtain || !(mark instanceof SVGSVGElement)) {
      await intro.animate({ opacity: [1, 0] }, { duration: 300, fill: 'forwards' }).finished;
      return;
    }
    // The centre of both drawings, and the scale between them.
    const a = locate(art, 12, 12);
    const b = locate(mark, 12, 12);
    const box = art.getBoundingClientRect();
    art.style.transformOrigin = `${a.x - box.left}px ${a.y - box.top}px`;
    document.documentElement.dataset.splashHandoff = '';
    await Promise.all([
      art.animate(
        { transform: ['none', `translate(${b.x - a.x}px, ${b.y - a.y}px) scale(${b.k / a.k})`] },
        FLIGHT,
      ).finished,
      curtain.animate({ opacity: [1, 0] }, { ...FLIGHT, delay: 140, duration: 380 }).finished,
    ]);
  } catch {
    // Cancelled, or the masthead moved. The splash still has to get off the page.
  } finally {
    // One task, one frame: the twins appear as the splash goes.
    intro.style.visibility = 'hidden';
    delete document.documentElement.dataset.splashHandoff;
  }
}

/**
 * Where a point of an svg's drawing is on screen, and its pixels per unit: from the element's box
 * and viewBox, which every engine computes with CSS transforms included (getScreenCTM may not).
 */
function locate(svg: SVGSVGElement, x: number, y: number) {
  const box = svg.getBoundingClientRect();
  const view = svg.viewBox.baseVal;
  const k = box.width / (view.width || 24);
  return { x: box.left + (x - view.x) * k, y: box.top + (y - view.y) * k, k };
}
