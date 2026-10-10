# Benchmark: v1 @ 0.55, --source auto

- detector: `v1` (packages/core detectTile + DetectionMerger as shipped (merger minimum 8 m²)), hash `62ba002bff61`
- confidence threshold: 0.55
- imagery: `--source auto` (per zone below), z19 grid; 3775 images read, manifest `d24fbf8eb826`
- labels: frozen set `e9baa3437866`, see `packages/eval/README.md`; point rule v2
- commit: c5d7966, run 2026-10-10

A detection hits a polygon label when its centre falls inside it or the two boxes overlap with IoU >= 0.3. It hits a point label when its centre is within max(3 m, half the long side of its box) of the point and its area is at most max(4 x the median pool label of the zone, 150 m²). Each label is matched once. Precision is over detections, recall over labels. Brackets: 95% interval, block bootstrap (4 x 4 z19 tiles, 2000 replicates, seed 20261007). Area error compares the detected area with the OSM polygon, over hits on OSM polygons only; "signed" below zero means the detector under-measures. Time is detector CPU time per km², tiles already decoded.

## DEV

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Vilamoura, PT (1.00 km²) | 68 | 80 | 31 | 49 | 37 | 38.8% | 45.6% | 41.9% | dgt-ortos2025 | 18.6% (n=30) | -16.0% | 1105 |
| Scottsdale, AZ, US (0.56 km²) | 78 | 63 | 53 | 10 | 25 | 84.1% | 67.9% | 75.2% | esri-world-imagery | 30.2% (n=2) | +24.0% | 736 |
| Odemira greenhouses, Alentejo, PT (1.00 km²) | 0 | 128 | 0 | 128 | 0 | 0.0% | n/a | n/a | dgt-ortos2025 | n/a (n=0) | n/a | 959 |
| Puyricard, Aix-en-Provence, FR (1.00 km²) | 79 | 336 | 47 | 289 | 32 | 14.0% | 59.5% | 22.7% | ign-orthophotos | 43.0% (n=29) | -34.1% | 1352 |
| Balma, Toulouse, FR (1.00 km²) | 98 | 28 | 25 | 3 | 73 | 89.3% | 25.5% | 39.7% | ign-orthophotos | 34.3% (n=15) | -33.1% | 915 |
| Braga, PT (1.00 km²) | 166 | 501 | 79 | 422 | 87 | 15.8% | 47.6% | 23.7% | dgt-ortos2025 | 19.2% (n=47) | -6.1% | 1513 |
| **all DEV** | 489 | 1136 | 235 | 901 | 254 | 20.7% | 48.1% | 28.9% |  | 23.3% (n=123) | -17.0% | 1123 |

Precision 20.7% [16.7, 25.2], recall 48.1% [42.5, 53.9], F1 28.9% [24.6, 33.8]. Errors (FP + FN) 1155 [990, 1333]. FP per km² 162.0. Macro F1 40.6%.

Median area error 23.3% [20.4, 33.0], signed -17.0% [-22.6, -10.7] (n=123). Centre offset median 0.62 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 12.2% and 14.3% (n=123).

## DEV-2

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Marbella, ES (1.00 km²) | 151 | 133 | 97 | 37 | 54 | 72.2% | 64.2% | 68.0% | pnoa | 37.3% (n=14) | -37.3% | 876 |
| Birre, Cascais, PT (0.56 km²) | 149 | 472 | 113 | 359 | 36 | 23.9% | 75.8% | 36.4% | dgt-ortos2025 | 12.3% (n=4) | -3.7% | 1792 |
| Santa Barbara de Nexe, Algarve interior, PT (1.00 km²) | 52 | 62 | 28 | 34 | 24 | 45.2% | 53.8% | 49.1% | dgt-ortos2025 | 11.7% (n=5) | +2.5% | 984 |
| Castelnau-le-Lez, Montpellier, FR (1.00 km²) | 226 | 351 | 108 | 243 | 118 | 30.8% | 47.8% | 37.4% | ign-orthophotos | 24.5% (n=108) | -21.1% | 1478 |
| Arcadia, Phoenix, AZ, US (1.00 km²) | 182 | 143 | 122 | 22 | 60 | 84.6% | 67.0% | 74.8% | esri-world-imagery | 60.5% (n=3) | -60.5% | 794 |
| **all DEV-2** | 760 | 1161 | 468 | 695 | 292 | 40.1% | 61.6% | 48.6% |  | 26.3% (n=134) | -22.0% | 1131 |

Precision 40.1% [35.7, 45.7], recall 61.6% [58.0, 65.1], F1 48.6% [45.0, 52.7]. Errors (FP + FN) 987 [826, 1171.0249999999999]. FP per km² 152.3. Macro F1 53.1%.

Median area error 26.3% [20.4, 30.3], signed -22.0% [-26.8, -16.9] (n=134). Centre offset median 1.05 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 12.7% and 15.9% (n=134).

## Threshold sweep (micro-averaged)

| threshold | DEV P | DEV R | DEV F1 | DEV-2 P | DEV-2 R | DEV-2 F1 |
|--:|--:|--:|--:|--:|--:|--:|
| 0.30 | 19.4% | 63.2% | 29.7% | 36.3% | 70.7% | 47.9% |
| 0.35 | 19.4% | 63.0% | 29.6% | 36.3% | 70.5% | 48.0% |
| 0.40 | 19.4% | 62.8% | 29.6% | 36.6% | 70.3% | 48.2% |
| 0.45 | 19.2% | 61.1% | 29.2% | 37.2% | 69.5% | 48.5% |
| 0.50 | 19.1% | 55.8% | 28.5% | 38.5% | 67.2% | 49.0% |
| 0.55 | 20.7% | 48.1% | 28.9% | 40.1% | 61.6% | 48.6% |
| 0.60 | 22.1% | 39.3% | 28.3% | 43.4% | 53.2% | 47.8% |
| 0.65 | 24.3% | 33.7% | 28.3% | 49.3% | 46.4% | 47.8% |
| 0.70 | 25.0% | 26.4% | 25.6% | 55.1% | 35.5% | 43.2% |
| 0.75 | 23.4% | 17.4% | 19.9% | 58.4% | 23.0% | 33.0% |
| 0.80 | 22.3% | 10.0% | 13.8% | 57.9% | 11.1% | 18.6% |

## Labels per area

Review "full": every window checked by eye and missed pools boxed by hand. "candidates": every unlabelled colour candidate checked plus a sample of windows, so recall there is an upper bound. "blind": every window checked on clean imagery with nothing drawn, OSM merged afterwards. "gold-union": phase 0 gold, the union of what the methods proposed, checked by eye. "absent" are labels whose pool is not in this source's imagery, ignored here.

| area | role | review | pool labels | points | hand-added | ignored | absent | tiles |
|---|---|---|--:|--:|--:|--:|--:|--:|
| Vilamoura, PT | DEV | full | 68 | 0 | 3 | 20 | 1 | 342 |
| Scottsdale, AZ, US | DEV | full | 78 | 3 | 72 | 14 | 0 | 196 |
| Odemira greenhouses, Alentejo, PT | DEV | full | 0 | 0 | 0 | 0 | 0 | 342 |
| Puyricard, Aix-en-Provence, FR | DEV | full | 79 | 0 | 31 | 45 | 21 | 420 |
| Balma, Toulouse, FR | DEV | full | 98 | 0 | 53 | 132 | 5 | 441 |
| Braga, PT | DEV | blind | 166 | 0 | 91 | 45 | 0 | 400 |
| Marbella, ES | DEV-2 | candidates | 151 | 105 | 26 | 37 | 0 | 361 |
| Birre, Cascais, PT | DEV-2 | full | 149 | 0 | 141 | 35 | 0 | 225 |
| Santa Barbara de Nexe, Algarve interior, PT | DEV-2 | full | 52 | 0 | 44 | 27 | 0 | 324 |
| Castelnau-le-Lez, Montpellier, FR | DEV-2 | candidates | 226 | 0 | 6 | 91 | 0 | 400 |
| Arcadia, Phoenix, AZ, US | DEV-2 | candidates | 182 | 162 | 14 | 43 | 0 | 324 |

## Errors, automatic split

| area | FP unlabelled | FP duplicate | FN below threshold | FN partial overlap | FN not detected |
|---|--:|--:|--:|--:|--:|
| Vilamoura, PT | 48 | 1 | 16 | 4 | 17 |
| Scottsdale, AZ, US | 10 | 0 | 1 | 1 | 23 |
| Odemira greenhouses, Alentejo, PT | 128 | 0 | 0 | 0 | 0 |
| Puyricard, Aix-en-Provence, FR | 288 | 1 | 7 | 1 | 24 |
| Balma, Toulouse, FR | 2 | 1 | 23 | 0 | 50 |
| Braga, PT | 422 | 0 | 30 | 3 | 54 |
| Marbella, ES | 36 | 1 | 20 | 9 | 25 |
| Birre, Cascais, PT | 359 | 0 | 10 | 10 | 16 |
| Santa Barbara de Nexe, Algarve interior, PT | 33 | 1 | 4 | 3 | 17 |
| Castelnau-le-Lez, Montpellier, FR | 242 | 1 | 28 | 6 | 84 |
| Arcadia, Phoenix, AZ, US | 22 | 0 | 8 | 3 | 49 |

## Where undetected pools were lost (core pipeline)

For every missed label with no detection on it, the first pipeline stage that drops it: rerun with that stage relaxed, see whether the pool appears.

| stage | DEV | DEV-2 |
|---|--:|--:|
| colour gate: pale water (low saturation) | 82 | 65 |
| colour gate: dull green or grey water | 29 | 66 |
| texture ceiling (and low confidence) | 24 | 11 |
| colour gate: turquoise-green water (green above blue) | 9 | 24 |
| colour gate: deep blue water (hue above the band) | 10 | 6 |
| texture ceiling | 6 | 6 |
| colour gate: dark water | 2 | 10 |
| mask cleanup (pixels pass, shape lost) | 2 | 3 |
| size/shape filter or merger | 4 | 0 |
