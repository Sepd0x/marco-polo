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

On five places drawn by lot and labelled blind, v3 scores F1 89.2% [87.3, 90.8] against 37.4% for v1. It misses two of the nine targets fixed before the first run; see [Limits](#limits).

<!-- /headline -->

## How it works

v1 found water by colour rules. v3, the current detector, proposes candidates by colour, describes each with 56 features of colour, shape and context, and scores them with 300 gradient-boosted trees and a small neural network (84 KB, plain TypeScript, in web workers; [detection](docs/DETECTION.md), [architecture](docs/ARCHITECTURE.md)).

Imagery follows the place: DGT in Portugal, PNOA in Spain, IGN in France, open aerial photos at 20 to 25 cm. Elsewhere it uses Esri, which the model never trained on; results are much weaker. Each pool gets an outline, an area and, when the shape allows, length and width.

## v1 and v3 on the same photo

<!-- figure: written by scripts/check-readme.mjs -->

Marbella, PNOA aerial photo, 192 m across, a held-out zone.

| v1 | v3, current |
|:-:|:-:|
| <img src="docs/media/marbella-v1.jpg" width="440" alt="v1 on the PNOA photo: half the pools have no outline"> | <img src="docs/media/marbella-v3.jpg" width="440" alt="v3 on the PNOA photo: outlines on most pools"> |
| 14 found, 1 wrong, 14 missed | 23 found, 1 wrong, 5 missed |

Over the whole zone the gap is narrower: v1 68.0%, v3 72.9%.

<!-- /figure -->

Magenta: pool found. Orange: no pool there. White dashes: pool missed ([`figure.ts`](packages/eval/src/figure.ts)).

## Results

<!-- results: written by scripts/check-readme.mjs -->

| zones | pools | v1 F1 | v3 F1 |
|---|--:|--:|--:|
| Tuning (DEV) | 489 | 28.9% [24.6, 33.9] | 80.6% [77.1, 83.7] |
| Held out (DEV-2) | 760 | 48.6% [45.0, 52.7] | 74.3% [70.6, 77.7] |
| Reviewed (GOLD) | 478 | 66.1% [60.0, 71.2] | 85.5% [82.6, 88.1] |
| Test (TEST) | 1287 | 37.4% [32.6, 42.6] | 89.2% [87.3, 90.8] |
| Test, no pools: false detections per km² | 0 | 8.0 | 31.0 |

F1 with its 95% interval; same labels and imagery for both, both run on 28 Oct 2026 ([method](packages/eval/README.md), [TEST run](packages/eval/results/TEST_RUN_2.md)).

<!-- /results -->

<!-- notes: written by scripts/check-readme.mjs -->

TEST beats tuning because F1 is counted over pools and La Nucía holds 894 of the 1287. Per place it runs from 60.5% (Dammarie-les-Lys) to 94.1% (La Nucía), mean 79.0%.

Against v2, the [previous model](packages/eval/results/TEST_RUN_1.md), v3 gives up no F1 (89.6% to 89.2%) for better areas (median error 18.6% to 14.6%) and large pools (25 to 46 of 69 pools of 400 m² or more, where v1 still finds 60), with more false detections in the zone with no pools (25 to 31 per km²).

Reported apart: Brixen, winter Esri imagery in the Alps, where v3 finds 2 of 20 pools and v1 does better.

v1 was built for Esri: 55.9% on tuning and 70.3% held out there (older labels). On the open photos tree canopy passes its colour rules.

<!-- /notes -->

## Limits

<!-- limits: written by scripts/check-readme.mjs -->

- Areas still come out small: signed median error -8.1% on TEST, target within 5%. The median error (14.6%, 28 outlines) meets its 15% target.
- The test zone with no pools is a port: 31 false detections per km², against 8 for v1.

<!-- /limits -->

- Covered, empty and shaded pools are missed; blue cars, solar panels and teal roofs pass at times.
- Worker speed: within target on a Ryzen AI 9 365 laptop, estimated to miss the 512 px one on a 4-core 2.1 GHz Xeon; measured with the previous model ([bench](tests/bench/RESULTS.md)).
- Firefox and Safari are not measured.

## Privacy and security

No backend, account or API keys: static files on GitHub Pages; results stay in your browser. A Content Security Policy meta tag allows connections only to the imagery hosts, OpenFreeMap and Nominatim. CI runs with a read-only token. Flaws: [SECURITY.md](SECURITY.md).

It finds pools on private property: use it for counts over an area, not to look into a person or address ([responsible use](docs/IMAGERY.md#responsible-use)).

## Run it

```bash
# Node 24
npm install
npm run dev          # http://localhost:5173
npm run scan -- --bbox "36.491,-4.959,36.494,-4.956"   # CLI
```

`npm run verify` runs everything; its release gate fails on the missed targets.

## Licence

Code MIT. OpenStreetMap labels [ODbL](packages/eval/labels/ATTRIBUTION.md); model [credits](packages/core/models/ATTRIBUTION.md). Imagery: DGT and PNOA CC BY 4.0, IGN Licence Ouverte 2.0, Esri terms of use. Map labels © OpenFreeMap © OpenMapTiles © OpenStreetMap contributors.
