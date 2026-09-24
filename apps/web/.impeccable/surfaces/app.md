---
version: 1
slug: "app"
primary_target: "app"
related_targets: ["components"]
---

# Surface brief: the Airbag web app

Scope: every route in apps/web (landing, connect, link-key, setup, dashboard with its deploy state, deploys, deploy detail, settings, public save report, 404, error) and the save card share image. Visitor modes: Operate for /app and onboarding, Persuade for /, Read for /s/[id].

Audience and job: leveraged Perpl traders checking that Airbag is armed, how far each position is from liquidation, what Airbag will do at the line, and what it did; hackathon judges watching the demo.

Constraints: PRODUCT.md brand commitments (mark, tagline, the original dark palette and three fonts, yellow = Airbag, red = liquidation only, hazard stripe only when Airbag acts). Every number from the engine or `@airbag/risk`. The e2e journeys keep passing; copy they assert changes only deliberately.

Memorable moment: the intervention. The protection annunciator goes yellow and boxes itself, the instrument's bezel takes the hazard stripe, and on the tape the red liquidation band slides down the scale while the old one stays as a dashed ghost and the yellow bug re-arms lower.

History: the owner first adopted a photocopied-zine world (branch redesign/zine, unmerged), then rejected it on seeing it built: the original dark identity was better. This direction evolves that identity instead of replacing it.

## Direction contract

THESIS: Airbag is flight-envelope protection for a leveraged position. Each position is an instrument tape: a red band where liquidation begins, a yellow bug where protection engages, a readout for the mark that moves every block, and a strip of annunciators saying what the system is doing. It refuses the card grid of stat tiles and pills.

OWN-WORLD: The original graphite and bone panel, Archivo Expanded for the few words that must land, Instrument Sans for reading, Martian Mono for every number. Instruments sit in darker glass wells set into the panel behind 1px bezels, not in floating rounded cards. Red only for liquidation, yellow only for Airbag, no other hue, no glow, no gradients beyond the hatch and the hazard stripe. Annunciators replace pills: dark when off, bone when on, yellow when Airbag acts, inverted bone when the trader must act.

STORY: At a glance the trader knows protection is armed and the feed is live, how close each position is to its red band, and exactly what Airbag does at the bug. When it acts they watch the envelope move, then read the block-by-block log and the counterfactual.

FIRST VIEWPORT: Dashboard at 1440: masthead (mark, AIRBAG, tabs, account), an annunciator strip (PROTECTION ARMED, the mode, FEED LIVE with the block, KEY OK). Main column: the primary flight display for the closest position, a tall vertical tape on the left of a glass well with graduations, red band, hatched protection band, yellow bug and a bone mark readout, and on its right the distance to liquidation in large mono and the memo of what happens at the line. Under it, other positions as horizontal runways, then the per-block strip. Side column: mode, key, log of deploys.

FORM: Envelope Protection, IMPECCABLE'S PICK (first on the grounded list), built on the incumbent identity at the owner's request; seed key beaf2908. Signature interaction: the bug and bands slide with damped instrument motion when settings or a deploy move them; annunciators box themselves for ten seconds after they change; readouts roll their digits each block.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
