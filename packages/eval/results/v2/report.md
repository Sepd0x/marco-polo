# Benchmark: v2 at the calibrated threshold of each source, --source auto (DEV calibrated out of fold)

- detector: `v2` (packages/core detectWindow + DetectionMerger, model packages/core/models/pool-v2.json (sha256 d9c3672b29ae)), hash `62ba002bff61`
- confidence threshold: the calibrated threshold of each source (per zone below)
- imagery: `--source auto` (per zone below), z19 grid; 11427 images read, manifest `9344ccd09590`
- labels: frozen set `92e46aeec9c3`, see `packages/eval/README.md`; point rule v2
- commit: e676b20, run 2026-10-10

A detection hits a polygon label when its centre falls inside it or the two boxes overlap with IoU >= 0.3. It hits a point label when its centre is within max(3 m, half the long side of its box) of the point and its area is at most max(4 x the median pool label of the zone, 150 m²). Each label is matched once. Precision is over detections, recall over labels. Brackets: 95% interval, block bootstrap (4 x 4 z19 tiles, 2000 replicates, seed 20261007). Area error compares the detected area with the OSM polygon, over hits on OSM polygons only; "signed" below zero means the detector under-measures. Time is detector CPU time per km², tiles already decoded.

## DEV

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Vilamoura, PT (1.00 km²) | 68 | 47 | 39 | 8 | 29 | 83.0% | 57.4% | 67.8% | dgt-ortos2025 | 18.2% (n=36) | -7.8% | 8769 |
| Scottsdale, AZ, US (0.56 km²) | 78 | 78 | 59 | 19 | 19 | 75.6% | 75.6% | 75.6% | esri-world-imagery | 57.9% (n=2) | -57.9% | 8313 |
| Odemira greenhouses, Alentejo, PT (1.00 km²) | 0 | 0 | 0 | 0 | 0 | n/a | n/a | n/a | dgt-ortos2025 | n/a (n=0) | n/a | 8141 |
| Puyricard, Aix-en-Provence, FR (1.00 km²) | 79 | 56 | 48 | 9 | 31 | 83.9% | 60.8% | 70.5% | ign-orthophotos | 30.6% (n=28) | -23.4% | 15761 |
| Balma, Toulouse, FR (1.00 km²) | 98 | 112 | 84 | 28 | 14 | 75.0% | 85.7% | 80.0% | ign-orthophotos | 47.8% (n=40) | -21.7% | 15114 |
| Braga, PT (1.00 km²) | 166 | 161 | 147 | 14 | 19 | 91.3% | 88.6% | 89.9% | dgt-ortos2025 | 24.7% (n=70) | -2.7% | 14974 |
| **all DEV** | 489 | 454 | 377 | 78 | 112 | 82.8% | 77.1% | 79.9% |  | 25.5% (n=176) | -12.2% | 12104 |

Precision 82.8% [78.4, 86.8], recall 77.1% [72.5, 81.2], F1 79.9% [76.3, 83.1]. Errors (FP + FN) 190 [154, 229]. FP per km² 14.0. Macro F1 76.8%.

Median area error 25.5% [20.8, 33.1], signed -12.2% [-17.6, -6.8] (n=176). Centre offset median 0.62 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 13.1% and 19.5% (n=170).

## DEV-2

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Marbella, ES (1.00 km²) | 151 | 216 | 134 | 83 | 17 | 61.6% | 88.7% | 72.7% | pnoa | 37.3% (n=18) | -37.3% | 10151 |
| Birre, Cascais, PT (0.56 km²) | 149 | 162 | 133 | 29 | 16 | 82.1% | 89.3% | 85.5% | dgt-ortos2025 | 24.6% (n=6) | +8.6% | 14773 |
| Santa Barbara de Nexe, Algarve interior, PT (1.00 km²) | 52 | 82 | 35 | 47 | 17 | 42.7% | 67.3% | 52.2% | dgt-ortos2025 | 13.7% (n=7) | +4.7% | 9939 |
| Castelnau-le-Lez, Montpellier, FR (1.00 km²) | 226 | 246 | 163 | 84 | 63 | 65.9% | 72.1% | 68.8% | ign-orthophotos | 25.6% (n=161) | -22.1% | 18589 |
| Arcadia, Phoenix, AZ, US (1.00 km²) | 182 | 158 | 142 | 17 | 40 | 89.2% | 78.0% | 83.3% | esri-world-imagery | 40.6% (n=4) | -40.6% | 10068 |
| **all DEV-2** | 760 | 864 | 607 | 260 | 153 | 69.9% | 79.9% | 74.6% |  | 27.9% (n=196) | -22.2% | 12520 |

Precision 69.9% [64.7, 74.9], recall 79.9% [76.5, 82.9], F1 74.6% [71.0, 77.9]. Errors (FP + FN) 413 [346, 482]. FP per km² 57.0. Macro F1 72.5%.

Median area error 27.9% [23.5, 33.5], signed -22.2% [-28.0, -15.9] (n=196). Centre offset median 1.00 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 15.1% and 18.5% (n=186).

## GOLD

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Mougins, FR (gold) (0.20 km²) | 57 | 49 | 48 | 1 | 9 | 98.0% | 84.2% | 90.6% | ign-orthophotos | n/a (n=0) | n/a | 14778 |
| Grabels, FR (gold) (0.19 km²) | 95 | 68 | 64 | 4 | 31 | 94.1% | 67.4% | 78.5% | ign-orthophotos | n/a (n=0) | n/a | 12410 |
| Pozuelo de Alarcon, ES (gold) (0.21 km²) | 162 | 151 | 142 | 9 | 20 | 94.0% | 87.7% | 90.7% | pnoa | n/a (n=0) | n/a | 12439 |
| Mougins, FR (gold, Esri) (0.20 km²) | 35 | 27 | 26 | 1 | 9 | 96.3% | 74.3% | 83.9% | esri-world-imagery | n/a (n=0) | n/a | 12227 |
| Pozuelo de Alarcon, ES (gold, Esri) (0.21 km²) | 129 | 105 | 95 | 10 | 34 | 90.5% | 73.6% | 81.2% | esri-world-imagery | n/a (n=0) | n/a | 13766 |
| **all GOLD** | 478 | 400 | 375 | 25 | 103 | 93.8% | 78.5% | 85.4% |  | n/a (n=0) | n/a | 13124 |

Precision 93.8% [90.5, 96.3], recall 78.5% [74.8, 81.7], F1 85.4% [82.4, 87.8]. Errors (FP + FN) 128 [99, 159]. FP per km² 24.7. Macro F1 85.0%.

Median area error n/a, signed n/a (n=0). Centre offset median 0.31 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): n/a and n/a (n=0).

## TEST negative (apart)

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Dunkerque, FR (TEST negative) (1.00 km²) | 0 | 25 | 0 | 25 | 0 | 0.0% | n/a | n/a | ign-orthophotos | n/a (n=0) | n/a | 13282 |
| **all TEST negative (apart)** | 0 | 25 | 0 | 25 | 0 | 0.0% | n/a | n/a |  | n/a (n=0) | n/a | 13282 |

Precision 0.0% [0.0, 0.0], recall n/a, F1 n/a. Errors (FP + FN) 25 [18, 35]. FP per km² 25.0. Macro F1 n/a.

Median area error n/a, signed n/a (n=0). Centre offset median n/a. Length and width error (minimum-area rectangle of the outline against the OSM outline): n/a and n/a (n=0).

## TEST (held out: never used for tuning)

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Viseu, PT (TEST pt-rest) (1.00 km²) | 52 | 55 | 48 | 7 | 4 | 87.3% | 92.3% | 89.7% | dgt-ortos2025 | 16.5% (n=9) | -2.7% | 11855 |
| la Nucia, ES (TEST es) (4.00 km²) | 894 | 905 | 848 | 57 | 46 | 93.7% | 94.9% | 94.3% | pnoa | 22.0% (n=13) | -22.0% | 6592 |
| Dammarie-les-Lys, FR (TEST fr) (4.00 km²) | 98 | 63 | 47 | 16 | 51 | 74.6% | 48.0% | 58.4% | ign-orthophotos | 7.1% (n=2) | +6.5% | 12388 |
| Santa Fe Springs city, CA, US (TEST us) (4.00 km²) | 185 | 204 | 171 | 33 | 14 | 83.8% | 92.4% | 87.9% | esri-world-imagery | n/a (n=0) | n/a | 8269 |
| Mirandela, PT (TEST pt-north) (4.00 km²) | 58 | 70 | 43 | 27 | 15 | 61.4% | 74.1% | 67.2% | dgt-ortos2025 | n/a (n=0) | n/a | 15176 |
| **all TEST** | 1287 | 1297 | 1157 | 140 | 130 | 89.2% | 89.9% | 89.6% |  | 18.6% (n=24) | -15.2% | 10686 |

Precision 89.2% [86.9, 91.2], recall 89.9% [87.9, 91.7], F1 89.6% [87.7, 91.1]. Errors (FP + FN) 270 [231, 307]. FP per km² 8.2. Macro F1 79.5%.

Median area error 18.6% [13.6, 30.8], signed -15.2% [-28.9, -2.7] (n=24). Centre offset median 0.30 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 6.9% and 10.6% (n=24).

## TEST hard (apart)

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Brixen - Bressanone, IT (TEST hard) (4.00 km²) | 20 | 3 | 1 | 2 | 19 | 33.3% | 5.0% | 8.7% | esri-world-imagery | n/a (n=0) | n/a | 16549 |
| **all TEST hard (apart)** | 20 | 3 | 1 | 2 | 19 | 33.3% | 5.0% | 8.7% |  | n/a (n=0) | n/a | 16549 |

Precision 33.3% [0.0, 100.0], recall 5.0% [0.0, 17.6], F1 8.7% [0.0, 27.3]. Errors (FP + FN) 21 [16, 25]. FP per km² 0.5. Macro F1 8.7%.

Median area error n/a, signed n/a (n=0). Centre offset median 1.73 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): n/a and n/a (n=0).

## TEST by stratum

| stratum | labels | TP | FP | FN | precision | recall | F1 |
|---|--:|--:|--:|--:|--:|--:|--:|
| pt-rest | 52 | 48 | 7 | 4 | 87.3% | 92.3% | 89.7% [77.9, 96.1] |
| es | 894 | 848 | 57 | 46 | 93.7% | 94.9% | 94.3% [92.9, 95.5] |
| fr | 98 | 47 | 16 | 51 | 74.6% | 48.0% | 58.4% [48.9, 67.4] |
| us | 185 | 171 | 33 | 14 | 83.8% | 92.4% | 87.9% [82.8, 91.6] |
| pt-north | 58 | 43 | 27 | 15 | 61.4% | 74.1% | 67.2% [55.9, 76.5] |

## Threshold sweep (micro-averaged)

| threshold | DEV P | DEV R | DEV F1 | DEV-2 P | DEV-2 R | DEV-2 F1 | GOLD P | GOLD R | GOLD F1 | TEST P | TEST R | TEST F1 |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 0.30 | 78.2% | 80.8% | 79.5% | 69.8% | 80.1% | 74.6% | 93.8% | 78.5% | 85.4% | 88.8% | 90.0% | 89.4% |
| 0.35 | 80.2% | 80.0% | 80.1% | 69.9% | 80.1% | 74.7% | 93.8% | 78.5% | 85.4% | 88.9% | 89.9% | 89.4% |
| 0.40 | 80.2% | 80.0% | 80.1% | 69.9% | 80.1% | 74.7% | 93.8% | 78.5% | 85.4% | 88.9% | 89.9% | 89.4% |
| 0.45 | 83.4% | 75.5% | 79.3% | 69.9% | 79.9% | 74.6% | 93.8% | 78.5% | 85.4% | 89.1% | 89.9% | 89.5% |
| 0.50 | 84.6% | 74.2% | 79.1% | 70.4% | 79.3% | 74.6% | 94.2% | 78.0% | 85.4% | 89.5% | 89.0% | 89.3% |
| 0.55 | 85.1% | 74.0% | 79.2% | 72.0% | 77.9% | 74.8% | 96.0% | 74.7% | 84.0% | 90.3% | 87.1% | 88.7% |
| 0.60 | 86.3% | 73.6% | 79.5% | 72.0% | 77.9% | 74.8% | 96.0% | 74.7% | 84.0% | 90.3% | 87.1% | 88.7% |
| 0.65 | 88.5% | 67.7% | 76.7% | 72.4% | 77.9% | 75.0% | 96.0% | 74.7% | 84.0% | 91.1% | 86.9% | 88.9% |
| 0.70 | 88.5% | 67.7% | 76.7% | 72.3% | 77.5% | 74.8% | 96.0% | 74.7% | 84.0% | 91.1% | 86.8% | 88.9% |
| 0.75 | 89.5% | 63.0% | 73.9% | 74.3% | 74.6% | 74.5% | 97.1% | 69.2% | 80.8% | 93.4% | 84.0% | 88.4% |
| 0.80 | 92.6% | 56.9% | 70.5% | 77.9% | 66.7% | 71.9% | 97.4% | 55.0% | 70.3% | 95.9% | 78.2% | 86.1% |

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
| Mougins, FR (gold) | GOLD | gold-union | 57 | 0 | 57 | 13 | 0 | 100 |
| Grabels, FR (gold) | GOLD | gold-union | 95 | 0 | 95 | 26 | 0 | 100 |
| Pozuelo de Alarcon, ES (gold) | GOLD | gold-union | 162 | 0 | 162 | 37 | 0 | 100 |
| Mougins, FR (gold, Esri) | GOLD | gold-union | 35 | 0 | 35 | 6 | 0 | 100 |
| Pozuelo de Alarcon, ES (gold, Esri) | GOLD | gold-union | 129 | 0 | 129 | 39 | 0 | 100 |
| Dunkerque, FR (TEST negative) | TEST | blind | 0 | 0 | 0 | 2 | 0 | 529 (13 without imagery) |
| Viseu, PT (TEST pt-rest) | TEST | blind | 52 | 0 | 43 | 18 | 0 | 380 |
| la Nucia, ES (TEST es) | TEST | blind | 894 | 0 | 878 | 72 | 0 | 1296 |
| Dammarie-les-Lys, FR (TEST fr) | TEST | blind | 98 | 0 | 95 | 152 | 0 | 1806 (3 without imagery) |
| Santa Fe Springs city, CA, US (TEST us) | TEST | blind | 185 | 0 | 185 | 38 | 0 | 1122 |
| Brixen - Bressanone, IT (TEST hard) | TEST | blind | 20 | 0 | 12 | 42 | 0 | 1681 |
| Mirandela, PT (TEST pt-north) | TEST | blind | 58 | 0 | 55 | 40 | 0 | 1406 |

## Errors, automatic split

| area | FP unlabelled | FP duplicate | FN below threshold | FN partial overlap | FN not detected |
|---|--:|--:|--:|--:|--:|
| Vilamoura, PT | 8 | 0 | 18 | 3 | 8 |
| Scottsdale, AZ, US | 17 | 2 | 5 | 1 | 13 |
| Odemira greenhouses, Alentejo, PT | 0 | 0 | 0 | 0 | 0 |
| Puyricard, Aix-en-Provence, FR | 5 | 4 | 7 | 0 | 24 |
| Balma, Toulouse, FR | 23 | 5 | 5 | 1 | 8 |
| Braga, PT | 10 | 4 | 10 | 2 | 7 |
| Marbella, ES | 76 | 7 | 3 | 5 | 9 |
| Birre, Cascais, PT | 29 | 0 | 6 | 0 | 10 |
| Santa Barbara de Nexe, Algarve interior, PT | 46 | 1 | 1 | 7 | 9 |
| Castelnau-le-Lez, Montpellier, FR | 76 | 8 | 21 | 3 | 39 |
| Arcadia, Phoenix, AZ, US | 11 | 6 | 15 | 2 | 23 |
| Mougins, FR (gold) | 0 | 1 | 1 | 5 | 3 |
| Grabels, FR (gold) | 3 | 1 | 14 | 7 | 10 |
| Pozuelo de Alarcon, ES (gold) | 7 | 2 | 4 | 9 | 7 |
| Mougins, FR (gold, Esri) | 0 | 1 | 1 | 1 | 7 |
| Pozuelo de Alarcon, ES (gold, Esri) | 7 | 3 | 8 | 15 | 11 |
| Dunkerque, FR (TEST negative) | 25 | 0 | 0 | 0 | 0 |
| Viseu, PT (TEST pt-rest) | 6 | 1 | 1 | 1 | 2 |
| la Nucia, ES (TEST es) | 46 | 11 | 25 | 1 | 20 |
| Dammarie-les-Lys, FR (TEST fr) | 15 | 1 | 20 | 0 | 31 |
| Santa Fe Springs city, CA, US (TEST us) | 27 | 6 | 10 | 0 | 4 |
| Brixen - Bressanone, IT (TEST hard) | 2 | 0 | 3 | 0 | 16 |
| Mirandela, PT (TEST pt-north) | 27 | 0 | 6 | 0 | 9 |


## Calibration

DEV zones are scored with the isotonic calibration and threshold fitted on the other calibration zones (out of fold). A family with no other calibration zone (Esri: Scottsdale only) falls back to the calibration pooled over all families. DEV-2, GOLD and TEST use the shipped model, calibrated on every calibration zone; Pozuelo is the PNOA calibration zone, so its GOLD line is in sample.

| DEV zone | family | threshold |
|---|---|--:|
| vilamoura | dgt | 0.623 |
| scottsdale | esri | 0.400 |
| odemira | dgt | 0.500 |
| aix | ign | 0.329 |
| balma | ign | 0.500 |
| braga | dgt | 0.350 |

Shipped thresholds: default 0.429, dgt 0.500, ign 0.553.

## Product path against the whole mosaic (P8)

The mosaic scores the whole area as one image. Its two context features (brightness and saturation of the tile) are taken per z19 tile, as the product does, so the difference measures the tile borders; the last column takes them over the whole image instead.

| GOLD zone | recall, product path | recall, mosaic | difference | mosaic, whole-image context |
|---|--:|--:|--:|--:|
| gold-mougins | 84.2% | 84.2% | 0.0 pp | 84.2% |
| gold-grabels | 67.4% | 67.4% | 0.0 pp | 67.4% |
| gold-pozuelo | 87.7% | 88.3% | -0.6 pp | 88.9% |
| gold-mougins-esri | 74.3% | 74.3% | 0.0 pp | 74.3% |
| gold-pozuelo-esri | 73.6% | 73.6% | 0.0 pp | 75.2% |
