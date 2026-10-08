# Benchmark: v1 @ 0.55, --source auto

- detector: `v1` (packages/core detectTile + DetectionMerger as shipped (merger minimum 8 m²)), hash `6b4dd8d725d0`
- confidence threshold: 0.55
- imagery: `--source auto` (per zone below), z19 grid; 4273 images read, manifest `d87f078bf11f`
- labels: frozen set `4e6b1173fe37`, see `packages/eval/README.md`; point rule v2
- commit: 7ad4b59, run 2026-10-08

A detection hits a polygon label when its centre falls inside it or the two boxes overlap with IoU >= 0.3. It hits a point label when its centre is within max(3 m, half the long side of its box) of the point and its area is at most max(4 x the median pool label of the zone, 150 m²). Each label is matched once. Precision is over detections, recall over labels. Brackets: 95% interval, block bootstrap (4 x 4 z19 tiles, 2000 replicates, seed 20261007). Area error compares the detected area with the OSM polygon, over hits on OSM polygons only; "signed" below zero means the detector under-measures. Time is detector CPU time per km², tiles already decoded.

## DEV

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Vilamoura, PT (1.00 km²) | 68 | 80 | 31 | 49 | 37 | 38.8% | 45.6% | 41.9% | dgt-ortos2025 | 18.6% (n=30) | -16.0% | 533 |
| Scottsdale, AZ, US (0.56 km²) | 78 | 63 | 53 | 10 | 25 | 84.1% | 67.9% | 75.2% | esri-world-imagery | 30.2% (n=2) | +24.0% | 484 |
| Odemira greenhouses, Alentejo, PT (1.00 km²) | 0 | 128 | 0 | 128 | 0 | 0.0% | n/a | n/a | dgt-ortos2025 | n/a (n=0) | n/a | 546 |
| Puyricard, Aix-en-Provence, FR (1.00 km²) | 79 | 336 | 47 | 289 | 32 | 14.0% | 59.5% | 22.7% | ign-orthophotos | 43.0% (n=29) | -34.1% | 959 |
| Balma, Toulouse, FR (1.00 km²) | 61 | 28 | 20 | 8 | 41 | 71.4% | 32.8% | 44.9% | ign-orthophotos | 34.3% (n=15) | -33.1% | 597 |
| Braga, PT (1.00 km²) | 166 | 501 | 79 | 422 | 87 | 15.8% | 47.6% | 23.7% | dgt-ortos2025 | 19.2% (n=47) | -6.1% | 1169 |
| **all DEV** | 452 | 1136 | 230 | 906 | 222 | 20.2% | 50.9% | 29.0% |  | 23.3% (n=123) | -17.0% | 732 |

Precision 20.2% [16.3, 25.0], recall 50.9% [45.4, 56.9], F1 29.0% [24.4, 34.0]. Errors (FP + FN) 1128 [956, 1306.0249999999999]. FP per km² 162.9. Macro F1 41.7%.

Median area error 23.3% [21.0, 33.0], signed -17.0% [-22.6, -11.1] (n=123). Centre offset median 0.66 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 12.2% and 14.3% (n=123).

## DEV-2

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Marbella, ES (1.00 km²) | 151 | 133 | 97 | 37 | 54 | 72.2% | 64.2% | 68.0% | pnoa | 37.3% (n=14) | -37.3% | 595 |
| Birre, Cascais, PT (0.56 km²) | 149 | 472 | 113 | 359 | 36 | 23.9% | 75.8% | 36.4% | dgt-ortos2025 | 12.3% (n=4) | -3.7% | 1189 |
| Santa Barbara de Nexe, Algarve interior, PT (1.00 km²) | 52 | 62 | 28 | 34 | 24 | 45.2% | 53.8% | 49.1% | dgt-ortos2025 | 11.7% (n=5) | +2.5% | 410 |
| Castelnau-le-Lez, Montpellier, FR (1.00 km²) | 226 | 351 | 108 | 243 | 118 | 30.8% | 47.8% | 37.4% | ign-orthophotos | 24.5% (n=108) | -21.1% | 822 |
| Arcadia, Phoenix, AZ, US (1.00 km²) | 182 | 143 | 122 | 22 | 60 | 84.6% | 67.0% | 74.8% | esri-world-imagery | 60.5% (n=3) | -60.5% | 464 |
| **all DEV-2** | 760 | 1161 | 468 | 695 | 292 | 40.1% | 61.6% | 48.6% |  | 26.3% (n=134) | -22.0% | 652 |

Precision 40.1% [35.7, 45.7], recall 61.6% [58.0, 65.1], F1 48.6% [45.0, 52.7]. Errors (FP + FN) 987 [826, 1171.0249999999999]. FP per km² 152.3. Macro F1 53.1%.

Median area error 26.3% [20.4, 30.3], signed -22.0% [-26.8, -16.9] (n=134). Centre offset median 1.05 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 12.7% and 15.9% (n=134).

## GOLD

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Mougins, FR (gold) (0.20 km²) | 57 | 43 | 41 | 2 | 16 | 95.3% | 71.9% | 82.0% | ign-orthophotos | n/a (n=0) | n/a | 634 |
| Grabels, FR (gold) (0.19 km²) | 95 | 50 | 23 | 27 | 72 | 46.0% | 24.2% | 31.7% | ign-orthophotos | n/a (n=0) | n/a | 781 |
| Pozuelo de Alarcon, ES (gold) (0.21 km²) | 162 | 117 | 113 | 4 | 49 | 96.6% | 69.8% | 81.0% | pnoa | n/a (n=0) | n/a | 776 |
| Mougins, FR (gold, Esri) (0.20 km²) | 35 | 19 | 19 | 0 | 16 | 100.0% | 54.3% | 70.4% | esri-world-imagery | n/a (n=0) | n/a | 589 |
| Pozuelo de Alarcon, ES (gold, Esri) (0.21 km²) | 129 | 59 | 57 | 2 | 72 | 96.6% | 44.2% | 60.6% | esri-world-imagery | n/a (n=0) | n/a | 640 |
| **all GOLD** | 478 | 288 | 253 | 35 | 225 | 87.8% | 52.9% | 66.1% |  | n/a (n=0) | n/a | 685 |

Precision 87.8% [82.9, 91.9], recall 52.9% [46.6, 58.8], F1 66.1% [60.0, 71.2]. Errors (FP + FN) 260 [192, 340]. FP per km² 34.5. Macro F1 65.1%.

Median area error n/a, signed n/a (n=0). Centre offset median 0.29 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): n/a and n/a (n=0).

## Threshold sweep (micro-averaged)

| threshold | DEV P | DEV R | DEV F1 | DEV-2 P | DEV-2 R | DEV-2 F1 | GOLD P | GOLD R | GOLD F1 |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 0.30 | 18.6% | 65.7% | 29.0% | 36.3% | 70.7% | 47.9% | 81.1% | 66.3% | 73.0% |
| 0.35 | 18.6% | 65.5% | 29.0% | 36.3% | 70.5% | 48.0% | 81.0% | 65.9% | 72.7% |
| 0.40 | 18.6% | 65.3% | 28.9% | 36.6% | 70.3% | 48.2% | 80.7% | 64.9% | 71.9% |
| 0.45 | 18.6% | 64.2% | 28.8% | 37.2% | 69.5% | 48.5% | 81.4% | 63.2% | 71.1% |
| 0.50 | 18.7% | 59.1% | 28.4% | 38.5% | 67.2% | 49.0% | 83.1% | 58.8% | 68.9% |
| 0.55 | 20.2% | 50.9% | 29.0% | 40.1% | 61.6% | 48.6% | 87.8% | 52.9% | 66.1% |
| 0.60 | 21.7% | 41.6% | 28.5% | 43.4% | 53.2% | 47.8% | 94.0% | 46.0% | 61.8% |
| 0.65 | 23.9% | 35.8% | 28.7% | 49.3% | 46.4% | 47.8% | 94.8% | 37.9% | 54.1% |
| 0.70 | 24.8% | 28.3% | 26.4% | 55.1% | 35.5% | 43.2% | 96.0% | 25.1% | 39.8% |
| 0.75 | 23.4% | 18.8% | 20.8% | 58.4% | 23.0% | 33.0% | 95.4% | 13.0% | 22.8% |
| 0.80 | 22.3% | 10.8% | 14.6% | 57.9% | 11.1% | 18.6% | 93.3% | 2.9% | 5.7% |

## Labels per area

Review "full": every window checked by eye and missed pools boxed by hand. "candidates": every unlabelled colour candidate checked plus a sample of windows, so recall there is an upper bound. "blind": every window checked on clean imagery with nothing drawn, OSM merged afterwards. "gold-union": phase 0 gold, the union of what the methods proposed, checked by eye. "absent" are labels whose pool is not in this source's imagery, ignored here.

| area | role | review | pool labels | points | hand-added | ignored | absent | tiles |
|---|---|---|--:|--:|--:|--:|--:|--:|
| Vilamoura, PT | DEV | full | 68 | 0 | 3 | 20 | 1 | 342 |
| Scottsdale, AZ, US | DEV | full | 78 | 3 | 72 | 14 | 0 | 196 |
| Odemira greenhouses, Alentejo, PT | DEV | full | 0 | 0 | 0 | 0 | 0 | 342 |
| Puyricard, Aix-en-Provence, FR | DEV | full | 79 | 0 | 31 | 45 | 21 | 420 |
| Balma, Toulouse, FR | DEV | full | 61 | 0 | 16 | 51 | 5 | 441 |
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
| Vilamoura, PT | 48 | 1 | 16 | 4 | 17 |
| Scottsdale, AZ, US | 10 | 0 | 1 | 1 | 23 |
| Odemira greenhouses, Alentejo, PT | 128 | 0 | 0 | 0 | 0 |
| Puyricard, Aix-en-Provence, FR | 288 | 1 | 7 | 1 | 24 |
| Balma, Toulouse, FR | 7 | 1 | 16 | 0 | 25 |
| Braga, PT | 422 | 0 | 30 | 3 | 54 |
| Marbella, ES | 36 | 1 | 20 | 9 | 25 |
| Birre, Cascais, PT | 359 | 0 | 10 | 10 | 16 |
| Santa Barbara de Nexe, Algarve interior, PT | 33 | 1 | 4 | 3 | 17 |
| Castelnau-le-Lez, Montpellier, FR | 242 | 1 | 28 | 6 | 84 |
| Arcadia, Phoenix, AZ, US | 22 | 0 | 8 | 3 | 49 |
| Mougins, FR (gold) | 2 | 0 | 5 | 5 | 6 |
| Grabels, FR (gold) | 27 | 0 | 13 | 3 | 56 |
| Pozuelo de Alarcon, ES (gold) | 4 | 0 | 15 | 3 | 31 |
| Mougins, FR (gold, Esri) | 0 | 0 | 5 | 0 | 11 |
| Pozuelo de Alarcon, ES (gold, Esri) | 2 | 0 | 28 | 8 | 36 |

## Where undetected pools were lost (core pipeline)

For every missed label with no detection on it, the first pipeline stage that drops it: rerun with that stage relaxed, see whether the pool appears.

| stage | DEV | DEV-2 | GOLD |
|---|--:|--:|--:|
| colour gate: pale water (low saturation) | 66 | 65 | 64 |
| colour gate: dull green or grey water | 26 | 66 | 3 |
| texture ceiling (and low confidence) | 20 | 11 | 20 |
| colour gate: turquoise-green water (green above blue) | 9 | 24 | 10 |
| texture ceiling | 5 | 6 | 15 |
| colour gate: dark water | 2 | 10 | 10 |
| colour gate: deep blue water (hue above the band) | 10 | 6 | 2 |
| size/shape filter or merger | 3 | 0 | 11 |
| mask cleanup (pixels pass, shape lost) | 2 | 3 | 2 |
| colour gate: no pixels | 0 | 0 | 3 |
