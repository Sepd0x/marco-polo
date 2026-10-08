# Benchmark: v1 @ 0.55, --source auto

- detector: `v1` (packages/core detectTile + DetectionMerger, default options), hash `57d77e98b36c`
- confidence threshold: 0.55
- imagery: `--source auto` (per zone below), z19 grid; 909 images read, manifest `194967472238`
- labels: frozen set `b77a7258c8a1`, see `packages/eval/README.md`; point rule v2
- commit: 69574c2, run 2026-10-08

A detection hits a polygon label when its centre falls inside it or the two boxes overlap with IoU >= 0.3. It hits a point label when its centre is within max(3 m, half the long side of its box) of the point and its area is at most max(4 x the median pool label of the zone, 150 m²). Each label is matched once. Precision is over detections, recall over labels. Brackets: 95% interval, block bootstrap (4 x 4 z19 tiles, 2000 replicates, seed 20261007). Area error compares the detected area with the OSM polygon, over hits on OSM polygons only; "signed" below zero means the detector under-measures. Time is detector CPU time per km², tiles already decoded.

## TEST (held out: never used for tuning)

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Viseu, PT (TEST pt-rest) (1.00 km²) | 52 | 442 | 16 | 426 | 36 | 3.6% | 30.8% | 6.5% | dgt-ortos2025 | 19.4% (n=5) | -16.5% | 671 |
| **all TEST** | 52 | 442 | 16 | 426 | 36 | 3.6% | 30.8% | 6.5% |  | 19.4% (n=5) | -16.5% | 671 |

Precision 3.6% [0.8, 8.7], recall 30.8% [13.2, 42.9], F1 6.5% [1.5, 14.3]. Errors (FP + FN) 462 [318.975, 625]. FP per km² 426.0. Macro F1 6.5%.

Median area error 19.4% [19.4, 19.4], signed -16.5% [-16.5, -16.5] (n=5). Centre offset median 0.99 m. Length and width error (minimum-area rectangle of the outline against the OSM outline): 3.3% and 11.3% (n=5).

## TEST negative (apart)

| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|
| Dunkerque, FR (TEST negative) (1.00 km²) | 0 | 11 | 0 | 11 | 0 | 0.0% | n/a | n/a | ign-orthophotos | n/a (n=0) | n/a | 550 |
| **all TEST negative (apart)** | 0 | 11 | 0 | 11 | 0 | 0.0% | n/a | n/a |  | n/a (n=0) | n/a | 550 |

Precision 0.0% [0.0, 0.0], recall n/a, F1 n/a. Errors (FP + FN) 11 [8, 14]. FP per km² 11.0. Macro F1 n/a.

Median area error n/a, signed n/a (n=0). Centre offset median n/a. Length and width error (minimum-area rectangle of the outline against the OSM outline): n/a and n/a (n=0).

## TEST by stratum

| stratum | labels | TP | FP | FN | precision | recall | F1 |
|---|--:|--:|--:|--:|--:|--:|--:|
| pt-rest | 52 | 16 | 426 | 36 | 3.6% | 30.8% | 6.5% [1.5, 14.3] |

## Threshold sweep (micro-averaged)

| threshold | TEST P | TEST R | TEST F1 |
|--:|--:|--:|--:|
| 0.30 | 6.5% | 65.4% | 11.8% |
| 0.35 | 6.5% | 65.4% | 11.8% |
| 0.40 | 6.5% | 65.4% | 11.8% |
| 0.45 | 6.0% | 59.6% | 10.9% |
| 0.50 | 4.9% | 46.2% | 8.8% |
| 0.55 | 3.6% | 30.8% | 6.5% |
| 0.60 | 2.0% | 15.4% | 3.6% |
| 0.65 | 1.4% | 9.6% | 2.5% |
| 0.70 | 1.0% | 5.8% | 1.7% |
| 0.75 | 0.4% | 1.9% | 0.7% |
| 0.80 | 0.0% | 0.0% | 0.0% |

## Labels per area

Review "full": every window checked by eye and missed pools boxed by hand. "candidates": every unlabelled colour candidate checked plus a sample of windows, so recall there is an upper bound. "blind": every window checked on clean imagery with nothing drawn, OSM merged afterwards. "gold-union": phase 0 gold, the union of what the methods proposed, checked by eye. "absent" are labels whose pool is not in this source's imagery, ignored here.

| area | role | review | pool labels | points | hand-added | ignored | absent | tiles |
|---|---|---|--:|--:|--:|--:|--:|--:|
| Viseu, PT (TEST pt-rest) | TEST | blind | 52 | 0 | 43 | 18 | 0 | 380 |
| Dunkerque, FR (TEST negative) | TEST | blind | 0 | 0 | 0 | 2 | 0 | 529 (13 without imagery) |

## Errors, automatic split

| area | FP unlabelled | FP duplicate | FN below threshold | FN partial overlap | FN not detected |
|---|--:|--:|--:|--:|--:|
| Viseu, PT (TEST pt-rest) | 426 | 0 | 18 | 1 | 17 |
| Dunkerque, FR (TEST negative) | 11 | 0 | 0 | 0 | 0 |
