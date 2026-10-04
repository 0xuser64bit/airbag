---
name: Airbag
description: Get trimmed, not liquidated.
colors:
  ground: "#11110f"
  well: "#0c0c0b"
  panel: "#181815"
  raised: "#1f1f1b"
  line: "#2b2a25"
  line-strong: "#3a3932"
  scale: "#57554c"
  lit: "rgba(236, 233, 224, 0.12)"
  unlit: "rgba(236, 233, 224, 0.04)"
  bone: "#ece9e0"
  soft-bone: "#d6d3ca"
  text-2: "#a5a298"
  text-3: "#86837a"
  airbag: "#f2c12e"
  airbag-hover: "#f5cc4f"
  airbag-tint: "rgba(242, 193, 46, 0.12)"
  airbag-edge: "rgba(242, 193, 46, 0.5)"
  liq: "#ff6a55"
  liq-tint: "rgba(255, 106, 85, 0.1)"
  liq-edge: "rgba(255, 106, 85, 0.45)"
typography:
  display:
    fontFamily: "Archivo, Helvetica Neue, sans-serif"
    fontSize: "clamp(32px, 9.4vw, 108px)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.015em"
    fontVariation: "'wdth' 125"
  headline:
    fontFamily: "Archivo, Helvetica Neue, sans-serif"
    fontSize: "clamp(30px, 3.6vw, 48px)"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 125"
  wordmark:
    fontFamily: "Archivo, Helvetica Neue, sans-serif"
    fontWeight: 800
    letterSpacing: "0.06em"
    fontVariation: "'wdth' 125"
  title:
    fontFamily: "Instrument Sans, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Instrument Sans, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  readout:
    fontFamily: "Martian Mono, ui-monospace, monospace"
    fontSize: "clamp(56px, 6.2vw, 100px)"
    lineHeight: 0.9
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
    fontVariation: "'wdth' 75"
  number:
    fontFamily: "Martian Mono, ui-monospace, monospace"
    fontFeature: "tnum"
    fontVariation: "'wdth' 87.5"
  label:
    fontFamily: "Martian Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.1em"
    fontVariation: "'wdth' 87.5"
  lamp:
    fontFamily: "Martian Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.1em"
    fontVariation: "'wdth' 87.5"
rounded:
  lamp: "3px"
  control: "6px"
  well: "8px"
  round: "999px"
spacing:
  s-1: "4px"
  s-2: "8px"
  s-3: "12px"
  s-4: "16px"
  s-5: "24px"
  s-6: "32px"
  s-7: "48px"
  s-8: "64px"
  s-9: "96px"
  gutter: "clamp(16px, 4vw, 48px)"
  frame: "1280px"
  bay: "clamp(300px, 27vw, 380px)"
components:
  button-primary:
    backgroundColor: "{colors.airbag}"
    textColor: "{colors.ground}"
    rounded: "{rounded.control}"
    padding: "0 20px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.airbag-hover}"
    textColor: "{colors.ground}"
  button-primary-disabled:
    backgroundColor: "{colors.unlit}"
    textColor: "{colors.text-3}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.bone}"
    rounded: "{rounded.control}"
    padding: "0 20px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.bone}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "44px"
  button-ghost-hover:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.bone}"
  input:
    backgroundColor: "{colors.well}"
    textColor: "{colors.bone}"
    typography: "{typography.number}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "44px"
  segment-selected:
    backgroundColor: "{colors.lit}"
    textColor: "{colors.bone}"
    rounded: "{rounded.control}"
  lamp-on:
    backgroundColor: "{colors.lit}"
    textColor: "{colors.bone}"
    typography: "{typography.lamp}"
    rounded: "{rounded.lamp}"
    padding: "0 9px"
    height: "26px"
  lamp-off:
    backgroundColor: "{colors.unlit}"
    textColor: "{colors.text-3}"
  lamp-airbag:
    backgroundColor: "{colors.airbag}"
    textColor: "{colors.ground}"
  lamp-airbag-line:
    backgroundColor: "{colors.airbag-tint}"
    textColor: "{colors.airbag}"
  lamp-alert:
    backgroundColor: "{colors.bone}"
    textColor: "{colors.ground}"
  lamp-liq:
    backgroundColor: "{colors.liq-tint}"
    textColor: "{colors.liq}"
  well:
    backgroundColor: "{colors.well}"
    rounded: "{rounded.well}"
  annunciator-strip:
    backgroundColor: "{colors.well}"
    padding: "10px clamp(16px, 3vw, 32px)"
    height: "48px"
---

# Airbag web app

The design system and content contract for `apps/web`. Read this before changing anything the trader
sees or reads. Tokens, components, motion and the rules are in the YAML block above and the sections
below; the screen-by-screen reference is in [`design/`](../../design/README.md).

## What this app is for

Airbag watches a trader's Perpl positions every Monad block and, when a price move uses up a set
share of a position's margin cushion, trims the smallest useful amount and re-adds the released
margin to move liquidation further away. Trading fees, gaps, thin books and outages can still
prevent protection; product copy must never promise that liquidation is impossible. The users are active Perpl traders at
5–15x leverage who cannot watch the screen around the clock: they set Airbag up once, glance at it
beside Perpl, and reach it from a push alert on their phone, often at night and just after a deploy.

Three moments have to work: **onboarding** (connect, sign in, link a key, choose a policy, arm),
**the glance** (armed, how far each position is from liquidation, what Airbag will do at the line),
and **the deploy** (before and after, a block-by-block log, the counterfactual).

## Content rules

These are the product, not preferences.

- **Yellow means Airbag**, the line it acts at and anything it did. **Red means liquidation** and
  nothing else. No third hue, ever.
- **Show the math.** Every claim on screen is a number the engine computed, with the price it is
  measured at. Nothing on screen is hand-typed or mocked: the landing replay and the settings
  preview both run `@airbag/risk`, so they cannot disagree with the engine.
- **Honest about limits.** Say what was verified, what the user confirmed, what is an estimate and
  what is simulated. A deploy is a **Save** only if the pre-deploy liquidation price was later
  reached while the position was still open; otherwise it is a **Precaution**. Never call a
  precaution a save. The counterfactual liquidation return is an estimate and is labelled one.
  Perpl exposes no endpoint that reads a key's IP allow-list back, so the UI says the user confirmed
  the lock — never that Airbag verified it. Simulated data is always labelled simulated, and the
  indexer's liquidation count is shown only when the indexer answers.
- **Status has a fixed vocabulary.** Armed, Deploying, Deployed · re-armed, Paused, Data stale ·
  holding, Connecting, Key rejected · relink, One-Click Trading off, Perpl connection limit, Account
  frozen; Liquidated (the liq lamp, a position the paper exchange liquidated in simulation); Past
  the line (the alert lamp, a real position on the wallet check that Airbag would act on now);
  Perpl now (lit, live chain data on the landing). Lamps and copy both draw from this list; a new
  state needs a lamp state and a word here.
- **The trader stays in control.** Pause, edit, unlink and revoke are always one step away.
- **Voice:** plain, precise, trader-literate. Sentence case. Numbers over adjectives. No
  exclamation marks, no "seamless", no "unlock", no "leverage" as a verb.

## Accessibility

WCAG 2.1 AA, checked by axe in the Playwright journeys in CI, where serious and critical violations
fail the run. Real buttons and links, labelled inputs, `aria-pressed` and `role="switch"`, a visible
focus ring, 44 px targets, 4.5:1 text contrast, and reduced-motion support. Colour is never the
only signal: liquidation and Airbag values also carry words.

---

# The system

## Overview

**North star: "the envelope protection panel".**

Airbag is flight-envelope protection for a leveraged position, and the interface is the cockpit panel that shows it. The page is the panel face, graphite and bone, cut into bays by 1px rules. Instruments are dark glass wells set into that face behind a thin bezel: a vertical price tape for the position closest to liquidation, horizontal runways for the rest, a per-block strip. Status is carried by annunciator lamps, lit tiles in a strip under the masthead, never by pills or stat cards.

The panel is quiet while the trader is safe: bone and grey only, numbers in tabular mono, motion limited to readouts rolling their digits each block. Colour appears only when it carries one of two meanings. When Airbag acts, the display's bezel lights yellow, the hazard stripe wipes across its top, and the bug and bands slide with damped instrument motion to their new places, the old ones left as dashed, struck-through ghosts.

Density is instrument density: small mono labels naming values, big mono readouts, sentence-case prose in Instrument Sans kept short and to the point.

**Key characteristics:**
- One continuous panel face; bays and sections separated by 1px rules, never by floating cards.
- Instruments sunk into darker glass wells with an inset shadow; nothing is lifted.
- Two meaning colours only: yellow for Airbag, red for liquidation.
- Annunciator lamps as lit tiles: unlit, lit bone, yellow, yellow line, inverted bone, liquidation red.
- Every number in Martian Mono, tabular; Archivo Expanded only for the few words that must land.
- Damped motion for things that move on a scale; lamps and readouts switch at once.

## Colors

A near-black warm graphite panel with bone ink, and exactly two signal hues that each mean one thing.

### Primary
- **Airbag Yellow** (airbag): the bug on the tape and runway, the protection band's warm hatch, the primary button, the lit `airbag` lamp, transaction links, the focus ring, the hazard stripe, and any value Airbag produced (the "with Airbag" figure, fills in the block log). Hover is the lighter **Airbag Yellow, Pressed Lit** (airbag-hover). The tint and edge variants (airbag-tint, airbag-edge) light a bezel or a notice when Airbag has acted or has something to say.

### Secondary
- **Liquidation Red** (liq): the red band beyond liquidation, the liquidation tick and flag, liquidation lines and old-liquidation ghosts, the "without Airbag" outcome, and block-log rows about liquidation. Its tint and edge (liq-tint, liq-edge) appear only on the `liq` lamp and liquidation lanes.

### Neutral
- **Panel Graphite** (ground): the panel face; page background, masthead, phone tab bar.
- **Glass Black** (well): instrument glass; wells, the annunciator strip, inputs, switch track, and the knockout behind tape flags.
- **Bay Graphite** (panel): hover fill for ghost buttons and nav, the simulation banner.
- **Raised Graphite** (raised): the current nav tab, secondary-button hover, the offline bar, the alert notice.
- **Bezel Line** (line): every 1px rule that cuts the panel, well bezels, row dividers.
- **Strong Line** (line-strong): control borders, minor graduations, the neutral hatch, the tape's scale edge.
- **Scale Grey** (scale): major graduation ticks on the tape.
- **Lit Face** and **Unlit Face** (lit, unlit): translucent bone washes; a lamp or chosen segment that is on, and one that is off (also the disabled primary button and the empty gauge).
- **Bone** (bone): primary ink, the mark readout box and pointer, the head cell of the block strip, the gauge fill, selected states, the alert lamp's inverted face.
- **Soft Bone** (soft-bone): memo prose, position names, the dashed "liquidation after" line on the tape.
- **Ash** (text-2): secondary text, labels, definitions in rows.
- **Faint Ash** (text-3): graduation numbers, unlit lamp legends, placeholders, timestamps. It clears 4.5:1 on ground, panel and well only; never set it on raised.

### Named Rules
**The Two Meanings Rule.** Yellow means Airbag; red means liquidation. No other hue exists in the system, and neither colour is ever used for emphasis, error, success or decoration.

**The Bone Choice Rule.** Anything the trader chose or must do is bone: selected segments, the on switch, the current tab, the alert lamp and alert notice, invalid inputs (dashed bone border). Never yellow, which is Airbag's, and never red, which is liquidation's.

**The Unlit Face Rule.** A disabled primary button is an unlit face (unlit background, text-3 legend), never a dimmed yellow. Yellow at half opacity would still say "Airbag".

## Typography

**Display Font:** Archivo at 125% width (with Helvetica Neue, sans-serif)
**Body Font:** Instrument Sans (with system-ui, Segoe UI, sans-serif)
**Label/Mono Font:** Martian Mono at 75 to 87.5% width (with ui-monospace, SF Mono, Menlo)

**Character:** An expanded grotesk for the few words that must land, a clear humanist-leaning sans for reading, and a condensed mono that turns every number into an instrument readout.

### Hierarchy
- **Display** (800, clamp(32px, 9.4vw, 108px), 0.95): the landing hero tagline only.
- **Headline** (700, clamp(30px, 3.6vw, 48px), 1.08, balanced): landing section heads; deploy and page titles use the same face at clamp(24px, 2.4vw, 32px) to clamp(28px, 3.2vw, 40px).
- **Wordmark** (800, 0.06em tracking, uppercase AIRBAG): the masthead beside the crash-test mark.
- **Title** (600, 15px, 1.3): the title of a bay section in the app ("Your airbag", "Block log").
- **Body** (400, 16px, 1.5): prose; the memo under the tape runs 16px/1.55 at 60ch max. Rows, side bay and notices run 14px; metadata 12 to 13px.
- **Readout** (Martian Mono 75% width, clamp(56px, 6.2vw, 100px), 0.9, -0.03em): the distance to liquidation and the save figure; 28 to 34px for secondary readouts.
- **Number** (Martian Mono 87.5% width, tabular): every other number, inline at the surrounding size.
- **Label** (Martian Mono 500, 11px, 0.1em, uppercase, text-2): names a value on an instrument ("TO LIQUIDATION", "SIZE").
- **Lamp** (Martian Mono 600, 11px, 0.1em, uppercase; 10px small): annunciator legends.

### Named Rules
**The Mono Numbers Rule.** Every number is Martian Mono with tabular figures, so digits hold still while a block changes them.

**The Label Names a Value Rule.** An uppercase mono label sits over or beside the readout it names. It never introduces a heading and never floats above a title as a kicker.

## Layout

**One frame on every page.** Every page, from the landing to a save report, sets its content in the same column: at most 1280px (`--max`), centred, never closer to the edge than the gutter (clamp(16px, 4vw, 48px)). Full-width bands (a masthead, the annunciator strip, a page body, a landing section, a footer) keep their rules edge to edge and pad their content in by `--inset`, `max(gutter, (100% − max) / 2)`. So the mark, the first letter of every heading and the last control on the right sit on the same two lines on every screen, and moving between pages never shifts them.

The app is one panel. Masthead (64px, 56px on phones) holds the mark, wordmark, tabs and account. Under it, the annunciator strip: a well-coloured rail, 48px min, ruled top and bottom, lamps spaced 8px by 28px. The body pads 28px top.

**Two bays** (`.bays` in globals.css) are the page layout wherever there is more than one thing to read: a main bay and a side bay `--bay` wide (clamp(300px, 27vw, 380px)), split by a 1px rule with 32px either side, so the rule falls in the same place on the dashboard, each onboarding step, settings and the deploy log. The side bay says what the main one can't: on connect and link-key what this step can and can't touch, on setup and settings the live preview, on the dashboard mode, key and deploys, on the deploy log what the saves add up to and what each lamp means. Sections within a bay are separated by a 1px top rule and 32px above and below. In the dashboard's main bay, the primary flight display is one well: the tape column (min 280px, 38%) on the left behind a rule, readouts on the right. Other positions follow as runway rows in a single well, rows split by rules; then the per-block strip.

Below 1000px the side bay moves under the main one, still cut by a rule (the settings preview moves between the heading and the form). Below 760px the masthead drops nav and account, a fixed three-tab bar (72px plus safe area) takes navigation, and the flight display restacks: distance and gauge first, the tape full width under them, the memo last. A narrow side bay (container under 320px) stacks each label over its value.

Spacing runs on 4px steps (s-1 to s-9); section gaps are 24 to 32px, row padding 12px.

### Named Rules
**The One Panel Rule.** The page is the panel face, cut by 1px rules. There are no cards: never a raised, rounded, bordered box floating on the face to hold content. Content that is not an instrument sits directly on the face.

**The Four Lamps Rule.** The annunciator strip keeps protection, mode, key and feed at every width. It wraps to a second row, and shortens legends on phones, before it drops a lamp.

**The Room Beyond Liquidation Rule.** The tape and the runway reserve at least two graduations beyond liquidation, so the red band always reads as a band, not an edge.

## Elevation & Depth

Depth only goes inward. Nothing casts a shadow onto the face; instruments are glass sunk into it, drawn darker than the panel with a 1px bezel and an inset shadow. Solid 0-blur rings are used to separate a marker from its glass (the runway mark dot), never as glow.

### Shadow Vocabulary
- **Glass well** (`box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.45)`): every well.
- **Selected segment** (`box-shadow: inset 0 0 0 1px var(--bone)`): doubles the bone border of a chosen segment.
- **Marker cutout** (`box-shadow: 0 0 0 3px var(--well)`, plus `0 0 0 5px var(--airbag)` when ringed): the runway mark dot knocked out of its track; the yellow ring only when Airbag is at work on it.
- **Current tab** (`box-shadow: inset 0 2px 0 var(--bone)`): the active phone tab's top edge.

### Named Rules
**The Glass Well Rule.** Instruments are sunk, never lifted: well background, 1px line bezel, inset shadow, 8px corners. No drop shadows anywhere in the system.

## Shapes

Small, machined corners. Lamps 3px, controls and notices 6px, wells 8px, the mark readout box 4px. Full rounding only for the switch track and thumb, the runway dot and the loader's mark. Instrument markers are cut shapes: the bug's notch and the readout's pointer are clip-path triangles pointing at the scale. Patterns are limited to two diagonal hatches (a neutral one between liquidation and the line, a warm one when the mark is inside the protection band) and the 45° yellow and graphite hazard stripe, 8px tall.

### Named Rules
**The Hazard Only When Airbag Acts Rule.** The hazard stripe appears only on a deploy (the flight display's top edge, wiping in over 320ms, and the deploy detail) and on the save report and its share image. Never as decoration or a section divider.

## Components

### Buttons
Machined, quiet until they are the one thing to press.
- **Shape:** 6px corners, 44px min height (36px small, 52px large), 20px side padding.
- **Primary:** Airbag Yellow with ground legend, 600 weight. Reserved for the action that arms or commits Airbag.
- **Hover / Focus / Active:** hover lifts to airbag-hover; focus is a 2px yellow outline offset 2px; active nudges down 1px and scales 0.99. Transitions 120ms.
- **Disabled primary:** the unlit face (see the Unlit Face Rule). Other disabled buttons drop to 50% opacity.
- **Secondary:** transparent with a strong-line border; hover raises to the raised fill with a text-3 border.
- **Ghost:** text-2 legend, 14px side padding; hover fills with panel and goes bone.

### Annunciator lamps
The status vocabulary of the panel; they replace pills and badges everywhere.
- **Style:** 26px tall (22px small) tiles, 3px corners, mono 11px uppercase legend, no border.
- **States:** off is unlit with a faint legend; on is lit bone; airbag is solid yellow with a ground legend while Airbag acts; airbag-line is a yellow tint with a yellow legend for "deployed" and "re-armed"; alert is inverted bone when the trader has to act; liq is a red tint, only for liquidation itself.
- **Fresh box:** for ten seconds after a lamp changes it is boxed by a 1px outline 4px outside it, the way a flight-mode annunciator marks a new mode. It switches on in two steps, never fades.

### Glass wells
- **Corner Style:** 8px.
- **Background:** well, with a 1px line bezel and the glass-well inset shadow.
- **Deployed:** the bezel turns airbag-edge and the hazard stripe runs across the top.
- **Internal Padding:** 16 to 32px for display panes; 7 to 8px for the block strip.

### Inputs / Fields
- **Style:** well background, strong-line border, 6px corners, 44px tall, 12px padding, Martian Mono 13px. Labels above in Instrument Sans 13px text-2, 6px gap.
- **Hover:** border to text-3. **Focus:** the global yellow outline.
- **Invalid:** a dashed bone border (the Bone Choice Rule), never red.

### Segmented choices and switch
- **Segments:** real buttons with `aria-pressed`; strong-line border, 6px corners. Selected: bone border, lit fill, inner bone ring.
- **Switch:** `role="switch"`, 48 by 28px on a well track; on turns the track bone and the thumb ground, sliding 20px on the damped curve.

### Navigation
- **Masthead tabs:** Instrument Sans 14px 500 text-2, 6px corners; hover panel fill, current page raised fill and bone.
- **Phone:** a fixed three-tab bar on ground with a top rule; icon over 12px label, current tab bone 600 with a 2px bone top edge.

### Notices and rows
- **Notice:** 6px corners, strong-line border, 14px. Airbag tone uses the yellow tint and edge; alert tone is a bone border on raised.
- **Rows:** definition lists as label-left, number-right lines, 12px vertical padding, 1px rules above the first and below each.

### Vertical tape (signature)
The primary flight display's instrument. A graduated scale (labelled majors with 14px scale-grey ticks, 6px minors) on the left, a 20px rail carrying the red band beyond liquidation and the hatched band between liquidation and the line, and markers: the liquidation tick (2px red), the yellow bug with its notch, the dashed entry line, the dashed soft-bone "after" line, and the mark in a bone-bordered well box with a pointer. Flags sit beside their ticks in mono and knock the glass out behind their text. Positions move with `top 240ms cubic-bezier(0.2, 0, 0, 1)`.

**The Knockout Flag Rule.** A tape flag carries a well background with 4px side padding, so a dashed ghost line never runs through its text. Superseded flags stay, struck through.

### Runway (signature)
The horizontal tape for every other position: a 2px line track, a 6px red cliff beyond liquidation, a 12px hatched zone, 2px ticks (the yellow one with a downward notch), and the mark as a bone dot cut out of the track. Labels sit under the track, the mark's in a bone-bordered box; they go to two rows when they would collide.

### Trace (a recorded mark)
The backtest's chart of one real liquidation: the mark as a 2px bone line on glass, drawn at the
well's own width so its 10px mono labels stay 10px on a phone. The Airbag line is yellow and the
liquidation price red, both solid until Airbag's first trim and dashed ghosts after it; the
liquidation after the trim is solid red from the trim on. Trims are yellow dots cut out of the glass,
Perpl's liquidation a hollow red ring on a faint vertical rule. Each level's label is knocked out of
the glass and sits at whichever end the trace leaves room. A crosshair reads the mark under the
pointer or the arrow keys; the block log under it carries every value, so nothing is hover-only.

### Block strip and readouts
The per-block strip is a well of 10px cells: strong-line for seen blocks, hollow for missed ones, bone for the head. It shifts left by exactly one cell per block. Readout digits that change roll in from above over 120ms.

### Loader
The one loading indicator on the platform is the crash-test mark itself: its two filled quadrants turn a quarter at a time on the damped curve (1.4s for two quarters, a hold after each), so yellow and black trade places on every beat. A page or bay waiting on the engine shows the mark at 44px with a mono label saying what it waits for and, when useful, one line of detail; it holds back 180ms so a quick answer never flashes it. Inside a busy button the same mark turns at 18px in the button's own ink. Lists keep their skeleton rows. Under reduced motion the mark stands still and the label carries the meaning.

The same turn plays once as the splash, on every full load (a refresh or an opened link), even though it is the loader's drawing. The mark sits alone on a ground curtain, large, and runs one cycle so it finishes on the pose the masthead wears. The mark then moves onto the masthead brand and the curtain lifts. A click or a key skips straight to that move. Without JavaScript the curtain fades once the cycle is over. Moving from page to page does not play it again. Under reduced motion the splash is not shown. It is an opening, not a second indicator and not a progress report.

### Motion
Instrument physics. Bugs, bands, ticks, gauges and labels move on the damped curve (`cubic-bezier(0.2, 0, 0, 1)`, 240ms); hover and colour changes take 120ms; a panel that arrives redraws top to bottom with a clip-path over 320ms. Lamps switch, they don't fade. Under reduced motion every animation is `none` and transitions collapse to 0.01ms; every keyframe animates in from a resting state, so nothing is left mid-flight.

## Do's and Don'ts

### Do:
- **Do** put every instrument in a glass well (well background, 1px line bezel, inset 0 1px 3px rgba(0, 0, 0, 0.45), 8px corners).
- **Do** separate bays and sections with 1px line rules on the panel face.
- **Do** show status as annunciator lamps in their six states, and box a lamp for ten seconds after it changes.
- **Do** set every number in Martian Mono with tabular figures.
- **Do** make selection, the on state and "the trader must act" bone.
- **Do** reserve at least two graduations beyond liquidation on the tape and the runway.
- **Do** keep protection, mode, key and feed in the annunciator strip at every width.
- **Do** knock the glass out behind tape flags.
- **Do** move scale markers on the damped curve and set `animation: none` under reduced motion.
- **Do** write in sentence case, plain and precise, numbers over adjectives.

### Don't:
- **Don't** build cards: no raised, rounded, bordered boxes floating on the panel to hold content, and no grid of stat tiles.
- **Don't** use outlined or rounded pills for status; use a lamp tile.
- **Don't** use yellow for selection, emphasis or a dimmed disabled state; yellow only means Airbag.
- **Don't** use red for errors, warnings or losses that are not liquidation.
- **Don't** introduce any hue beyond yellow and red, any glow, or any colour gradient. Repeating-gradient patterns are for the two hatches, the hazard stripe and drawn graduations only.
- **Don't** cast drop shadows; depth is inset only.
- **Don't** show the hazard stripe unless Airbag acted (a deploy, a save).
- **Don't** put an uppercase label above a heading as a kicker.
- **Don't** use exclamation marks, "seamless", "unlock", or "leverage" as a verb.
