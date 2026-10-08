# Benchmark: v1 @ 0.55, --source auto

- detector: `v1` (packages/core detectTile + DetectionMerger, default options), hash `57d77e98b36c`
- confidence threshold: 0.55
- imagery: `--source auto` (per zone below), z19 grid; 4273 images read, manifest `d87f078bf11f`
- labels: frozen set `44295f4fd0b1`, see `packages/eval/README.md`; point rule v2
- commit: 69574c2, run 2026-10-08

A detection hits a polygon label when its centre falls inside it or the two boxes overlap with IoU >= 0.3. It hits a point label when its centre is within max(3 m, half the long side of its box) of the point and its area is at most max(4 x the median pool label of the zone, 150 m²). Each label is matched once. Precision is over detections, recall over labels. Brackets: 95% interval, block bootstrap (4 x 4 z19 tiles, 2000 replicates, seed 20261007). Area error compares the detected area with the OSM polygon, over hits on OSM polygons only; "signed" below zero means the detector under-measures. Time is detector CPU time per km², tiles already decoded.

## DEV

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Vilamoura, PT (1.00 km²) | 69 | 84 | 31 | 53 | 38 | 36.9% | 44.9% | 40.5% | dgt-ortos2025 | 20.0% (n=30) | -17.2% | 854 |
| Scottsdale, AZ, US (0.56 km²) | 78 | 63 | 54 | 9 | 24 | 85.7% | 69.2% | 76.6% | esri-world-imagery | 30.6% (n=2) | +22.7% | 543 |
| Odemira greenhouses, Alentejo, PT (1.00 km²) | 0 | 140 | 0 | 140 | 0 | 0.0% | n/a | n/a | dgt-ortos2025 | n/a (n=0) | n/a | 637 |
| Puyricard, Aix-en-Provence, FR (1.00 km²) | 100 | 327 | 47 | 280 | 53 | 14.4% | 47.0% | 22.0% | ign-orthophotos | 43.8% (n=29) | -34.8% | 1081 |
| Balma, Toulouse, FR (1.00 km²) | 66 | 27 | 20 | 7 | 46 | 74.1% | 30.3% | 43.0% | ign-orthophotos | 31.4% (n=15) | -31.4% | 674 |
| Braga, PT (1.00 km²) | 166 | 516 | 81 | 435 | 85 | 15.7% | 48.8% | 23.8% | dgt-ortos2025 | 18.7% (n=49) | -8.1% | 1310 |
| **all DEV** | 479 | 1157 | 233 | 924 | 246 | 20.1% | 48.6% | 28.5% |  | 23.8% (n=125) | -18.1% | 872 |

Precision 20.1% [16.1, 25.0], recall 48.6% [43.5, 54.2], F1 28.5% [24.0, 33.6]. Errors (FP + FN) 1170 [988, 1367]. FP per km² 166.1. Macro F1 41.2%.

Median area error 23.8% [20.0, 29.9], signed -18.1% [-23.8, -13.4] (n=125). Centre offset median 0.65 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 11.9% and 15.2% (n=125).

## DEV-2

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Marbella, ES (1.00 km²) | 151 | 136 | 99 | 38 | 52 | 72.1% | 65.6% | 68.7% | pnoa | 41.3% (n=15) | -41.3% | 736 |
| Birre, Cascais, PT (0.56 km²) | 149 | 498 | 114 | 384 | 35 | 22.9% | 76.5% | 35.2% | dgt-ortos2025 | 12.8% (n=4) | -4.8% | 1411 |
| Santa Barbara de Nexe, Algarve interior, PT (1.00 km²) | 52 | 74 | 27 | 47 | 25 | 36.5% | 51.9% | 42.9% | dgt-ortos2025 | 15.5% (n=5) | +2.5% | 491 |
| Castelnau-le-Lez, Montpellier, FR (1.00 km²) | 226 | 340 | 114 | 227 | 112 | 33.2% | 50.4% | 40.1% | ign-orthophotos | 27.1% (n=114) | -23.9% | 865 |
| Arcadia, Phoenix, AZ, US (1.00 km²) | 182 | 142 | 124 | 19 | 58 | 86.6% | 68.1% | 76.3% | esri-world-imagery | 61.4% (n=3) | -61.4% | 455 |
| **all DEV-2** | 760 | 1190 | 478 | 715 | 282 | 39.9% | 62.9% | 48.8% |  | 27.9% (n=141) | -24.9% | 736 |

Precision 39.9% [35.5, 45.3], recall 62.9% [59.3, 66.4], F1 48.8% [45.3, 52.8]. Errors (FP + FN) 997 [834.975, 1182]. FP per km² 156.7. Macro F1 52.6%.

Median area error 27.9% [23.4, 32.2], signed -24.9% [-28.4, -20.8] (n=141). Centre offset median 1.01 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 13.0% and 15.5% (n=141).

## GOLD

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Mougins, FR (gold) (0.20 km²) | 57 | 44 | 42 | 2 | 15 | 95.5% | 73.7% | 83.2% | ign-orthophotos | n/a (n=0) | n/a | 759 |
| Grabels, FR (gold) (0.19 km²) | 95 | 49 | 21 | 28 | 74 | 42.9% | 22.1% | 29.2% | ign-orthophotos | n/a (n=0) | n/a | 867 |
| Pozuelo de Alarcon, ES (gold) (0.21 km²) | 162 | 114 | 111 | 3 | 51 | 97.4% | 68.5% | 80.4% | pnoa | n/a (n=0) | n/a | 779 |
| Mougins, FR (gold, Esri) (0.20 km²) | 35 | 19 | 19 | 0 | 16 | 100.0% | 54.3% | 70.4% | esri-world-imagery | n/a (n=0) | n/a | 573 |
| Pozuelo de Alarcon, ES (gold, Esri) (0.21 km²) | 129 | 62 | 60 | 2 | 69 | 96.8% | 46.5% | 62.8% | esri-world-imagery | n/a (n=0) | n/a | 706 |
| **all GOLD** | 478 | 288 | 253 | 35 | 225 | 87.8% | 52.9% | 66.1% |  | n/a (n=0) | n/a | 737 |

Precision 87.8% [82.6, 92.1], recall 52.9% [46.5, 58.4], F1 66.1% [60.0, 71.0]. Errors (FP + FN) 260 [196.975, 333.02499999999986]. FP per km² 34.5. Macro F1 65.2%.

Median area error n/a, signed n/a (n=0). Centre offset median 0.30 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): n/a and n/a (n=0).

## Threshold sweep (micro-averaged)

| threshold | DEV P | DEV R | DEV F1 | DEV-2 P | DEV-2 R | DEV-2 F1 | GOLD P | GOLD R | GOLD F1 |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 0.30 | 18.8% | 61.6% | 28.8% | 36.6% | 70.3% | 48.1% | 82.3% | 66.1% | 73.3% |
| 0.35 | 18.8% | 61.4% | 28.8% | 36.7% | 70.3% | 48.2% | 82.2% | 65.7% | 73.0% |
| 0.40 | 18.7% | 61.0% | 28.6% | 36.7% | 69.9% | 48.1% | 82.3% | 65.1% | 72.7% |
| 0.45 | 18.8% | 60.1% | 28.6% | 37.3% | 69.2% | 48.4% | 82.7% | 63.0% | 71.5% |
| 0.50 | 19.5% | 57.2% | 29.0% | 38.3% | 67.8% | 49.0% | 84.4% | 59.0% | 69.5% |
| 0.55 | 20.1% | 48.6% | 28.5% | 39.9% | 62.9% | 48.8% | 87.8% | 52.9% | 66.1% |
| 0.60 | 21.7% | 40.5% | 28.2% | 42.8% | 55.0% | 48.2% | 93.2% | 46.2% | 61.8% |
| 0.65 | 23.3% | 35.1% | 28.0% | 46.9% | 47.5% | 47.2% | 93.6% | 39.5% | 55.6% |
| 0.70 | 23.4% | 26.9% | 25.0% | 52.9% | 36.6% | 43.2% | 95.5% | 26.6% | 41.6% |
| 0.75 | 23.2% | 18.8% | 20.8% | 55.2% | 24.6% | 34.0% | 96.9% | 13.2% | 23.2% |
| 0.80 | 20.7% | 9.8% | 13.3% | 53.1% | 11.2% | 18.5% | 95.2% | 4.2% | 8.0% |

## Labels per area

Review "full": every window checked by eye and missed pools boxed by hand. "candidates": every unlabelled colour candidate checked plus a sample of windows, so recall there is an upper bound. "blind": every window checked on clean imagery with nothing drawn, OSM merged afterwards. "gold-union": phase 0 gold, the union of what the methods proposed, checked by eye. "absent" are labels whose pool is not in this source's imagery, ignored here.

| area | role | review | pool labels | points | hand-added | ignored | absent | tiles |
|---|---|---|--:|--:|--:|--:|--:|--:|
| Vilamoura, PT | DEV | full | 69 | 0 | 3 | 19 | 0 | 342 |
| Scottsdale, AZ, US | DEV | full | 78 | 3 | 72 | 14 | 0 | 196 |
| Odemira greenhouses, Alentejo, PT | DEV | full | 0 | 0 | 0 | 0 | 0 | 342 |
| Puyricard, Aix-en-Provence, FR | DEV | full | 100 | 0 | 38 | 24 | 0 | 420 |
| Balma, Toulouse, FR | DEV | full | 66 | 0 | 17 | 46 | 0 | 441 |
| Braga, PT | DEV | blind | 166 | 0 | 91 | 45 | 0 | 400 |
| Marbella, ES | DEV-2 | candidates | 151 | 105 | 26 | 37 | 0 | 361 |
| Birre, Cascais, PT | DEV-2 | full | 149 | 0 | 141 | 35 | 0 | 225 |
| Santa Barbara de Nexe, Algarve interior, PT | DEV-2 | full | 52 | 0 | 44 | 27 | 0 | 324 |
| Castelnau-le-Lez, Montpellier, FR | DEV-2 | candidates | 226 | 0 | 6 | 91 | 0 | 400 |
| Arcadia, Phoenix, AZ, US | DEV-2 | candidates | 182 | 162 | 14 | 43 | 0 | 324 |
| Mougins, FR (gold) | GOLD | gold-union | 57 | 0 | 57 | 13 | 0 | 100 |
| Grabels, FR (gold) | GOLD | gold-union | 95 | 0 | 95 | 26 | 0 | 100 (2 without imagery) |
| Pozuelo de Alarcon, ES (gold) | GOLD | gold-union | 162 | 0 | 162 | 37 | 0 | 100 |
| Mougins, FR (gold, Esri) | GOLD | gold-union | 35 | 0 | 35 | 6 | 0 | 100 |
| Pozuelo de Alarcon, ES (gold, Esri) | GOLD | gold-union | 129 | 0 | 129 | 39 | 0 | 100 |

## Errors, automatic split

| area | FP unlabelled | FP duplicate | FN below threshold | FN partial overlap | FN not detected |
|---|--:|--:|--:|--:|--:|
| Vilamoura, PT | 52 | 1 | 15 | 4 | 19 |
| Scottsdale, AZ, US | 9 | 0 | 0 | 1 | 23 |
| Odemira greenhouses, Alentejo, PT | 140 | 0 | 0 | 0 | 0 |
| Puyricard, Aix-en-Provence, FR | 279 | 1 | 7 | 0 | 46 |
| Balma, Toulouse, FR | 6 | 1 | 13 | 0 | 33 |
| Braga, PT | 435 | 0 | 28 | 3 | 54 |
| Marbella, ES | 37 | 1 | 17 | 10 | 25 |
| Birre, Cascais, PT | 384 | 0 | 8 | 11 | 16 |
| Santa Barbara de Nexe, Algarve interior, PT | 46 | 1 | 4 | 3 | 18 |
| Castelnau-le-Lez, Montpellier, FR | 226 | 1 | 22 | 4 | 86 |
| Arcadia, Phoenix, AZ, US | 19 | 0 | 7 | 2 | 49 |
| Mougins, FR (gold) | 2 | 0 | 4 | 5 | 6 |
| Grabels, FR (gold) | 28 | 0 | 15 | 1 | 58 |
| Pozuelo de Alarcon, ES (gold) | 3 | 0 | 17 | 2 | 32 |
| Mougins, FR (gold, Esri) | 0 | 0 | 5 | 0 | 11 |
| Pozuelo de Alarcon, ES (gold, Esri) | 2 | 0 | 26 | 8 | 35 |

## Where undetected pools were lost (core pipeline)

For every missed label with no detection on it, the first pipeline stage that drops it: rerun with that stage relaxed, see whether the pool appears.

| stage | DEV | DEV-2 | GOLD |
|---|--:|--:|--:|
| colour gate: pale water (low saturation) | 81 | 68 | 63 |
| colour gate: dull green or grey water | 39 | 68 | 3 |
| size/shape filter or merger | 27 | 13 | 43 |
| colour gate: turquoise-green water (green above blue) | 8 | 25 | 10 |
| colour gate: dark water | 2 | 10 | 9 |
| colour gate: deep blue water (hue above the band) | 12 | 5 | 2 |
| texture ceiling | 2 | 1 | 6 |
| mask cleanup (pixels pass, shape lost) | 3 | 3 | 0 |
| texture ceiling (and low confidence) | 1 | 1 | 3 |
| colour gate: no pixels | 0 | 0 | 3 |
