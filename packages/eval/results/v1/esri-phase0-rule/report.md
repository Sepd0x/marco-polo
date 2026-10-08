# Benchmark: v1 @ 0.55, --source esri

- detector: `v1` (packages/core detectTile + DetectionMerger, default options), hash `57d77e98b36c`
- confidence threshold: 0.55
- imagery: `--source esri` (per zone below), z19 grid; 3375 images read, manifest `eec7faa78e20`
- labels: frozen set `ff571bd89c5a`, see `packages/eval/README.md`; point rule v1
- commit: fc6f5cc, run 2026-10-07

A detection hits a polygon label when its centre falls inside it or the two boxes overlap with IoU >= 0.3. It hits a point label when its centre is within 5 m of the point or the point falls inside its outline (phase 0 rule). Each label is matched once. Precision is over detections, recall over labels. Brackets: 95% interval, block bootstrap (4 x 4 z19 tiles, 2000 replicates, seed 20261007). Area error compares the detected area with the OSM polygon, over hits on OSM polygons only; "signed" below zero means the detector under-measures. Time is detector CPU time per km², tiles already decoded.

## DEV

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Vilamoura, PT (1.00 km²) | 69 | 58 | 36 | 22 | 33 | 62.1% | 52.2% | 56.7% | esri-world-imagery | 26.7% (n=35) | -24.0% | 312 |
| Scottsdale, AZ, US (0.56 km²) | 78 | 63 | 54 | 9 | 24 | 85.7% | 69.2% | 76.6% | esri-world-imagery | 30.6% (n=2) | +22.7% | 242 |
| Odemira greenhouses, Alentejo, PT (1.00 km²) | 0 | 1 | 0 | 1 | 0 | 0.0% | n/a | n/a | esri-world-imagery | n/a (n=0) | n/a | 197 |
| Puyricard, Aix-en-Provence, FR (1.00 km²) | 99 | 68 | 62 | 6 | 37 | 91.2% | 62.6% | 74.3% | esri-world-imagery | 34.7% (n=40) | -29.1% | 273 |
| Balma, Toulouse, FR (1.00 km²) | 65 | 17 | 16 | 1 | 49 | 94.1% | 24.6% | 39.0% | esri-world-imagery | 42.6% (n=11) | +12.9% | 264 |
| **all DEV** | 311 | 207 | 168 | 39 | 143 | 81.2% | 54.0% | 64.9% |  | 30.7% (n=88) | -23.8% | 259 |

Precision 81.2% [74.4, 87.1], recall 54.0% [48.1, 60.1], F1 64.9% [59.4, 70.2]. Errors (FP + FN) 182 [148, 215]. FP per km² 8.5. Macro F1 61.6%.

Median area error 30.7% [25.9, 37.0], signed -23.8% [-29.9, -17.1] (n=88). Centre offset median 0.52 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 15.6% and 19.2% (n=88).

## DEV-2

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Marbella, ES (1.00 km²) | 150 | 149 | 114 | 35 | 36 | 76.5% | 76.0% | 76.3% | esri-world-imagery | 31.4% (n=16) | -31.4% | 293 |
| Birre, Cascais, PT (0.56 km²) | 150 | 130 | 128 | 3 | 22 | 97.7% | 85.3% | 91.1% | esri-world-imagery | 22.7% (n=6) | -22.7% | 350 |
| Santa Barbara de Nexe, Algarve interior, PT (1.00 km²) | 52 | 34 | 30 | 4 | 22 | 88.2% | 57.7% | 69.8% | esri-world-imagery | 36.5% (n=2) | -36.5% | 221 |
| Castelnau-le-Lez, Montpellier, FR (1.00 km²) | 224 | 116 | 78 | 38 | 146 | 67.2% | 34.8% | 45.9% | esri-world-imagery | 26.2% (n=75) | -14.1% | 278 |
| Arcadia, Phoenix, AZ, US (1.00 km²) | 182 | 142 | 125 | 18 | 57 | 87.3% | 68.7% | 76.9% | esri-world-imagery | 61.4% (n=3) | -61.4% | 234 |
| **all DEV-2** | 758 | 571 | 475 | 98 | 283 | 82.8% | 62.7% | 71.4% |  | 30.1% (n=102) | -18.3% | 268 |

Precision 82.8% [77.3, 87.6], recall 62.7% [58.1, 67.2], F1 71.4% [67.6, 74.9]. Errors (FP + FN) 381 [320, 444]. FP per km² 21.5. Macro F1 72.0%.

Median area error 30.1% [21.3, 37.0], signed -18.3% [-31.1, -12.2] (n=102). Centre offset median 0.74 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 14.2% and 22.2% (n=102).

## Threshold sweep (micro-averaged)

| threshold | DEV P | DEV R | DEV F1 | DEV-2 P | DEV-2 R | DEV-2 F1 |
|--:|--:|--:|--:|--:|--:|--:|
| 0.30 | 71.6% | 60.8% | 65.7% | 80.4% | 67.5% | 73.4% |
| 0.35 | 71.8% | 60.5% | 65.6% | 80.8% | 67.4% | 73.5% |
| 0.40 | 73.0% | 60.1% | 66.0% | 81.0% | 67.0% | 73.3% |
| 0.45 | 75.3% | 59.8% | 66.7% | 81.6% | 66.2% | 73.1% |
| 0.50 | 79.6% | 57.9% | 67.0% | 82.2% | 65.0% | 72.6% |
| 0.55 | 81.2% | 54.0% | 64.9% | 82.8% | 62.7% | 71.4% |
| 0.60 | 83.4% | 48.6% | 61.4% | 83.0% | 59.4% | 69.2% |
| 0.65 | 85.9% | 45.0% | 59.1% | 83.4% | 54.6% | 66.0% |
| 0.70 | 84.8% | 39.5% | 53.9% | 83.1% | 47.6% | 60.5% |
| 0.75 | 87.7% | 29.9% | 44.6% | 82.1% | 37.9% | 51.8% |
| 0.80 | 91.5% | 20.9% | 34.0% | 79.3% | 22.4% | 35.0% |

## Labels per area

Review "full": every window checked by eye and missed pools boxed by hand. "candidates": every unlabelled colour candidate checked plus a sample of windows, so recall there is an upper bound. "blind": every window checked on clean imagery with nothing drawn, OSM merged afterwards. "gold-union": phase 0 gold, the union of what the methods proposed, checked by eye. "absent" are labels whose pool is not in this source's imagery, ignored here.

| area | role | review | pool labels | points | hand-added | ignored | absent | tiles |
|---|---|---|--:|--:|--:|--:|--:|--:|
| Vilamoura, PT | DEV | full | 69 | 0 | 3 | 19 | 0 | 342 |
| Scottsdale, AZ, US | DEV | full | 78 | 3 | 72 | 14 | 0 | 196 |
| Odemira greenhouses, Alentejo, PT | DEV | full | 0 | 0 | 0 | 0 | 0 | 342 |
| Puyricard, Aix-en-Provence, FR | DEV | full | 99 | 0 | 38 | 24 | 0 | 420 |
| Balma, Toulouse, FR | DEV | full | 65 | 0 | 17 | 46 | 0 | 441 |
| Marbella, ES | DEV-2 | candidates | 150 | 104 | 26 | 37 | 0 | 361 |
| Birre, Cascais, PT | DEV-2 | full | 150 | 0 | 142 | 35 | 0 | 225 |
| Santa Barbara de Nexe, Algarve interior, PT | DEV-2 | full | 52 | 0 | 44 | 28 | 0 | 324 |
| Castelnau-le-Lez, Montpellier, FR | DEV-2 | candidates | 224 | 0 | 6 | 91 | 0 | 400 |
| Arcadia, Phoenix, AZ, US | DEV-2 | candidates | 182 | 162 | 14 | 43 | 0 | 324 |

## Errors, automatic split

| area | FP unlabelled | FP duplicate | FN below threshold | FN partial overlap | FN not detected |
|---|--:|--:|--:|--:|--:|
| Vilamoura, PT | 19 | 3 | 6 | 5 | 22 |
| Scottsdale, AZ, US | 9 | 0 | 0 | 1 | 23 |
| Odemira greenhouses, Alentejo, PT | 1 | 0 | 0 | 0 | 0 |
| Puyricard, Aix-en-Provence, FR | 6 | 0 | 4 | 0 | 33 |
| Balma, Toulouse, FR | 1 | 0 | 11 | 0 | 38 |
| Marbella, ES | 34 | 1 | 11 | 4 | 21 |
| Birre, Cascais, PT | 3 | 0 | 5 | 0 | 17 |
| Santa Barbara de Nexe, Algarve interior, PT | 4 | 0 | 7 | 0 | 15 |
| Castelnau-le-Lez, Montpellier, FR | 37 | 1 | 7 | 3 | 136 |
| Arcadia, Phoenix, AZ, US | 18 | 0 | 9 | 1 | 47 |

## Where undetected pools were lost (core pipeline)

For every missed label with no detection on it, the first pipeline stage that drops it: rerun with that stage relaxed, see whether the pool appears.

| stage | DEV | DEV-2 |
|---|--:|--:|
| colour gate: dull green or grey water | 41 | 81 |
| colour gate: turquoise-green water (green above blue) | 29 | 49 |
| colour gate: dark water | 1 | 49 |
| size/shape filter or merger | 11 | 33 |
| colour gate: pale water (low saturation) | 15 | 14 |
| colour gate: deep blue water (hue above the band) | 7 | 4 |
| texture ceiling | 7 | 3 |
| texture ceiling (and low confidence) | 3 | 3 |
| mask cleanup (pixels pass, shape lost) | 2 | 0 |
