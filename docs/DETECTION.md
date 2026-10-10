# How detection works

The code is in [`packages/core/src/detect`](../packages/core/src/detect). Two
detectors sit behind the same `Detector` seam: v1, the colour rules of the
first version, kept as the baseline, and v2, a learned scorer over candidates.

## v2

1. **Window.** Each scan tile is read with a halo from its neighbours: 48 px
   around a 256 px tile, 96 px around a 512 px DGT request. A shape is
   reported only by the tile that holds its centroid, so a pool on a tile edge
   comes out once and whole.
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
   DEV zones: 0.50 for DGT, 0.55 for IGN. Esri and PNOA have one calibration
   zone each, so they use the pooled calibration and its threshold, 0.43. Of
   overlapping candidates the best one stays.
5. **Measure** (`learned.ts`, `measure.ts`). The area is the mask grown by one
   pixel ring, and the outline is traced on that same shape. Length and width
   come from the minimum-area rectangle of the outline, or are "not measured"
   when the shape is cut by the edge of the imagery, joined from parts, or
   fills less than 0.6 of its rectangle.

The model is [`packages/core/models/pool-v2.json`](../packages/core/models)
(84 KB gzip, credits in `ATTRIBUTION.md`). [`tools/train`](../tools/train)
trains, calibrates and reports it. Besides the blind-reviewed windows of the
five training zones, it learns from the sports pitches OpenStreetMap maps
around them and in two zones kept for pitches only (Maia, Lyon): a candidate
on a pitch is a negative, one on an outdoor OpenStreetMap pool next to it is
a positive.

## Measured

[`packages/eval`](../packages/eval): frozen labels, each zone on the imagery
the product scans there, 95% block bootstrap intervals. DEV zones are scored
with a calibration fitted without them. DEV-2 is never used to tune or
calibrate; it is scored at each model freeze.

| | v1 at 0.55 | v2 |
|---|--:|--:|
| F1, DEV | 28.9% [24.6, 33.8] | 79.9% [76.3, 83.1] |
| F1, DEV-2 | 48.6% [45.0, 52.7] | 74.6% [71.0, 77.9] |
| F1, GOLD | 65.8% [59.8, 71.0] | 85.4% [82.4, 87.8] |
| false positives per km², DEV | 162.0 | 14.0 |
| median area error, DEV (signed) | 23.3% (-17.0%) | 25.5% (-12.2%) |
| median area error, DEV-2 (signed) | 26.3% (-22.0%) | 27.9% (-22.2%) |

- Painted courts: of 200 OpenStreetMap tennis, padel and basketball pitches
  in Coimbra (DGT), Bordeaux (IGN) and Las Vegas (Esri), none of them in
  training, the previous v2 model put a pool on 33 and this one on 0.
- Against the previous v2 model with the same calibration rule: DEV F1
  +1.5 pp [-0.9, +3.6], DEV-2 -0.6 pp [-1.5, +0.3], GOLD +1.1 pp [-0.0, +2.2],
  GOLD errors 0.93 times [0.87, 0.99].
- The Balma labels were completed by a blind review on IGN on 10 Oct 2026
  (66 pools were missing); every number above uses the new labels.
- Tile borders cost at most 1 pp of recall on the gold against scoring the
  whole area as one image (P8).
- Time per request in a web worker (production build, Chromium 141, Xeon
  2.1 GHz, 4 cores): p95 236.7 ms per 512 px DGT request and 57.1 ms per
  256 px tile, both above the targets of 150 and 50 ms
  ([`tests/bench/RESULTS.md`](../tests/bench/RESULTS.md)).
- Not measured again: the candidate ceiling and the spread over five training
  seeds.
- At these resolutions, one pixel along the boundary is a large share of a
  small pool's area. The area targets (median error 15%, signed within 5%) are
  not met.

## Limits

- Covered pools, pools under trees and empty pools are missed. The benchmark
  ignores covered and hidden ones on the imagery where they are covered.
- Training used five zones in Portugal, Spain and France, imaged in spring
  and summer, and no Esri imagery. Esri has one DEV zone, Scottsdale, where
  v2 is not better than v1.
- Blue cars, solar panels and teal roofs still pass at times.
- Width: median error 19.5% on DEV (n=170, `results/v2/report.md`). Whether
  it reads wide or narrow is not measured.
- A detection of 10 m² or less is tagged a hot tub (`hotTubMaxM2` in
  `merger.ts`). Size is the only test; the app shows them unless "Include hot
  tubs" is off.

## v1

A per-pixel colour gate in HSV and RGB, morphology, shape and size filters, a
hand-weighted confidence and a merger that joins fragments across tile edges
(`detector.ts`, `merger.ts`). It is the baseline of every comparison above.
