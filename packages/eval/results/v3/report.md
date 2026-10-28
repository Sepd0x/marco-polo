# Benchmark: v2 at the calibrated threshold of each source, --source auto (DEV calibrated out of fold)

- detector: `v2` (packages/core detectWindow + DetectionMerger, model packages/core/models/pool-v2.json (sha256 715946884a6e)), hash `3c2289a04d3b`
- confidence threshold: the calibrated threshold of each source (per zone below)
- imagery: `--source auto` (per zone below), z19 grid; 11424 images read, manifest `738d9950c54e`
- labels: frozen set `92e46aeec9c3`, see `packages/eval/README.md`; point rule v2
- commit: d90e434, run 2026-10-28

A detection hits a polygon label when its centre falls inside it or the two boxes overlap with IoU >= 0.3. It hits a point label when its centre is within max(3 m, half the long side of its box) of the point and its area is at most max(4 x the median pool label of the zone, 150 m²). Each label is matched once. Precision is over detections, recall over labels. Brackets: 95% interval, block bootstrap (4 x 4 z19 tiles, 2000 replicates, seed 20261007). Area error compares the detected area with the OSM polygon, over hits on OSM polygons only; "signed" below zero means the detector under-measures. Time is detector CPU time per km², tiles already decoded.

## DEV

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Vilamoura, PT (1.00 km²) | 68 | 68 | 53 | 15 | 15 | 77.9% | 77.9% | 77.9% | dgt-ortos2025 | 19.7% (n=50) | -4.1% | 4514 |
| Scottsdale, AZ, US (0.56 km²) | 78 | 71 | 57 | 14 | 21 | 80.3% | 73.1% | 76.5% | esri-world-imagery | 10.7% (n=1) | -10.7% | 4542 |
| Odemira greenhouses, Alentejo, PT (1.00 km²) | 0 | 0 | 0 | 0 | 0 | n/a | n/a | n/a | dgt-ortos2025 | n/a (n=0) | n/a | 3896 |
| Puyricard, Aix-en-Provence, FR (1.00 km²) | 79 | 54 | 48 | 7 | 31 | 87.0% | 60.8% | 71.6% | ign-orthophotos | 28.4% (n=28) | -18.0% | 8901 |
| Balma, Toulouse, FR (1.00 km²) | 98 | 118 | 84 | 34 | 14 | 71.2% | 85.7% | 77.8% | ign-orthophotos | 53.6% (n=39) | -9.4% | 6696 |
| Braga, PT (1.00 km²) | 166 | 149 | 141 | 8 | 25 | 94.6% | 84.9% | 89.5% | dgt-ortos2025 | 20.2% (n=68) | +8.4% | 6350 |
| **all DEV** | 489 | 460 | 383 | 78 | 106 | 83.0% | 78.3% | 80.6% |  | 23.8% (n=186) | -2.0% | 5910 |

Precision 83.0% [78.6, 87.2], recall 78.3% [74.3, 82.1], F1 80.6% [77.1, 83.7]. Errors (FP + FN) 184 [149, 223]. FP per km² 14.0. Macro F1 78.7%.

Median area error 23.8% [18.9, 30.5], signed -2.0% [-9.2, 2.4] (n=186). Centre offset median 0.62 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 12.0% and 20.4% (n=182).

Pools of 400 m² or more (outlines): 2 of 4 found (recall 50.0%).

## DEV-2

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Marbella, ES (1.00 km²) | 151 | 215 | 134 | 82 | 17 | 61.9% | 88.7% | 72.9% | pnoa | 25.9% (n=19) | -22.9% | 4837 |
| Birre, Cascais, PT (0.56 km²) | 149 | 167 | 135 | 32 | 14 | 80.8% | 90.6% | 85.4% | dgt-ortos2025 | 31.6% (n=6) | +15.0% | 6668 |
| Santa Barbara de Nexe, Algarve interior, PT (1.00 km²) | 52 | 84 | 35 | 49 | 17 | 41.7% | 67.3% | 51.5% | dgt-ortos2025 | 32.7% (n=7) | +32.7% | 3219 |
| Castelnau-le-Lez, Montpellier, FR (1.00 km²) | 226 | 259 | 165 | 95 | 61 | 63.3% | 73.0% | 67.8% | ign-orthophotos | 23.1% (n=163) | -15.0% | 8085 |
| Arcadia, Phoenix, AZ, US (1.00 km²) | 182 | 149 | 140 | 10 | 42 | 93.3% | 76.9% | 84.3% | esri-world-imagery | 34.9% (n=3) | -34.9% | 4396 |
| **all DEV-2** | 760 | 874 | 609 | 268 | 151 | 69.3% | 80.1% | 74.3% |  | 24.1% (n=198) | -14.5% | 5332 |

Precision 69.3% [64.2, 74.1], recall 80.1% [76.7, 83.4], F1 74.3% [70.6, 77.7]. Errors (FP + FN) 419 [348.975, 492]. FP per km² 58.7. Macro F1 72.4%.

Median area error 24.1% [19.4, 27.7], signed -14.5% [-19.6, -7.3] (n=198). Centre offset median 0.99 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 14.1% and 17.6% (n=187).

Pools of 400 m² or more (outlines): 6 of 6 found (recall 100.0%).

## GOLD

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Mougins, FR (gold) (0.20 km²) | 57 | 48 | 48 | 0 | 9 | 100.0% | 84.2% | 91.4% | ign-orthophotos | n/a (n=0) | n/a | 7637 |
| Grabels, FR (gold) (0.19 km²) | 95 | 66 | 64 | 2 | 31 | 97.0% | 67.4% | 79.5% | ign-orthophotos | n/a (n=0) | n/a | 8342 |
| Pozuelo de Alarcon, ES (gold) (0.21 km²) | 162 | 148 | 141 | 7 | 21 | 95.3% | 87.0% | 91.0% | pnoa | n/a (n=0) | n/a | 6952 |
| Mougins, FR (gold, Esri) (0.20 km²) | 35 | 27 | 27 | 0 | 8 | 100.0% | 77.1% | 87.1% | esri-world-imagery | n/a (n=0) | n/a | 5886 |
| Pozuelo de Alarcon, ES (gold, Esri) (0.21 km²) | 129 | 96 | 89 | 7 | 40 | 92.7% | 69.0% | 79.1% | esri-world-imagery | n/a (n=0) | n/a | 5950 |
| **all GOLD** | 478 | 385 | 369 | 16 | 109 | 95.8% | 77.2% | 85.5% |  | n/a (n=0) | n/a | 6936 |

Precision 95.8% [93.1, 97.9], recall 77.2% [73.2, 81.0], F1 85.5% [82.6, 88.1]. Errors (FP + FN) 125 [93, 161]. FP per km² 15.8. Macro F1 85.6%.

Median area error n/a, signed n/a (n=0). Centre offset median 0.32 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): n/a and n/a (n=0).

Pools of 400 m² or more (outlines): 0 of 0 found.

## TEST negative (apart)

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Dunkerque, FR (TEST negative) (1.00 km²) | 0 | 31 | 0 | 31 | 0 | 0.0% | n/a | n/a | ign-orthophotos | n/a (n=0) | n/a | 5971 |
| **all TEST negative (apart)** | 0 | 31 | 0 | 31 | 0 | 0.0% | n/a | n/a |  | n/a (n=0) | n/a | 5971 |

Precision 0.0% [0.0, 0.0], recall n/a, F1 n/a. Errors (FP + FN) 31 [22, 41]. FP per km² 31.0. Macro F1 n/a.

Median area error n/a, signed n/a (n=0). Centre offset median n/a. Length and width error (minimum-area rectangle of the outline against the OSM outline): n/a and n/a (n=0).

Pools of 400 m² or more (outlines): 0 of 0 found.

## TEST (held out: never used for tuning)

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Viseu, PT (TEST pt-rest) (1.00 km²) | 52 | 60 | 49 | 11 | 3 | 81.7% | 94.2% | 87.5% | dgt-ortos2025 | 11.0% (n=9) | +5.9% | 6308 |
| la Nucia, ES (TEST es) (4.00 km²) | 894 | 916 | 852 | 64 | 42 | 93.0% | 95.3% | 94.1% | pnoa | 18.1% (n=16) | -12.9% | 1942 |
| Dammarie-les-Lys, FR (TEST fr) (4.00 km²) | 98 | 74 | 52 | 22 | 46 | 70.3% | 53.1% | 60.5% | ign-orthophotos | 7.4% (n=2) | +7.4% | 4012 |
| Santa Fe Springs city, CA, US (TEST us) (4.00 km²) | 185 | 208 | 173 | 35 | 12 | 83.2% | 93.5% | 88.0% | esri-world-imagery | n/a (n=0) | n/a | 2250 |
| Mirandela, PT (TEST pt-north) (4.00 km²) | 58 | 84 | 46 | 38 | 12 | 54.8% | 79.3% | 64.8% | dgt-ortos2025 | 40.9% (n=1) | -40.9% | 4101 |
| **all TEST** | 1287 | 1342 | 1172 | 170 | 115 | 87.3% | 91.1% | 89.2% |  | 14.6% (n=28) | -8.1% | 3280 |

Precision 87.3% [84.6, 89.8], recall 91.1% [89.3, 92.8], F1 89.2% [87.3, 90.8]. Errors (FP + FN) 285 [241.975, 328.02499999999986]. FP per km² 10.0. Macro F1 79.0%.

Median area error 14.6% [9.8, 50.2], signed -8.1% [-41.1, 6.2] (n=28). Centre offset median 0.30 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 10.1% and 13.8% (n=27).

Pools of 400 m² or more (outlines): 1 of 1 found (recall 100.0%).

## TEST hard (apart)

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Brixen - Bressanone, IT (TEST hard) (4.00 km²) | 20 | 5 | 2 | 3 | 18 | 40.0% | 10.0% | 16.0% | esri-world-imagery | 27.5% (n=1) | -27.5% | 4468 |
| **all TEST hard (apart)** | 20 | 5 | 2 | 3 | 18 | 40.0% | 10.0% | 16.0% |  | 27.5% (n=1) | -27.5% | 4468 |

Precision 40.0% [0.0, 100.0], recall 10.0% [0.0, 22.7], F1 16.0% [0.0, 34.5]. Errors (FP + FN) 21 [17, 25]. FP per km² 0.8. Macro F1 16.0%.

Median area error 27.5% [27.5, 27.5], signed -27.5% [-27.5, -27.5] (n=1). Centre offset median 1.13 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 8.3% and 30.0% (n=1).

Pools of 400 m² or more (outlines): 0 of 2 found (recall 0.0%).

## TEST by stratum

| stratum | labels | TP | FP | FN | precision | recall | F1 |
|---|--:|--:|--:|--:|--:|--:|--:|
| pt-rest | 52 | 49 | 11 | 3 | 81.7% | 94.2% | 87.5% [74.6, 94.7] |
| es | 894 | 852 | 64 | 42 | 93.0% | 95.3% | 94.1% [92.7, 95.5] |
| fr | 98 | 52 | 22 | 46 | 70.3% | 53.1% | 60.5% [51.9, 69.1] |
| us | 185 | 173 | 35 | 12 | 83.2% | 93.5% | 88.0% [82.0, 92.7] |
| pt-north | 58 | 46 | 38 | 12 | 54.8% | 79.3% | 64.8% [54.5, 73.6] |

## Threshold sweep (micro-averaged)

| threshold | DEV P | DEV R | DEV F1 | DEV-2 P | DEV-2 R | DEV-2 F1 | GOLD P | GOLD R | GOLD F1 | TEST P | TEST R | TEST F1 |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 0.30 | 80.5% | 80.4% | 80.4% | 66.7% | 82.0% | 73.6% | 94.8% | 79.3% | 86.3% | 85.2% | 91.8% | 88.4% |
| 0.35 | 82.4% | 79.6% | 80.9% | 69.5% | 80.1% | 74.4% | 95.8% | 77.2% | 85.5% | 87.4% | 91.0% | 89.2% |
| 0.40 | 83.3% | 78.7% | 81.0% | 69.5% | 80.1% | 74.4% | 95.8% | 77.2% | 85.5% | 87.4% | 91.0% | 89.2% |
| 0.45 | 84.4% | 77.5% | 80.8% | 69.9% | 79.1% | 74.2% | 96.6% | 76.2% | 85.1% | 88.9% | 90.0% | 89.5% |
| 0.50 | 84.6% | 76.7% | 80.5% | 69.9% | 79.1% | 74.2% | 96.8% | 76.2% | 85.2% | 89.0% | 89.9% | 89.4% |
| 0.55 | 85.1% | 75.9% | 80.2% | 71.1% | 78.7% | 74.7% | 97.0% | 73.4% | 83.6% | 89.7% | 88.7% | 89.2% |
| 0.60 | 86.6% | 72.6% | 79.0% | 72.2% | 77.1% | 74.6% | 97.2% | 71.8% | 82.6% | 90.2% | 88.0% | 89.1% |
| 0.65 | 87.9% | 71.6% | 78.9% | 72.6% | 76.3% | 74.4% | 97.2% | 71.8% | 82.6% | 91.3% | 87.6% | 89.5% |
| 0.70 | 90.8% | 66.9% | 77.0% | 74.3% | 72.0% | 73.1% | 98.7% | 63.0% | 76.9% | 93.4% | 83.4% | 88.1% |
| 0.75 | 92.3% | 64.2% | 75.7% | 75.9% | 70.9% | 73.3% | 98.7% | 63.0% | 76.9% | 94.9% | 82.1% | 88.0% |
| 0.80 | 92.5% | 63.6% | 75.4% | 79.3% | 67.0% | 72.6% | 98.9% | 58.6% | 73.6% | 95.9% | 81.0% | 87.8% |

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
| Grabels, FR (gold) | GOLD | gold-union | 95 | 0 | 95 | 26 | 0 | 100 (2 without imagery) |
| Pozuelo de Alarcon, ES (gold) | GOLD | gold-union | 162 | 0 | 162 | 37 | 0 | 100 |
| Mougins, FR (gold, Esri) | GOLD | gold-union | 35 | 0 | 35 | 6 | 0 | 100 |
| Pozuelo de Alarcon, ES (gold, Esri) | GOLD | gold-union | 129 | 0 | 129 | 39 | 0 | 100 |
| Dunkerque, FR (TEST negative) | TEST | blind | 0 | 0 | 0 | 2 | 0 | 529 (13 without imagery) |
| Viseu, PT (TEST pt-rest) | TEST | blind | 52 | 0 | 43 | 18 | 0 | 380 |
| la Nucia, ES (TEST es) | TEST | blind | 894 | 0 | 878 | 72 | 0 | 1296 |
| Dammarie-les-Lys, FR (TEST fr) | TEST | blind | 98 | 0 | 95 | 152 | 0 | 1806 (4 without imagery) |
| Santa Fe Springs city, CA, US (TEST us) | TEST | blind | 185 | 0 | 185 | 38 | 0 | 1122 |
| Brixen - Bressanone, IT (TEST hard) | TEST | blind | 20 | 0 | 12 | 42 | 0 | 1681 |
| Mirandela, PT (TEST pt-north) | TEST | blind | 58 | 0 | 55 | 40 | 0 | 1406 |

## Errors, automatic split

| area | FP unlabelled | FP duplicate | FN below threshold | FN partial overlap | FN not detected |
|---|--:|--:|--:|--:|--:|
| Vilamoura, PT | 14 | 1 | 4 | 4 | 7 |
| Scottsdale, AZ, US | 14 | 0 | 7 | 1 | 13 |
| Odemira greenhouses, Alentejo, PT | 0 | 0 | 0 | 0 | 0 |
| Puyricard, Aix-en-Provence, FR | 4 | 3 | 8 | 0 | 23 |
| Balma, Toulouse, FR | 32 | 2 | 3 | 2 | 9 |
| Braga, PT | 7 | 1 | 15 | 2 | 8 |
| Marbella, ES | 79 | 3 | 1 | 6 | 10 |
| Birre, Cascais, PT | 32 | 0 | 3 | 0 | 11 |
| Santa Barbara de Nexe, Algarve interior, PT | 48 | 1 | 0 | 8 | 9 |
| Castelnau-le-Lez, Montpellier, FR | 88 | 7 | 18 | 5 | 38 |
| Arcadia, Phoenix, AZ, US | 9 | 1 | 12 | 2 | 28 |
| Mougins, FR (gold) | 0 | 0 | 2 | 4 | 3 |
| Grabels, FR (gold) | 2 | 0 | 14 | 7 | 10 |
| Pozuelo de Alarcon, ES (gold) | 5 | 2 | 5 | 10 | 6 |
| Mougins, FR (gold, Esri) | 0 | 0 | 0 | 1 | 7 |
| Pozuelo de Alarcon, ES (gold, Esri) | 7 | 0 | 14 | 15 | 11 |
| Dunkerque, FR (TEST negative) | 31 | 0 | 0 | 0 | 0 |
| Viseu, PT (TEST pt-rest) | 10 | 1 | 0 | 2 | 1 |
| la Nucia, ES (TEST es) | 61 | 3 | 20 | 1 | 21 |
| Dammarie-les-Lys, FR (TEST fr) | 22 | 0 | 17 | 0 | 29 |
| Santa Fe Springs city, CA, US (TEST us) | 33 | 2 | 7 | 0 | 5 |
| Brixen - Bressanone, IT (TEST hard) | 3 | 0 | 1 | 0 | 17 |
| Mirandela, PT (TEST pt-north) | 37 | 1 | 2 | 0 | 10 |


## Calibration

DEV zones are scored with the isotonic calibration and threshold fitted on the other calibration zones (out of fold). No Esri zone calibrates (the terms of Esri forbid using its data to train systems): Esri reads the map pooled over the other families, with the pooled threshold, and its DEV zone is scored with the shipped model, which never saw it. A family with no other calibration zone (PNOA: Pozuelo only) falls back to the pooled calibration. DEV-2, GOLD and TEST use the shipped model, calibrated on every calibration zone; Pozuelo is the PNOA calibration zone, so its GOLD line is in sample.

| DEV zone | family | threshold |
|---|---|--:|
| vilamoura | dgt | 0.333 |
| scottsdale | esri | 0.385 |
| odemira | dgt | 0.402 |
| aix | ign | 0.375 |
| balma | ign | 0.413 |
| braga | dgt | 0.520 |

Shipped thresholds: default 0.385, dgt 0.309, ign 0.556, esri 0.385.

## Product path against the whole mosaic (P8)

The mosaic scores the whole area as one image. Its two context features (brightness and saturation of the tile) are taken per z19 tile, as the product does, so the difference measures the tile borders; the last column takes them over the whole image instead.

| GOLD zone | recall, product path | recall, mosaic | difference | mosaic, whole-image context |
|---|--:|--:|--:|--:|
| gold-mougins | 84.2% | 84.2% | 0.0 pp | 84.2% |
| gold-grabels | 67.4% | 67.4% | 0.0 pp | 67.4% |
| gold-pozuelo | 87.0% | 87.7% | -0.6 pp | 87.7% |
| gold-mougins-esri | 77.1% | 77.1% | 0.0 pp | 74.3% |
| gold-pozuelo-esri | 69.0% | 69.0% | 0.0 pp | 70.5% |
