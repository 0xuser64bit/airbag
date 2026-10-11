# Web design and content

This is the maintained design contract for `apps/web`. The implementation is the reference:
shared tokens and controls in `app/globals.css`, layout in `components/Page.tsx` and `AppShell.tsx`,
instruments in Tape/Runway/BlockLog, and CSS modules beside their components.

## Product and voice

Airbag is a position-protection panel for Perpl traders. Three journeys must remain clear:
connect/sign in/link/configure/arm; glance at protection and liquidation levels; inspect an action
and its outcome from a receipt or alert. Use plain, precise, trader-literate language, sentence
case and concrete numbers. Do not promise that liquidation is impossible.

- Yellow means Airbag's line or action. Red means liquidation. User choices, validation and
  general alerts use bone/neutral treatments.
- Display engine/shared-risk calculations with their measured price. Historical datasets retain
  dates and fill assumptions. Label scripted prices, paper fills and simulated reports explicitly.
- Call an action a **save** only when the old liquidation price was later reached while the
  position stayed open. Otherwise, once closed, it is a **precaution**. Keep pending/failed states distinct.
- Counterfactual liquidation proceeds are estimates. A fee unavailable after interruption is
  **unconfirmed**, never an invented zero. Spare margin is the trader's money, not value kept.
- Scope checks prove gateway admission; the IP allow-list is user-confirmed and cannot be read back.
- Pause, settings, unlink and revocation instructions must stay accessible. Do not imply logout revokes a key.

## Visual system

The interface is one graphite panel, separated into bays by thin rules. Instruments sit in darker
wells. Status uses annunciator lamps with words, not color alone. Preserve the existing identity
when fixing behavior; use shared components rather than separate page-specific frames.

| Role | Existing choice |
|---|---|
| Ground / well / panel | `#11110f` / `#0c0c0b` / `#181815` |
| Main ink / secondary ink | `#ece9e0` / `#a5a298` |
| Airbag / liquidation | `#f2c12e` / `#ff6a55` |
| Display and wordmark | Archivo Expanded, with Helvetica fallback |
| Prose and controls | Instrument Sans, system fallback |
| Numbers and labels | Martian Mono, tabular figures, monospace fallback |
| Page frame | Shared 1280px maximum column with responsive inset |
| Side bay | Shared responsive bay; stack under the main breakpoint |
| Spacing and motion | Existing CSS custom properties; avoid duplicated token values |

Use expanded headlines sparingly. Every number uses tabular mono; prose remains in the body face.
Keep left edges and mastheads aligned across onboarding, dashboard, settings and receipts.
At narrow widths, controls and their preview remain close and usable without horizontal scrolling.

Use damped motion for values moving on a scale, direct state changes for lamps, and the shared
loader for pending reads. Respect reduced motion. Never use animation to conceal stale data or
an unavailable engine.

## Status vocabulary

| State | User wording |
|---|---|
| Healthy protection | Armed; Deployed · re-armed |
| Work in flight | Deploying |
| User paused | Paused |
| Unsafe feed | Data stale · holding |
| No usable connection | Connecting |
| Key refusal | Key rejected · relink |
| Forwarding disabled | One-Click Trading off |
| Wallet connections exhausted | Perpl connection limit |
| Frozen account | Account frozen |
| Paper liquidation | Liquidated, with simulation labeling |
| Public read-only position beyond its line | Past the line |
| Public chain snapshot | Perpl now, with observation time |

Any new state needs corresponding words and a lamp treatment. Account-specific problems must not
be hidden behind a healthy global readiness indicator.

## Accessibility and verification

Use native buttons/links, labeled inputs, visible focus, 44px targets and sufficient contrast.
Switches expose their state; changing controls announce usable output. Dialogs manage focus and
keyboard dismissal. Color and motion are never the only signals.

Playwright checks serious/critical WCAG violations through axe and checks overflow in the covered
journeys. Preserve those checks; they do not establish a complete WCAG audit or full screen-reader
compatibility. Inspect relevant desktop/phone views after layout changes and check reduced motion
when changing animation.
