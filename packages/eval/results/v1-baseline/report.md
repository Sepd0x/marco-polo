# Benchmark: v1 baseline

- detector: `v1` (packages/core detectTile + DetectionMerger, default options)
- confidence threshold: 0.55
- imagery: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` at z19
- labels: OpenStreetMap `leisure=swimming_pool` (ODbL) plus hand-checked additions, see `packages/eval/README.md`
- commit: 1c4dc76, run 2026-10-07

A detection is a hit when its centre falls inside a label or its box overlaps the label box with IoU ≥ 0.3; each label is matched once. Precision is over detections, recall over labels. Area error compares the detected area with the OSM polygon area, over hits on OSM polygons only (points and hand-drawn labels have no trustworthy area); "signed" below zero means the detector under-measures. Time is detector CPU time per km² of scanned area, tiles already decoded.

## DEV

| area | labels | detections | TP | FP | FN | precision | recall | F1 | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| Vilamoura, PT (1.00 km²) | 69 | 58 | 36 | 22 | 33 | 62.1% | 52.2% | 56.7% | 26.7% (n=35) | -24.0% | 444 |
| Scottsdale, AZ, US (0.56 km²) | 78 | 63 | 54 | 9 | 24 | 85.7% | 69.2% | 76.6% | 30.6% (n=2) | +22.7% | 283 |
| Odemira greenhouses, Alentejo, PT (1.00 km²) | 0 | 1 | 0 | 1 | 0 | 0.0% | n/a | n/a | n/a (n=0) | n/a | 229 |
| Puyricard, Aix-en-Provence, FR (1.00 km²) | 99 | 68 | 62 | 6 | 37 | 91.2% | 62.6% | 74.3% | 34.7% (n=40) | -29.1% | 324 |
| Balma, Toulouse, FR (1.00 km²) | 65 | 17 | 16 | 1 | 49 | 94.1% | 24.6% | 39.0% | 42.6% (n=11) | +12.9% | 357 |
| **all dev** | 311 | 207 | 168 | 39 | 143 | 81.2% | 54.0% | 64.9% | 30.7% (n=88) | -23.8% | 331 |

Macro F1 (mean over areas): 61.6%.

## TEST (held out: never used for tuning)

| area | labels | detections | TP | FP | FN | precision | recall | F1 | median area error | signed | ms/km² |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| Marbella, ES (1.00 km²) | 150 | 149 | 114 | 35 | 36 | 76.5% | 76.0% | 76.3% | 31.4% (n=16) | -31.4% | 356 |
| Birre, Cascais, PT (0.56 km²) | 150 | 130 | 128 | 3 | 22 | 97.7% | 85.3% | 91.1% | 22.7% (n=6) | -22.7% | 352 |
| Santa Barbara de Nexe, Algarve interior, PT (1.00 km²) | 52 | 34 | 30 | 4 | 22 | 88.2% | 57.7% | 69.8% | 36.5% (n=2) | -36.5% | 250 |
| Castelnau-le-Lez, Montpellier, FR (1.00 km²) | 224 | 116 | 78 | 38 | 146 | 67.2% | 34.8% | 45.9% | 26.2% (n=75) | -14.1% | 303 |
| Arcadia, Phoenix, AZ, US (1.00 km²) | 182 | 142 | 125 | 18 | 57 | 87.3% | 68.7% | 76.9% | 61.4% (n=3) | -61.4% | 264 |
| **all test** | 758 | 571 | 475 | 98 | 283 | 82.8% | 62.7% | 71.4% | 30.1% (n=102) | -18.3% | 301 |

Macro F1 (mean over areas): 72.0%.

## Threshold sweep (micro-averaged)

| threshold | DEV P | DEV R | DEV F1 | TEST P | TEST R | TEST F1 |
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

"OSM coverage" is the share of pool labels OSM already had. Review "full": every window checked by eye and missed pools boxed by hand. Review "candidates": every unlabelled colour candidate checked plus a sample of windows, so pools no colour rule fires on can still be missing from the labels (recall there is an upper bound).

| area | split | review | pool labels | OSM points | hand-added | OSM coverage | ignored | tiles |
|---|---|---|--:|--:|--:|--:|--:|--:|
| Vilamoura, PT | dev | full | 69 | 0 | 3 | 95.7% | 19 | 342 |
| Scottsdale, AZ, US | dev | full | 78 | 3 | 72 | 7.7% | 14 | 196 |
| Odemira greenhouses, Alentejo, PT | dev | full | 0 | 0 | 0 | n/a | 0 | 342 |
| Puyricard, Aix-en-Provence, FR | dev | full | 99 | 0 | 38 | 61.6% | 24 | 420 |
| Balma, Toulouse, FR | dev | full | 65 | 0 | 17 | 73.8% | 46 | 441 |
| Marbella, ES | test | candidates | 150 | 104 | 26 | 82.7% | 37 | 361 |
| Birre, Cascais, PT | test | full | 150 | 0 | 142 | 5.3% | 35 | 225 |
| Santa Barbara de Nexe, Algarve interior, PT | test | full | 52 | 0 | 44 | 15.4% | 28 | 324 |
| Castelnau-le-Lez, Montpellier, FR | test | candidates | 224 | 0 | 6 | 97.3% | 91 | 400 |
| Arcadia, Phoenix, AZ, US | test | candidates | 182 | 162 | 14 | 92.3% | 43 | 324 |

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

| stage | DEV | TEST |
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

## Error taxonomy (by eye, from the galleries)

**False positives**

| category | count |
|---|--:|
| shadow or dark roof | 71 |
| sport court | 18 |
| sea or marina water | 16 |
| fragment or label misaligned | 9 |
| blue or teal object/roof | 8 |
| duplicate (fragment of a matched pool) | 5 |
| solar panels | 5 |
| vehicle or boat | 3 |
| imagery artefact | 1 |
| asphalt or road | 1 |

**False negatives**

| category | count |
|---|--:|
| in shadow or under trees | 118 |
| pale, lilac or low-saturation water | 69 |
| turquoise-green water | 64 |
| found below 0.55 | 60 |
| dark or shaded water | 51 |
| green or murky water | 30 |
| deep blue or navy water | 25 |
| merged with a neighbouring pool | 7 |
| clear water, missed | 2 |

