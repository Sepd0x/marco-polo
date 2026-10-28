# Benchmark: v1 @ 0.55, --source auto

- detector: `v1` (packages/core detectTile + DetectionMerger as shipped (merger minimum 8 m²)), hash `fc81061e6faa`
- confidence threshold: 0.55
- imagery: `--source auto` (per zone below), z19 grid; 12492 images read, manifest `8c567dea4ebc`
- labels: frozen set `92e46aeec9c3`, see `packages/eval/README.md`; point rule v2
- commit: 42b6e2e, run 2026-10-28

A detection hits a polygon label when its centre falls inside it or the two boxes overlap with IoU >= 0.3. It hits a point label when its centre is within max(3 m, half the long side of its box) of the point and its area is at most max(4 x the median pool label of the zone, 150 m²). Each label is matched once. Precision is over detections, recall over labels. Brackets: 95% interval, block bootstrap (4 x 4 z19 tiles, 2000 replicates, seed 20261007). Area error compares the detected area with the OSM polygon, over hits on OSM polygons only; "signed" below zero means the detector under-measures. Time is detector CPU time per km², tiles already decoded.

## DEV

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Vilamoura, PT (1.00 km²) | 68 | 80 | 31 | 49 | 37 | 38.8% | 45.6% | 41.9% | dgt-ortos2025 | 18.6% (n=30) | -16.0% | 416 |
| Scottsdale, AZ, US (0.56 km²) | 78 | 63 | 53 | 10 | 25 | 84.1% | 67.9% | 75.2% | esri-world-imagery | 30.2% (n=2) | +24.0% | 245 |
| Odemira greenhouses, Alentejo, PT (1.00 km²) | 0 | 128 | 0 | 128 | 0 | 0.0% | n/a | n/a | dgt-ortos2025 | n/a (n=0) | n/a | 468 |
| Puyricard, Aix-en-Provence, FR (1.00 km²) | 79 | 336 | 47 | 289 | 32 | 14.0% | 59.5% | 22.7% | ign-orthophotos | 43.0% (n=29) | -34.1% | 942 |
| Balma, Toulouse, FR (1.00 km²) | 98 | 28 | 25 | 3 | 73 | 89.3% | 25.5% | 39.7% | ign-orthophotos | 34.3% (n=15) | -33.1% | 549 |
| Braga, PT (1.00 km²) | 166 | 500 | 79 | 421 | 87 | 15.8% | 47.6% | 23.7% | dgt-ortos2025 | 19.2% (n=47) | -6.1% | 1162 |
| **all DEV** | 489 | 1135 | 235 | 900 | 254 | 20.7% | 48.1% | 28.9% |  | 23.3% (n=123) | -17.0% | 658 |

Precision 20.7% [16.7, 25.3], recall 48.1% [42.5, 53.9], F1 28.9% [24.6, 33.9]. Errors (FP + FN) 1154 [989.975, 1332]. FP per km² 161.8. Macro F1 40.6%.

Median area error 23.3% [20.4, 33.0], signed -17.0% [-22.6, -10.7] (n=123). Centre offset median 0.62 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 12.2% and 14.3% (n=123).

Pools of 400 m² or more (outlines): 3 of 4 found (recall 75.0%).

## DEV-2

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Marbella, ES (1.00 km²) | 151 | 133 | 97 | 37 | 54 | 72.2% | 64.2% | 68.0% | pnoa | 37.3% (n=14) | -37.3% | 530 |
| Birre, Cascais, PT (0.56 km²) | 149 | 472 | 113 | 359 | 36 | 23.9% | 75.8% | 36.4% | dgt-ortos2025 | 12.3% (n=4) | -3.7% | 1286 |
| Santa Barbara de Nexe, Algarve interior, PT (1.00 km²) | 52 | 62 | 28 | 34 | 24 | 45.2% | 53.8% | 49.1% | dgt-ortos2025 | 11.7% (n=5) | +2.5% | 441 |
| Castelnau-le-Lez, Montpellier, FR (1.00 km²) | 226 | 351 | 108 | 243 | 118 | 30.8% | 47.8% | 37.4% | ign-orthophotos | 24.5% (n=108) | -21.1% | 1026 |
| Arcadia, Phoenix, AZ, US (1.00 km²) | 182 | 143 | 122 | 22 | 60 | 84.6% | 67.0% | 74.8% | esri-world-imagery | 60.5% (n=3) | -60.5% | 480 |
| **all DEV-2** | 760 | 1161 | 468 | 695 | 292 | 40.1% | 61.6% | 48.6% |  | 26.3% (n=134) | -22.0% | 705 |

Precision 40.1% [35.7, 45.7], recall 61.6% [58.0, 65.1], F1 48.6% [45.0, 52.7]. Errors (FP + FN) 987 [826, 1171.0249999999999]. FP per km² 152.3. Macro F1 53.1%.

Median area error 26.3% [20.4, 30.3], signed -22.0% [-26.8, -16.9] (n=134). Centre offset median 1.05 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 12.7% and 15.9% (n=134).

Pools of 400 m² or more (outlines): 5 of 6 found (recall 83.3%).

## GOLD

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Mougins, FR (gold) (0.20 km²) | 57 | 43 | 41 | 2 | 16 | 95.3% | 71.9% | 82.0% | ign-orthophotos | n/a (n=0) | n/a | 682 |
| Grabels, FR (gold) (0.19 km²) | 95 | 50 | 23 | 27 | 72 | 46.0% | 24.2% | 31.7% | ign-orthophotos | n/a (n=0) | n/a | 827 |
| Pozuelo de Alarcon, ES (gold) (0.21 km²) | 162 | 117 | 113 | 4 | 49 | 96.6% | 69.8% | 81.0% | pnoa | n/a (n=0) | n/a | 708 |
| Mougins, FR (gold, Esri) (0.20 km²) | 35 | 19 | 19 | 0 | 16 | 100.0% | 54.3% | 70.4% | esri-world-imagery | n/a (n=0) | n/a | 569 |
| Pozuelo de Alarcon, ES (gold, Esri) (0.21 km²) | 129 | 59 | 57 | 2 | 72 | 96.6% | 44.2% | 60.6% | esri-world-imagery | n/a (n=0) | n/a | 689 |
| **all GOLD** | 478 | 288 | 253 | 35 | 225 | 87.8% | 52.9% | 66.1% |  | n/a (n=0) | n/a | 695 |

Precision 87.8% [82.9, 91.9], recall 52.9% [46.6, 58.8], F1 66.1% [60.0, 71.2]. Errors (FP + FN) 260 [192, 340]. FP per km² 34.5. Macro F1 65.1%.

Median area error n/a, signed n/a (n=0). Centre offset median 0.29 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): n/a and n/a (n=0).

Pools of 400 m² or more (outlines): 0 of 0 found.

## TEST negative (apart)

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Dunkerque, FR (TEST negative) (1.00 km²) | 0 | 8 | 0 | 8 | 0 | 0.0% | n/a | n/a | ign-orthophotos | n/a (n=0) | n/a | 685 |
| **all TEST negative (apart)** | 0 | 8 | 0 | 8 | 0 | 0.0% | n/a | n/a |  | n/a (n=0) | n/a | 685 |

Precision 0.0% [0.0, 0.0], recall n/a, F1 n/a. Errors (FP + FN) 8 [6, 12]. FP per km² 8.0. Macro F1 n/a.

Median area error n/a, signed n/a (n=0). Centre offset median n/a. Length and width error (minimum-area rectangle of the outline against the OSM outline): n/a and n/a (n=0).

Pools of 400 m² or more (outlines): 0 of 0 found.

## TEST (held out: never used for tuning)

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Viseu, PT (TEST pt-rest) (1.00 km²) | 52 | 489 | 16 | 473 | 36 | 3.3% | 30.8% | 5.9% | dgt-ortos2025 | 18.3% (n=5) | -14.8% | 1062 |
| la Nucia, ES (TEST es) (4.00 km²) | 894 | 645 | 638 | 7 | 256 | 98.9% | 71.4% | 82.9% | pnoa | 30.2% (n=8) | -30.2% | 501 |
| Dammarie-les-Lys, FR (TEST fr) (4.00 km²) | 98 | 22 | 20 | 2 | 78 | 90.9% | 20.4% | 33.3% | ign-orthophotos | 2.3% (n=1) | -2.3% | 808 |
| Santa Fe Springs city, CA, US (TEST us) (4.00 km²) | 185 | 160 | 143 | 17 | 42 | 89.4% | 77.3% | 82.9% | esri-world-imagery | n/a (n=0) | n/a | 405 |
| Mirandela, PT (TEST pt-north) (4.00 km²) | 58 | 1873 | 19 | 1854 | 39 | 1.0% | 32.8% | 2.0% | dgt-ortos2025 | n/a (n=0) | n/a | 1001 |
| **all TEST** | 1287 | 3189 | 836 | 2353 | 451 | 26.2% | 65.0% | 37.4% |  | 26.1% (n=14) | -25.2% | 703 |

Precision 26.2% [21.9, 31.2], recall 65.0% [61.1, 68.6], F1 37.4% [32.6, 42.6]. Errors (FP + FN) 2804 [2394, 3253.0249999999996]. FP per km² 138.4. Macro F1 41.4%.

Median area error 26.1% [14.0, 32.0], signed -25.2% [-32.0, -5.9] (n=14). Centre offset median 0.30 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 8.4% and 9.6% (n=14).

Pools of 400 m² or more (outlines): 1 of 1 found (recall 100.0%).

## TEST hard (apart)

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Brixen - Bressanone, IT (TEST hard) (4.00 km²) | 20 | 11 | 3 | 8 | 17 | 27.3% | 15.0% | 19.4% | esri-world-imagery | 35.0% (n=1) | -35.0% | 457 |
| **all TEST hard (apart)** | 20 | 11 | 3 | 8 | 17 | 27.3% | 15.0% | 19.4% |  | 35.0% (n=1) | -35.0% | 457 |

Precision 27.3% [0.0, 57.1], recall 15.0% [0.0, 33.3], F1 19.4% [0.0, 37.9]. Errors (FP + FN) 25 [18, 32]. FP per km² 2.0. Macro F1 19.4%.

Median area error 35.0% [35.0, 35.0], signed -35.0% [-35.0, -35.0] (n=1). Centre offset median 0.64 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 9.9% and 32.6% (n=1).

Pools of 400 m² or more (outlines): 0 of 2 found (recall 0.0%).

## TEST by stratum

| stratum | labels | TP | FP | FN | precision | recall | F1 |
|---|--:|--:|--:|--:|--:|--:|--:|
| pt-rest | 52 | 16 | 473 | 36 | 3.3% | 30.8% | 5.9% [1.3, 13.3] |
| es | 894 | 638 | 7 | 256 | 98.9% | 71.4% | 82.9% [79.4, 86.0] |
| fr | 98 | 20 | 2 | 78 | 90.9% | 20.4% | 33.3% [21.8, 44.4] |
| us | 185 | 143 | 17 | 42 | 89.4% | 77.3% | 82.9% [77.2, 87.7] |
| pt-north | 58 | 19 | 1854 | 39 | 1.0% | 32.8% | 2.0% [1.1, 3.1] |

## Threshold sweep (micro-averaged)

| threshold | DEV P | DEV R | DEV F1 | DEV-2 P | DEV-2 R | DEV-2 F1 | GOLD P | GOLD R | GOLD F1 | TEST P | TEST R | TEST F1 |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 0.30 | 19.4% | 63.2% | 29.7% | 36.3% | 70.7% | 47.9% | 81.1% | 66.3% | 73.0% | 27.1% | 77.0% | 40.1% |
| 0.35 | 19.4% | 63.0% | 29.6% | 36.3% | 70.5% | 48.0% | 81.0% | 65.9% | 72.7% | 27.1% | 76.8% | 40.1% |
| 0.40 | 19.4% | 62.8% | 29.6% | 36.6% | 70.3% | 48.2% | 80.7% | 64.9% | 71.9% | 27.1% | 76.7% | 40.0% |
| 0.45 | 19.2% | 61.1% | 29.2% | 37.2% | 69.5% | 48.5% | 81.4% | 63.2% | 71.1% | 27.0% | 75.5% | 39.8% |
| 0.50 | 19.1% | 55.8% | 28.5% | 38.5% | 67.2% | 49.0% | 83.1% | 58.8% | 68.9% | 26.9% | 72.0% | 39.2% |
| 0.55 | 20.7% | 48.1% | 28.9% | 40.1% | 61.6% | 48.6% | 87.8% | 52.9% | 66.1% | 26.2% | 65.0% | 37.4% |
| 0.60 | 22.1% | 39.3% | 28.3% | 43.4% | 53.2% | 47.8% | 94.0% | 46.0% | 61.8% | 24.8% | 55.4% | 34.3% |
| 0.65 | 24.3% | 33.7% | 28.3% | 49.3% | 46.4% | 47.8% | 94.8% | 37.9% | 54.1% | 22.9% | 45.0% | 30.4% |
| 0.70 | 25.0% | 26.4% | 25.6% | 55.1% | 35.5% | 43.2% | 96.0% | 25.1% | 39.8% | 20.0% | 32.7% | 24.9% |
| 0.75 | 23.4% | 17.4% | 19.9% | 58.4% | 23.0% | 33.0% | 95.4% | 13.0% | 22.8% | 14.4% | 17.8% | 15.9% |
| 0.80 | 22.3% | 10.0% | 13.8% | 57.9% | 11.1% | 18.6% | 93.3% | 2.9% | 5.7% | 9.0% | 6.9% | 7.8% |

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
| Mirandela, PT (TEST pt-north) | TEST | blind | 58 | 0 | 55 | 40 | 0 | 1406 (17 without imagery) |

## Errors, automatic split

| area | FP unlabelled | FP duplicate | FN below threshold | FN partial overlap | FN not detected |
|---|--:|--:|--:|--:|--:|
| Vilamoura, PT | 48 | 1 | 16 | 4 | 17 |
| Scottsdale, AZ, US | 10 | 0 | 1 | 1 | 23 |
| Odemira greenhouses, Alentejo, PT | 128 | 0 | 0 | 0 | 0 |
| Puyricard, Aix-en-Provence, FR | 288 | 1 | 7 | 1 | 24 |
| Balma, Toulouse, FR | 2 | 1 | 23 | 0 | 50 |
| Braga, PT | 421 | 0 | 30 | 3 | 54 |
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
| Dunkerque, FR (TEST negative) | 8 | 0 | 0 | 0 | 0 |
| Viseu, PT (TEST pt-rest) | 473 | 0 | 19 | 1 | 16 |
| la Nucia, ES (TEST es) | 7 | 0 | 95 | 1 | 160 |
| Dammarie-les-Lys, FR (TEST fr) | 2 | 0 | 11 | 0 | 67 |
| Santa Fe Springs city, CA, US (TEST us) | 17 | 0 | 14 | 1 | 27 |
| Brixen - Bressanone, IT (TEST hard) | 8 | 0 | 1 | 0 | 16 |
| Mirandela, PT (TEST pt-north) | 1854 | 0 | 16 | 1 | 22 |

## Where undetected pools were lost (core pipeline)

For every missed label with no detection on it, the first pipeline stage that drops it: rerun with that stage relaxed, see whether the pool appears.

| stage | DEV | DEV-2 | GOLD | TEST |
|---|--:|--:|--:|--:|
| colour gate: pale water (low saturation) | 82 | 65 | 64 | 0 |
| colour gate: dull green or grey water | 29 | 66 | 3 | 0 |
| texture ceiling (and low confidence) | 24 | 11 | 20 | 0 |
| colour gate: turquoise-green water (green above blue) | 9 | 24 | 10 | 0 |
| texture ceiling | 6 | 6 | 15 | 0 |
| colour gate: dark water | 2 | 10 | 10 | 0 |
| colour gate: deep blue water (hue above the band) | 10 | 6 | 2 | 0 |
| size/shape filter or merger | 4 | 0 | 11 | 0 |
| mask cleanup (pixels pass, shape lost) | 2 | 3 | 2 | 0 |
| colour gate: no pixels | 0 | 0 | 3 | 0 |
