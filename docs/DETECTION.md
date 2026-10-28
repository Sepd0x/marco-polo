# How detection works

The code is in [`packages/core/src/detect`](../packages/core/src/detect). Two
detectors sit behind the same `Detector` seam: v1, the colour rules of the
first version, kept as the baseline, and v2, a learned scorer over candidates.
The scorer's model has had three versions; the one shipped since 28 October
2026 is v3, still in `pool-v2.json`.

## v2

1. **Window.** Each scan tile is read with a halo from its neighbours: 48 px
   around a 256 px tile, 96 px around a 512 px DGT request. A shape is
   reported only by the tile that holds its centroid. A pool longer than
   about twice the halo (some 20 m at z19) can be cut by one window and seen
   whole, or at another colour level, by its neighbour, so two tiles may both
   report it; the merger keeps the better scored of two detections from
   different tiles whose boxes share more than 0.3 of the smaller one, the
   rule the detector applies inside a window.
2. **Candidates** (`candidates.ts`). Six colour levels: the v1 gate, two looser
   gates for pale, greenish and shaded water, a strict bright gate that
   separates a pool from a blue shadow, a green band and an olive band for
   algae, the last two with a shape test. Olive blobs that fill less than 0.6
   of their box are also cut at their brightness threshold (Otsu), which
   separates a green pool from the lawn or tree it touches. Cleaned
   components from 3 to 2000 m² that pass their level are the candidates.
3. **Features** (`features.ts`). 56 numbers per candidate: colour of the
   shape, of a ring 1 to 3 px around it (coping, deck) and of a ring 4 to
   10 px (garden, roof, road), shape and size, edge contrast, texture, the
   brightness and saturation of the tile, and for courts and shadows: the
   smallest rotated rectangle (fill, length, width, distance to padel and
   tennis court sizes), bright grey pixels inside the shape (painted lines),
   enclosed holes, the deck share of the weakest side, and how much brighter
   one side of the surroundings is than another.
4. **Score** (`model.ts`). 300 gradient-boosted trees and a small network
   (32 and 16 units) score each candidate; the average goes through an
   isotonic calibration per imagery family. The result is the confidence.
   Each family's threshold is the one with the best F1 out of fold over its
   calibration zones: 0.309 for DGT, 0.556 for IGN. PNOA has one calibration
   zone, so it uses the pooled calibration and its threshold, 0.385. Of
   overlapping candidates the best one stays.
5. **Measure** (`learned.ts`, `measure.ts`). The area is the mask grown by one
   pixel ring plus half of the next ring, whose pixels mix water and coping.
   The outline is traced on the one-ring shape. Length and width come from
   the minimum-area rectangle of the outline, or are "not measured" when the
   shape is cut by the edge of the imagery, joined from parts, or fills less
   than 0.6 of its rectangle.

The model is [`packages/core/models/pool-v2.json`](../packages/core/models)
(84 KB gzip, credits in `ATTRIBUTION.md`). [`tools/train`](../tools/train)
trains, calibrates and reports it. Besides the blind-reviewed windows of the
five training zones, it learns from the sports pitches OpenStreetMap maps
around them and in two zones kept for pitches only (Maia, Lyon): a candidate
on a pitch is a negative, one on an outdoor OpenStreetMap pool next to it is
a positive. Only 19 of the 3709 label outlines reach 400 m², and the v2
model read any large size as "not a pool"; v3 also learns from copies of
candidates of 40 to 400 m² whose size features are scaled to 400 to 1800 m².

**Esri.** Esri's terms forbid using its data to train systems. No Esri
imagery trains or calibrates the model: the training and calibration zones
are all on DGT, PNOA or IGN, and the tools refuse an Esri zone. Esri stays a
source the product scans. Its detections read the pooled calibration of the
open sources, with a threshold of their own, 0.385, fixed to the pooled
threshold and never fitted on Esri. The benchmark still scores the Esri
zones.

## Measured

[`packages/eval`](../packages/eval): frozen labels, each zone on the imagery
the product scans there, 95% block bootstrap intervals. DEV zones are scored
with a calibration fitted without them (the Esri DEV zone with the shipped
one, which never saw it). DEV-2 is never used to tune or calibrate; it is
scored at each model freeze. v1 and v3 from `results/v3`, v2 from
`results/v2`.

| | v1 at 0.55 | v2 | v3 |
|---|--:|--:|--:|
| F1, DEV | 28.9% [24.6, 33.9] | 79.9% [76.3, 83.1] | 80.6% [77.1, 83.7] |
| F1, DEV-2 | 48.6% [45.0, 52.7] | 74.6% [71.0, 77.9] | 74.3% [70.6, 77.7] |
| F1, GOLD | 66.1% [60.0, 71.2] | 85.4% [82.4, 87.8] | 85.5% [82.6, 88.1] |
| F1, TEST | 37.4% [32.6, 42.6] | 89.6% | 89.2% [87.3, 90.8] |
| false positives per km², DEV | 161.8 | 14.0 | 14.0 |
| median area error, DEV (signed) | 23.3% (-17.0%) | 25.5% (-12.2%) | 23.8% (-2.0%) |
| median area error, DEV-2 (signed) | 26.3% (-22.0%) | 27.9% (-22.2%) | 24.1% (-14.5%) |
| median area error, TEST (signed) | 26.1% (-25.2%) | 18.6% (-15.2%) | 14.6% (-8.1%) |
| pools of 400 m² or more found, large-pool set | 37 of 40 | 14 of 40 | 29 of 40 |

- TEST run 2 ([`results/TEST_RUN_2.md`](../packages/eval/results/TEST_RUN_2.md)):
  P1, P2, P3, P5, P7, P8 and P9 pass; P4 (Dunkerque, 31 false detections per
  km² where v1 has 8) and P6 (signed area -8.1%, target within 5%) fail.
- Large pools: `labels/large-pools.geojson`, 40 outlines of 400 m² or more
  in seven areas on DGT, PNOA and IGN, none near a TEST zone, each scanned
  on its own imagery (`eval large`). The set holds only large pools, so it
  gives recall, not precision. By source, v3: PNOA 11 of 13, IGN 6 of 7,
  DGT 12 of 20.
- Duplicates (a second detection on a pool already matched): DEV 15 to 7,
  DEV-2 22 to 12, GOLD 8 to 2.
- Five training seeds, DEV out of fold: 80.6, 80.6, 81.6, 81.0, 81.8. Seed 0
  ships (fixed in the recipe).
- Painted courts: of 200 OpenStreetMap tennis, padel and basketball pitches
  in Coimbra (DGT), Bordeaux (IGN) and Las Vegas (Esri), none of them in
  training, the first v2 model put a pool on 33 and the second on 0. Not
  measured again for v3.
- Tile borders cost at most 1 pp of recall on the gold against scoring the
  whole area as one image (P8).
- Time per request in a web worker: [`tests/bench/RESULTS.md`](../tests/bench/RESULTS.md).

## Limits

- v1 still finds more of the large pools (37 of 40 against 29). A pool cut
  by the window is scored and measured on the part that window sees.
- Area: v3 still reads pools smaller than OSM on DEV-2 and TEST (signed
  -14.5% and -8.1%). The median error target (15%) is met on TEST, not on
  DEV or DEV-2.
- False positives in hard PNOA areas are not addressed by this round: parts
  of painted courts, shadows, blue roofs and objects, cars. In Dunkerque
  (IGN, no pools) v3 has more false detections than v2.
- Green, dark or very bright pools, and pools inside shadows, are often
  missed. Covered pools, pools under trees and empty pools are missed. The
  benchmark ignores covered and hidden ones on the imagery where they are
  covered.
- Training used five zones in Portugal, Spain and France, imaged in spring
  and summer, and no Esri imagery. On the Esri hard TEST zone (Brixen, the
  Alps) v3 finds 2 of 20 pools.
- Width: median error 20.4% on DEV (n=182). Whether it reads wide or narrow
  is not measured.
- A detection of 10 m² or less is tagged a hot tub (`hotTubMaxM2` in
  `merger.ts`). Size is the only test; the app shows them unless "Include hot
  tubs" is off.

## v1

A per-pixel colour gate in HSV and RGB, morphology, shape and size filters, a
hand-weighted confidence and a merger that joins fragments across tile edges
(`detector.ts`, `merger.ts`). It is the baseline of every comparison above.
