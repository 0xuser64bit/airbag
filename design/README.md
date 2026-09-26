# Airbag design reference

> These artboards are the approved **identity**: palette, type, mark, colour meaning, copy and
> numbers. The screens were rebuilt on that identity as one instrument panel — see
> [`apps/web/DESIGN.md`](../apps/web/DESIGN.md) for what the app actually implements, and treat the
> layouts here as reference, not as markup to copy.

The source files are exported from a design canvas. They are **reference material, not code to
import.**

## How to read them

- Each `*.dc.html` file is one screen (an artboard). The layout is plain HTML with **inline styles**, so exact colors, sizes, spacing, radii and copy can be read straight from the markup.
- `<x-dc>`, `<helmet>`, `<sc-for>`, `<sc-if>` and `{{holes}}` belong to the design tool's runtime (`support.js`, not included). Read them as a template: `<sc-for>` is a loop, `<sc-if>` a condition, `{{name}}` a value computed in the `<script type="text/x-dc">` block at the bottom of the file.
- Font loading is the Google Fonts link inside `<helmet>`: Archivo (wdth 62–125), Instrument Sans, Martian Mono.
- `canvas.json` lists every screen with its size and title.

## Screens

| File | Size | What it is |
|---|---|---|
| `System.dc.html` | 1440×1960 | Identity, colour, type, and the components as first drawn (buttons, status pills, runway in three states, deploy log row). The shipped app replaced the pills with annunciator lamps; see `apps/web/DESIGN.md`. |
| `Main.dc.html` | 1440×5700 | Landing page. The crash-test replay logic (price path, timing, lane math) is in its script block. |
| `Connect.dc.html` | 1280×940 | Onboarding 1: wallet connected, Perpl account found |
| `LinkKey.dc.html` | 1280×940 | Onboarding 2: create a Trade key, IP allow-list, paste, verified |
| `Settings.dc.html` | 1280×940 | Onboarding 3: airbag settings with live preview (its script is the reference implementation of the preview math) |
| `Dashboard.dc.html` | 1440×900 | App, armed state |
| `Deployed.dc.html` | 1440×900 | App, the moment Airbag deploys |
| `SaveCard.dc.html` | 1200×675 | Share image / OG card |
| `MobileHome.dc.html` | 390×844 | Phone: positions |
| `MobileDeploy.dc.html` | 390×844 | Phone: deploy detail |
| `MobileSave.dc.html` | 390×844 | Phone: save report |

All numbers shown in the designs are the golden test vectors in [`docs/RISK-MODEL.md`](../docs/RISK-MODEL.md). Sample account data (positions, block numbers, times, tx hash, IP ranges) is illustrative; the IP ranges are documentation addresses (203.0.113.0/24), not real servers.
