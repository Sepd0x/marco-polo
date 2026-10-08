# Benchmark: v2 at the calibrated threshold of each source, --source auto (DEV calibrated out of fold)

- detector: `v2` (packages/core detectWindow + DetectionMerger, model packages/core/models/pool-v2.json (sha256 1545046ee40f)), hash `6b4dd8d725d0`
- confidence threshold: the calibrated threshold of each source (per zone below)
- imagery: `--source auto` (per zone below), z19 grid; 3799 images read, manifest `e0af3b7efec7`
- labels: frozen set `4e6b1173fe37`, see `packages/eval/README.md`; point rule v2
- commit: 7ad4b59, run 2026-10-08

A detection hits a polygon label when its centre falls inside it or the two boxes overlap with IoU >= 0.3. It hits a point label when its centre is within max(3 m, half the long side of its box) of the point and its area is at most max(4 x the median pool label of the zone, 150 m²). Each label is matched once. Precision is over detections, recall over labels. Brackets: 95% interval, block bootstrap (4 x 4 z19 tiles, 2000 replicates, seed 20261007). Area error compares the detected area with the OSM polygon, over hits on OSM polygons only; "signed" below zero means the detector under-measures. Time is detector CPU time per km², tiles already decoded.

## DEV

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Vilamoura, PT (1.00 km²) | 68 | 67 | 54 | 13 | 14 | 80.6% | 79.4% | 80.0% | dgt-ortos2025 | 21.2% (n=51) | -16.3% | 5071 |
| Scottsdale, AZ, US (0.56 km²) | 78 | 52 | 46 | 6 | 32 | 88.5% | 59.0% | 70.8% | esri-world-imagery | 16.4% (n=1) | -16.4% | 5697 |
| Odemira greenhouses, Alentejo, PT (1.00 km²) | 0 | 0 | 0 | 0 | 0 | n/a | n/a | n/a | dgt-ortos2025 | n/a (n=0) | n/a | 5377 |
| Puyricard, Aix-en-Provence, FR (1.00 km²) | 79 | 45 | 42 | 4 | 37 | 91.1% | 53.2% | 67.1% | ign-orthophotos | 26.5% (n=25) | -17.6% | 10179 |
| Balma, Toulouse, FR (1.00 km²) | 61 | 143 | 52 | 91 | 9 | 36.4% | 85.2% | 51.0% | ign-orthophotos | 43.7% (n=38) | -23.1% | 9292 |
| Braga, PT (1.00 km²) | 166 | 162 | 146 | 16 | 20 | 90.1% | 88.0% | 89.0% | dgt-ortos2025 | 18.4% (n=70) | +0.1% | 9693 |
| **all DEV** | 452 | 469 | 340 | 130 | 112 | 72.3% | 75.2% | 73.7% |  | 23.0% (n=185) | -10.0% | 7687 |

Precision 72.3% [65.9, 78.0], recall 75.2% [71.1, 79.5], F1 73.7% [69.3, 78.0]. Errors (FP + FN) 242 [197, 290]. FP per km² 23.4. Macro F1 71.6%.

Median area error 23.0% [17.5, 30.3], signed -10.0% [-16.9, -5.8] (n=185). Centre offset median 0.67 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 12.5% and 16.6% (n=179).

## DEV-2

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Marbella, ES (1.00 km²) | 151 | 232 | 133 | 100 | 18 | 56.9% | 88.1% | 69.1% | pnoa | 38.3% (n=19) | -38.3% | 7166 |
| Birre, Cascais, PT (0.56 km²) | 149 | 163 | 134 | 29 | 15 | 82.2% | 89.9% | 85.9% | dgt-ortos2025 | 24.6% (n=6) | +8.6% | 8919 |
| Santa Barbara de Nexe, Algarve interior, PT (1.00 km²) | 52 | 83 | 36 | 47 | 16 | 43.4% | 69.2% | 53.3% | dgt-ortos2025 | 13.3% (n=7) | +6.9% | 5152 |
| Castelnau-le-Lez, Montpellier, FR (1.00 km²) | 226 | 227 | 157 | 71 | 69 | 68.7% | 69.5% | 69.1% | ign-orthophotos | 29.3% (n=155) | -24.5% | 10189 |
| Arcadia, Phoenix, AZ, US (1.00 km²) | 182 | 159 | 144 | 16 | 38 | 89.9% | 79.1% | 84.2% | esri-world-imagery | 29.6% (n=4) | -29.6% | 6597 |
| **all DEV-2** | 760 | 864 | 604 | 263 | 156 | 69.6% | 79.5% | 74.2% |  | 29.9% (n=191) | -23.4% | 7488 |

Precision 69.6% [64.5, 74.5], recall 79.5% [75.8, 82.7], F1 74.2% [70.4, 77.6]. Errors (FP + FN) 419 [345, 501]. FP per km² 57.6. Macro F1 72.3%.

Median area error 29.9% [24.3, 33.7], signed -23.4% [-29.9, -17.6] (n=191). Centre offset median 1.01 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 15.1% and 16.0% (n=183).

## GOLD

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Mougins, FR (gold) (0.20 km²) | 57 | 47 | 47 | 0 | 10 | 100.0% | 82.5% | 90.4% | ign-orthophotos | n/a (n=0) | n/a | 9906 |
| Grabels, FR (gold) (0.19 km²) | 95 | 60 | 58 | 2 | 37 | 96.7% | 61.1% | 74.8% | ign-orthophotos | n/a (n=0) | n/a | 9268 |
| Pozuelo de Alarcon, ES (gold) (0.21 km²) | 162 | 159 | 145 | 14 | 17 | 91.2% | 89.5% | 90.3% | pnoa | n/a (n=0) | n/a | 9491 |
| Mougins, FR (gold, Esri) (0.20 km²) | 35 | 27 | 25 | 2 | 10 | 92.6% | 71.4% | 80.6% | esri-world-imagery | n/a (n=0) | n/a | 9020 |
| Pozuelo de Alarcon, ES (gold, Esri) (0.21 km²) | 129 | 109 | 96 | 13 | 33 | 88.1% | 74.4% | 80.7% | esri-world-imagery | n/a (n=0) | n/a | 9884 |
| **all GOLD** | 478 | 402 | 371 | 31 | 107 | 92.3% | 77.6% | 84.3% |  | n/a (n=0) | n/a | 9520 |

Precision 92.3% [88.7, 95.0], recall 77.6% [73.5, 81.6], F1 84.3% [80.9, 87.2]. Errors (FP + FN) 138 [105, 173]. FP per km² 30.6. Macro F1 83.4%.

Median area error n/a, signed n/a (n=0). Centre offset median 0.33 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): n/a and n/a (n=0).

## Threshold sweep (micro-averaged)

| threshold | DEV P | DEV R | DEV F1 | DEV-2 P | DEV-2 R | DEV-2 F1 | GOLD P | GOLD R | GOLD F1 |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 0.30 | 64.9% | 77.7% | 70.7% | 68.8% | 79.9% | 73.9% | 92.1% | 78.5% | 84.7% |
| 0.35 | 65.0% | 77.2% | 70.6% | 69.4% | 79.6% | 74.2% | 92.1% | 77.8% | 84.4% |
| 0.40 | 71.9% | 75.0% | 73.4% | 69.6% | 79.5% | 74.2% | 92.3% | 77.6% | 84.3% |
| 0.45 | 78.9% | 73.0% | 75.9% | 71.9% | 77.2% | 74.5% | 92.5% | 75.1% | 82.9% |
| 0.50 | 78.9% | 73.0% | 75.9% | 71.9% | 77.0% | 74.4% | 92.5% | 74.9% | 82.8% |
| 0.55 | 79.3% | 70.1% | 74.4% | 77.6% | 75.7% | 76.6% | 95.0% | 71.5% | 81.6% |
| 0.60 | 85.2% | 61.3% | 71.3% | 78.5% | 72.0% | 75.1% | 96.9% | 65.3% | 78.0% |
| 0.65 | 85.9% | 59.1% | 70.0% | 78.4% | 71.7% | 74.9% | 97.2% | 65.1% | 77.9% |
| 0.70 | 85.8% | 58.6% | 69.6% | 79.8% | 62.1% | 69.8% | 96.9% | 59.6% | 73.8% |
| 0.75 | 86.4% | 56.2% | 68.1% | 79.9% | 62.1% | 69.9% | 96.9% | 58.6% | 73.0% |
| 0.80 | 85.5% | 52.2% | 64.8% | 79.3% | 55.7% | 65.4% | 97.7% | 45.2% | 61.8% |

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
| Vilamoura, PT | 12 | 1 | 2 | 4 | 8 |
| Scottsdale, AZ, US | 6 | 0 | 15 | 1 | 16 |
| Odemira greenhouses, Alentejo, PT | 0 | 0 | 0 | 0 | 0 |
| Puyricard, Aix-en-Provence, FR | 3 | 1 | 0 | 0 | 37 |
| Balma, Toulouse, FR | 86 | 5 | 1 | 4 | 4 |
| Braga, PT | 13 | 3 | 0 | 3 | 17 |
| Marbella, ES | 89 | 11 | 3 | 7 | 8 |
| Birre, Cascais, PT | 29 | 0 | 5 | 0 | 10 |
| Santa Barbara de Nexe, Algarve interior, PT | 46 | 1 | 0 | 7 | 9 |
| Castelnau-le-Lez, Montpellier, FR | 64 | 7 | 28 | 2 | 39 |
| Arcadia, Phoenix, AZ, US | 11 | 5 | 10 | 2 | 26 |
| Mougins, FR (gold) | 0 | 0 | 2 | 3 | 5 |
| Grabels, FR (gold) | 2 | 0 | 18 | 5 | 14 |
| Pozuelo de Alarcon, ES (gold) | 10 | 4 | 5 | 7 | 5 |
| Mougins, FR (gold, Esri) | 1 | 1 | 4 | 3 | 3 |
| Pozuelo de Alarcon, ES (gold, Esri) | 9 | 4 | 11 | 16 | 6 |


## Calibration

DEV zones are scored with the isotonic calibration and threshold fitted on the other calibration zones (out of fold). A family with no other calibration zone (Esri: Scottsdale only) falls back to the calibration pooled over all families. DEV-2 and GOLD use the shipped model, calibrated on every calibration zone; Pozuelo is the PNOA calibration zone, so its GOLD line is in sample.

| DEV zone | family | threshold |
|---|---|--:|
| vilamoura | dgt | 0.737 |
| scottsdale | esri | 0.500 |
| odemira | dgt | 0.400 |
| aix | ign | 0.300 |
| balma | ign | 0.438 |
| braga | dgt | 0.579 |

Shipped thresholds: dgt 0.400, esri 0.400, ign 0.400, pnoa 0.500, default 0.442.

## Product path against the whole mosaic (P8)

The mosaic scores the whole area as one image. Its two context features (brightness and saturation of the tile) are taken per z19 tile, as the product does, so the difference measures the tile borders; the last column takes them over the whole image instead.

| GOLD zone | recall, product path | recall, mosaic | difference | mosaic, whole-image context |
|---|--:|--:|--:|--:|
| gold-mougins | 82.5% | 82.5% | 0.0 pp | 82.5% |
| gold-grabels | 61.1% | 62.1% | -1.1 pp | 63.2% |
| gold-pozuelo | 89.5% | 90.1% | -0.6 pp | 89.5% |
| gold-mougins-esri | 71.4% | 71.4% | 0.0 pp | 68.6% |
| gold-pozuelo-esri | 74.4% | 74.4% | 0.0 pp | 76.0% |
