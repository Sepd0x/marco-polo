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
3. **Features** (`features.ts`). 47 numbers per candidate: colour of the
   shape, of a ring 1 to 3 px around it (coping, deck) and of a ring 4 to
   10 px (garden, roof, road), shape and size, edge contrast, texture, and the
   brightness and saturation of the tile.
4. **Score** (`model.ts`). 300 gradient-boosted trees and a small network
   (32 and 16 units) score each candidate; the average goes through an
   isotonic calibration per imagery family. The result is the confidence.
   Thresholds: 0.40 for DGT, IGN and Esri, 0.50 for PNOA. Of overlapping
   candidates the best one stays.
5. **Measure** (`learned.ts`, `measure.ts`). The area is the mask grown by one
   pixel ring, and the outline is traced on that same shape. Length and width
   come from the minimum-area rectangle of the outline, or are "not measured"
   when the shape is cut by the edge of the imagery, joined from parts, or
   fills less than 0.6 of its rectangle.

The model is [`packages/core/models/pool-v2.json`](../packages/core/models)
(80 KB gzip, credits in `ATTRIBUTION.md`). [`tools/train`](../tools/train)
trains, calibrates and reports it.

## Measured

[`packages/eval`](../packages/eval): frozen labels, each zone on the imagery
the product scans there, 95% block bootstrap intervals. DEV zones are scored
with a calibration fitted without them; DEV-2 ran once, with the final model.

| | v1 at 0.55 | v2 |
|---|--:|--:|
| F1, DEV | 29.0% [24.4, 34.0] | 73.7% [69.3, 78.0] |
| F1, DEV-2 | 48.6% [45.0, 52.7] | 74.2% [70.4, 77.6] |
| F1, GOLD | 66.1% [60.0, 71.2] | 84.3% [80.9, 87.2] |
| false positives per km², DEV | 162.9 | 23.4 |
| median area error, DEV (signed) | 23.3% (-17.0%) | 23.0% (-10.0%) |
| median area error, DEV-2 (signed) | 26.3% (-22.0%) | 29.9% (-23.4%) |

- Candidates reach 426 of the 452 DEV pools (0.942).
- Five training seeds: DEV F1 73.7% on average, standard deviation 2.1.
- Tile borders cost at most 1 pp of recall on the gold against scoring the
  whole area as one image.
- Time per request in a web worker of the production build, p95, one core of
  an AMD Ryzen AI 9 365: 126 ms (Chromium) and 127 ms (Firefox) for a 512 px
  DGT request, 42.5 and 43 ms for a 256 px tile. Targets: 150 and 50 ms.
- One pixel of boundary is 17.6% of the median labelled pool at these
  resolutions. The area targets (median error 15%, signed within 5%) are not
  met.

## Limits

- Covered pools, pools under trees and empty pools are missed. The benchmark
  ignores covered and hidden ones on the imagery where they are covered.
- Training used five zones in Portugal, Spain and France, imaged in spring
  and summer, and no Esri imagery. On Esri the threshold rests on one DEV
  zone, Scottsdale, where v2 is not better than v1.
- Blue cars, painted courts and teal roofs still pass at times.
- With the pixel ring the width reads wide, by about 8% (median) on DEV.

## v1

A per-pixel colour gate in HSV and RGB, morphology, shape and size filters, a
hand-weighted confidence and a merger that joins fragments across tile edges
(`detector.ts`, `merger.ts`). It is the baseline of every comparison above.
