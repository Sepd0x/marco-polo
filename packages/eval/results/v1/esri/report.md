# Benchmark: v1 @ 0.55, --source esri

- detector: `v1` (packages/core detectTile + DetectionMerger, default options), hash `57d77e98b36c`
- confidence threshold: 0.55
- imagery: `--source esri` (per zone below), z19 grid; 3775 images read, manifest `ff5d4d8eeba1`
- labels: frozen set `bb1daad360f0`, see `packages/eval/README.md`; point rule v2
- commit: 69574c2, run 2026-10-08

A detection hits a polygon label when its centre falls inside it or the two boxes overlap with IoU >= 0.3. It hits a point label when its centre is within max(3 m, half the long side of its box) of the point and its area is at most max(4 x the median pool label of the zone, 150 m²). Each label is matched once. Precision is over detections, recall over labels. Brackets: 95% interval, block bootstrap (4 x 4 z19 tiles, 2000 replicates, seed 20261007). Area error compares the detected area with the OSM polygon, over hits on OSM polygons only; "signed" below zero means the detector under-measures. Time is detector CPU time per km², tiles already decoded.

## DEV

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Vilamoura, PT (1.00 km²) | 69 | 58 | 36 | 22 | 33 | 62.1% | 52.2% | 56.7% | esri-world-imagery | 26.7% (n=35) | -24.0% | 286 |
| Scottsdale, AZ, US (0.56 km²) | 78 | 63 | 54 | 9 | 24 | 85.7% | 69.2% | 76.6% | esri-world-imagery | 30.6% (n=2) | +22.7% | 329 |
| Odemira greenhouses, Alentejo, PT (1.00 km²) | 0 | 1 | 0 | 1 | 0 | 0.0% | n/a | n/a | esri-world-imagery | n/a (n=0) | n/a | 414 |
| Puyricard, Aix-en-Provence, FR (1.00 km²) | 99 | 68 | 62 | 6 | 37 | 91.2% | 62.6% | 74.3% | esri-world-imagery | 34.7% (n=40) | -29.1% | 569 |
| Balma, Toulouse, FR (1.00 km²) | 65 | 17 | 16 | 1 | 49 | 94.1% | 24.6% | 39.0% | esri-world-imagery | 42.6% (n=11) | +12.9% | 530 |
| Braga, PT (1.00 km²) | 166 | 64 | 41 | 23 | 125 | 64.1% | 24.7% | 35.7% | esri-world-imagery | 30.6% (n=31) | -2.7% | 493 |
| **all DEV** | 477 | 271 | 209 | 62 | 268 | 77.1% | 43.8% | 55.9% |  | 30.7% (n=119) | -21.7% | 445 |

Precision 77.1% [70.4, 83.5], recall 43.8% [38.2, 49.6], F1 55.9% [50.3, 61.2]. Errors (FP + FN) 330 [274, 399]. FP per km² 11.1. Macro F1 56.4%.

Median area error 30.7% [26.3, 35.4], signed -21.7% [-26.9, -11.8] (n=119). Centre offset median 0.77 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 15.8% and 22.3% (n=119).

## DEV-2

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Marbella, ES (1.00 km²) | 150 | 151 | 109 | 42 | 41 | 72.2% | 72.7% | 72.4% | esri-world-imagery | 31.4% (n=16) | -31.4% | 559 |
| Birre, Cascais, PT (0.56 km²) | 150 | 130 | 128 | 3 | 22 | 97.7% | 85.3% | 91.1% | esri-world-imagery | 22.7% (n=6) | -22.7% | 600 |
| Santa Barbara de Nexe, Algarve interior, PT (1.00 km²) | 52 | 34 | 30 | 4 | 22 | 88.2% | 57.7% | 69.8% | esri-world-imagery | 36.5% (n=2) | -36.5% | 405 |
| Castelnau-le-Lez, Montpellier, FR (1.00 km²) | 224 | 116 | 78 | 38 | 146 | 67.2% | 34.8% | 45.9% | esri-world-imagery | 26.2% (n=75) | -14.1% | 550 |
| Arcadia, Phoenix, AZ, US (1.00 km²) | 182 | 142 | 124 | 19 | 58 | 86.6% | 68.1% | 76.3% | esri-world-imagery | 61.4% (n=3) | -61.4% | 439 |
| **all DEV-2** | 758 | 573 | 469 | 106 | 289 | 81.5% | 61.9% | 70.3% |  | 30.1% (n=102) | -18.3% | 503 |

Precision 81.5% [75.9, 86.2], recall 61.9% [57.3, 66.4], F1 70.3% [66.5, 73.9]. Errors (FP + FN) 395 [334.975, 457.02499999999986]. FP per km² 23.2. Macro F1 71.1%.

Median area error 30.1% [21.3, 37.0], signed -18.3% [-31.1, -12.2] (n=102). Centre offset median 0.74 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 14.2% and 22.2% (n=102).

## Threshold sweep (micro-averaged)

| threshold | DEV P | DEV R | DEV F1 | DEV-2 P | DEV-2 R | DEV-2 F1 |
|--:|--:|--:|--:|--:|--:|--:|
| 0.30 | 68.4% | 50.3% | 58.0% | 78.9% | 66.5% | 72.2% |
| 0.35 | 68.5% | 50.1% | 57.9% | 79.3% | 66.4% | 72.2% |
| 0.40 | 69.4% | 49.9% | 58.0% | 79.4% | 66.0% | 72.1% |
| 0.45 | 71.5% | 49.5% | 58.5% | 80.0% | 65.2% | 71.8% |
| 0.50 | 74.6% | 47.4% | 57.9% | 80.8% | 64.1% | 71.5% |
| 0.55 | 77.1% | 43.8% | 55.9% | 81.5% | 61.9% | 70.3% |
| 0.60 | 77.7% | 37.3% | 50.4% | 81.7% | 58.6% | 68.2% |
| 0.65 | 79.5% | 34.2% | 47.8% | 82.2% | 53.8% | 65.0% |
| 0.70 | 77.7% | 29.1% | 42.4% | 81.7% | 46.8% | 59.5% |
| 0.75 | 79.8% | 21.6% | 34.0% | 80.7% | 37.2% | 50.9% |
| 0.80 | 80.7% | 14.9% | 25.1% | 77.0% | 21.8% | 33.9% |

## Labels per area

Review "full": every window checked by eye and missed pools boxed by hand. "candidates": every unlabelled colour candidate checked plus a sample of windows, so recall there is an upper bound. "blind": every window checked on clean imagery with nothing drawn, OSM merged afterwards. "gold-union": phase 0 gold, the union of what the methods proposed, checked by eye. "absent" are labels whose pool is not in this source's imagery, ignored here.

| area | role | review | pool labels | points | hand-added | ignored | absent | tiles |
|---|---|---|--:|--:|--:|--:|--:|--:|
| Vilamoura, PT | DEV | full | 69 | 0 | 3 | 19 | 0 | 342 |
| Scottsdale, AZ, US | DEV | full | 78 | 3 | 72 | 14 | 0 | 196 |
| Odemira greenhouses, Alentejo, PT | DEV | full | 0 | 0 | 0 | 0 | 0 | 342 |
| Puyricard, Aix-en-Provence, FR | DEV | full | 99 | 0 | 38 | 24 | 0 | 420 |
| Balma, Toulouse, FR | DEV | full | 65 | 0 | 17 | 46 | 0 | 441 |
| Braga, PT | DEV | blind | 166 | 0 | 91 | 45 | 0 | 400 |
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
| Braga, PT | 23 | 0 | 10 | 9 | 106 |
| Marbella, ES | 41 | 1 | 10 | 9 | 22 |
| Birre, Cascais, PT | 3 | 0 | 5 | 0 | 17 |
| Santa Barbara de Nexe, Algarve interior, PT | 4 | 0 | 7 | 0 | 15 |
| Castelnau-le-Lez, Montpellier, FR | 37 | 1 | 7 | 3 | 136 |
| Arcadia, Phoenix, AZ, US | 19 | 0 | 7 | 2 | 49 |

## Where undetected pools were lost (core pipeline)

For every missed label with no detection on it, the first pipeline stage that drops it: rerun with that stage relaxed, see whether the pool appears.

| stage | DEV | DEV-2 |
|---|--:|--:|
| colour gate: dull green or grey water | 114 | 82 |
| colour gate: turquoise-green water (green above blue) | 37 | 49 |
| colour gate: pale water (low saturation) | 39 | 14 |
| colour gate: dark water | 1 | 49 |
| size/shape filter or merger | 12 | 33 |
| colour gate: deep blue water (hue above the band) | 7 | 4 |
| texture ceiling | 7 | 3 |
| texture ceiling (and low confidence) | 3 | 3 |
| mask cleanup (pixels pass, shape lost) | 2 | 2 |
