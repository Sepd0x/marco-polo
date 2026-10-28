<div align="center">

<img src="apps/web/public/favicon.svg" width="44" height="44" alt="">

# Marco Polo

Draw an area on the map. It finds the swimming pools in the aerial photo, measures them and ranks them. It runs in your browser.

[Live demo](https://sepd0x.github.io/marco-polo/) · [How it works](#how-it-works) · [Results](#results) · [Limits](#limits)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/app-dark.jpg">
  <img src="docs/media/app-light.jpg" width="900" alt="A finished scan of Birre, Cascais: 48 pools outlined in magenta on the DGT aerial photo, ranked in the list on the left">
</picture>

</div>

<!-- headline: written by scripts/check-readme.mjs -->

On five places drawn by lot and labelled blind, v2 scores F1 89.6% [87.7, 91.1] against 37.0% for v1. It misses three of the nine targets fixed before that run; see [Limits](#limits).

<!-- /headline -->

## How it works

v1 found water by colour rules. v2 uses colour only to propose candidates, describes each with 56 features of colour, shape and context, and scores them with 300 gradient-boosted trees and a small neural network: an 84 KB model in plain TypeScript, run in web workers ([detection](docs/DETECTION.md), [architecture](docs/ARCHITECTURE.md)).

Imagery follows the place: DGT in Portugal, PNOA in Spain, IGN in France, open aerial photos at 20 to 25 cm. Elsewhere it uses Esri, which v2 never trained on; results there are much weaker. Each pool gets an outline, an area in m² and, when the shape allows, length and width.

## v1 and v2 on the same photo

<!-- figure: written by scripts/check-readme.mjs -->

Marbella, PNOA aerial photo, 192 m across: a held-out zone, never used to tune.

| v1 | v2 |
|:-:|:-:|
| <img src="docs/media/marbella-v1.jpg" width="440" alt="v1 on the PNOA photo: half the pools have no outline"> | <img src="docs/media/marbella-v2.jpg" width="440" alt="v2 on the PNOA photo: outlines on most pools"> |
| 14 found, 1 wrong, 14 missed | 23 found, 2 wrong, 5 missed |

Over the whole zone the gap is narrower: v1 68.0%, v2 72.7%.

<!-- /figure -->

Magenta: pool found. Orange: no pool there. White dashes: pool missed. Drawn by [`figure.ts`](packages/eval/src/figure.ts).

## Results

How it is measured: [method](packages/eval/README.md), [TEST run 1](packages/eval/results/TEST_RUN_1.md).

<!-- results: written by scripts/check-readme.mjs -->

| zones | n | pools | v1 F1 | v2 F1 |
|---|--:|--:|--:|--:|
| Tuning (DEV) | 6 | 489 | 28.9% [24.6, 33.8] | 79.9% [76.3, 83.1] |
| Held out (DEV-2) | 5 | 760 | 48.6% [45.0, 52.7] | 74.6% [71.0, 77.9] |
| Reviewed (GOLD) | 5 | 478 | 65.8% [59.8, 71.0] | 85.4% [82.4, 87.8] |
| Test (TEST) | 5 | 1287 | 37.0% [32.3, 42.2] | 89.6% [87.7, 91.1] |
| Test, no pools: false detections per km² | 1 | 0 | 8.0 | 25.0 |

F1 with its 95% interval; same labels and imagery for both, both run at e676b20 on 10 Oct 2026.

<!-- /results -->

<!-- notes: written by scripts/check-readme.mjs -->

TEST beats tuning because F1 is counted over pools and La Nucía holds 894 of the 1287. Per place: La Nucía 94.3%, Viseu 89.7%, Santa Fe Springs 87.9%, Mirandela 67.2%, Dammarie-les-Lys 58.4%; mean 79.5%.

Reported apart: Brixen, winter Esri imagery in the Alps, where v2 finds 1 of 20 pools and v1 does better.

v1 was built for Esri, where it scored 55.9% on tuning and 70.3% held out (older labels). On the open photos tree canopy passes its colour rules; v2 is what made them usable.

<!-- /notes -->

## Limits

<!-- limits: written by scripts/check-readme.mjs -->

- Areas come out small: median error 18.6% on TEST over 24 outlines (target 15%), signed -15.2% (target within 5%).
- In the test zone with no pools, a port, 25 false detections per km² (v1: 8).
- Recall is uneven: 48% in Dammarie-les-Lys.

<!-- /limits -->

- Covered, empty and tree-shaded pools are missed; blue cars, solar panels and teal roofs pass at times.
- Worker speed targets (p95 150 ms per 512 px request, 50 ms per 256 px tile) are met on a Ryzen AI 9 365 laptop. A 4-core 2.1 GHz Xeon would miss the first, at about 170 ms (estimated, [bench](tests/bench/RESULTS.md)).
- Firefox and Safari are not measured.

## Privacy and security

No backend, account or API keys: static files on GitHub Pages; areas and results stay in your browser. A Content Security Policy meta tag allows connections only to the imagery hosts, OpenFreeMap and Nominatim. CI runs with a read-only token. To report a flaw: [SECURITY.md](SECURITY.md).

It finds pools on private property: use it for counts over an area, not to look into a person or an address ([responsible use](docs/IMAGERY.md#responsible-use)).

## Run it

```bash
# Node 24
npm install
npm run dev          # http://localhost:5173
npm test
npm run scan -- --bbox "36.491,-4.959,36.494,-4.956"   # CLI, detector v2
```

`npm run verify` runs everything, including the release gate, which fails on the three missed targets.

## Licence

Code MIT. OpenStreetMap labels [ODbL](packages/eval/labels/ATTRIBUTION.md); model [credits](packages/core/models/ATTRIBUTION.md). Imagery: DGT and PNOA CC BY 4.0, IGN Licence Ouverte 2.0, Esri terms of use. Map labels © OpenFreeMap © OpenMapTiles © OpenStreetMap contributors.
