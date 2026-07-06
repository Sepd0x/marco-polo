# How detection works

This document walks the full journey of a pixel from a satellite tile to a ranked,
geolocated pool — with the actual numbers the engine ships with and why they are
what they are. Everything here lives in [`packages/core/src/detect`](../packages/core/src/detect)
and is covered by unit tests plus a real-imagery tuning harness
([`packages/cli/src/dev/annotate.ts`](../packages/cli/src/dev/annotate.ts)).

## 1. The physical signature

Pool water is cyan from above for a physical reason: water absorbs red light
strongly, chlorinated pools are shallow with light (usually white/blue) liners, so
the reflected spectrum peaks between green and blue. In HSV terms that lands in a
narrow hue band around **170–205°** — a colour that natural terrain essentially
never produces at pool scale. Sea and lakes sit in similar hues but are darker,
greener, and *enormously* larger, which geometry handles later.

## 2. Per-pixel gate (`color.ts`)

A pixel counts as *possible water* when all of these hold:

| Check | Default | Rejects |
|---|---|---|
| hue ∈ [148°, 215°] | broad band | vegetation (~100°), warm roofs, plain blue roofs (>215°) |
| value ≥ 0.24 | brightness floor | deep shadow |
| saturation ≥ 0.34, **or** saturation ≥ 0.20 *and* value ≥ 0.5 | joint gate | asphalt & shadow haze |
| blue − red ≥ 10 (0–255) | channel test | grey/warm surfaces that sneak into the hue band |
| green − red ≥ −8 | channel test | purple-ish artefacts |
| blue − green ∈ [−12, 70] | turquoise band | photovoltaic blue (strongly blue-dominant) and foliage (strongly green-dominant) |

The **joint saturation/brightness gate** is the load-bearing rule, found by tuning
against real desert imagery (Scottsdale, AZ): pale sunlit pools are *bright* with
modest saturation; deep-water pools are *dark but strongly saturated*; blue-grey
asphalt, wet roads and building shadows are dark **and** weakly saturated — and
only that combination is rejected. Before this rule, roads produced dozens of
speckle detections per suburb tile; after it, zero.

A second, tighter band — hue ∈ [168°, 205°], saturation ≥ 0.34 — defines the
*strict* "unmistakably pool" signature. It isn't used to reject pixels; it feeds
the confidence score (§6).

## 3. Cleanup and components (`mask.ts`)

The binary mask goes through morphological **open** (erode→dilate, killing isolated
speckle like teal car roofs) then **close** (dilate→erode, sealing holes from sun
glint, steps and lane ropes). One subtlety: erosion treats out-of-image neighbours
as *inside*. A shape touching the tile edge must keep touching it after cleanup,
or the cross-tile merger (§5) loses the only signal that the shape continues in
the next tile — this was a real bug caught by a unit test.

8-connected component labelling (iterative flood fill) then yields candidate blobs
with pixel counts, bounding boxes, centroids and edge-touch flags.

## 4. Shape & size filters (`detector.ts`)

Geometry is computed in metres using the Web Mercator ground resolution at the
tile's latitude — at z19 a pixel is ~0.30 m at the equator, ~0.24 m at 37° N:

- **< 12 px** → noise, dropped before any geographic reasoning.
- **Interior blobs** (not touching a tile edge) must be **3–2000 m²** — from hot
  tub to resort lagoon. Larger is a pond/lake/sea.
- **Edge-touching blobs stay candidates regardless of size** (they may be pool
  fragments) unless they exceed 4× the ceiling, which no pool fragment can.
- Elongated interior shapes (aspect > 8, or bbox fill < 0.22) are canals, ditches
  and painted lanes — dropped.

Each surviving component gets an outline: boundary edges on the pixel lattice are
chained into closed loops (deterministic, single-pixel-safe, hole-safe — chosen
over Moore tracing precisely for those edge cases), then simplified with
Douglas-Peucker at ~1.2 px tolerance and projected to WGS84.

### Surface texture — water's second signature

Colour alone can't separate a pool from a cyan-tinged hedge or a glinting
photovoltaic array. Smoothness can: **water is glassy**, and textured surfaces
aren't. For every component the detector measures the mean forward-difference
brightness gradient, sampled *only* where a pixel's full 4-neighbourhood shares
the component's label (otherwise the shape's own edge contaminates the score).
Forward differences matter — central differences straddle one-pixel-period seams
(exactly what panel grids look like) and read them as smooth.

Measured on reference imagery, real pools score **0.02–0.125** (US imagery is
sharper and scores higher); vegetation and panel arrays score far above. The
hard ceiling is **0.15**, and everything above ~0.10 pays a growing confidence
penalty — so borderline-rough detections survive but visibly rank as doubtful.

## 5. Cross-tile merging (`merger.ts`)

Tiles are analysed independently, so a pool on a tile boundary appears as two or
four fragments. The merger:

1. indexes clusters by the tiles they touch;
2. when a new edge-touching fragment arrives, probes the 8 neighbouring tiles for
   clusters whose geographic bbox comes within **2.5 px** (converted to metres at
   that latitude) and merges transitively;
3. re-emits merged detections as live `update` events — the UI's ranking visibly
   reshuffles when two fragments become one big pool;
4. reclassifies clusters that outgrow the pool ceiling as open water (`remove`);
5. tracks **truncation**: a detection is `truncated` only while some touched edge
   borders an unscanned tile or leaves the scan area entirely. Truncated areas are
   honest lower bounds, and the UI marks them.

Small fragments (< 8 m²) are *withheld*, not discarded — if their merged sum
clears the floor they emit late; if not, they never existed.

## 6. Confidence

Each detection is scored 0–1 as a weighted blend:

```
0.30 · strictRatio            fraction of pixels in the strict pool band
0.18 · hueScore               gaussian around 189° (σ = 26°)
0.15 · smoothScore            surface texture (glassy → 1, rough → 0)
0.14 · satScore               saturation above the floor
0.12 · shapeScore             bbox fill ratio (compactness)
0.11 · sizeScore              plateau at 10–150 m², tapering outside
× 0.9  if truncated
× 0.78 if rough AND non-compact (texture > 0.10 and fill < 0.50)
```

The final multiplier targets the dominant false-positive signature — solar-panel
edges, blue tarps and roof furniture that clear the colour gate but are both
textured *and* fail to fill their bounding box. Neither condition alone condemns
a real pool (compact rough pools and smooth sprawling ones both exist), so it is
a soft penalty, not a hard reject. The web UI's default display threshold is
**0.55**; borderline real pools sit just under it and reappear the moment you
lower the slider.

The weights encode a simple prior: **colour evidence dominates**, shape and size
adjust. In validation, unambiguous pools score 0.7–0.96; the classic false
positives — teal-coated roofs, blue tarps, playground surfaces — land at 0.35–0.55
because their saturation or strict-band ratio betrays them. The UI's default
display threshold (0.45, adjustable) hides most of them while keeping borderline
real pools inspectable: lower the slider and see everything the engine saw.

## 7. Known limitations (by design, documented rather than hidden)

- **Covered, drained, indoor and heavily-shaded pools** don't reflect the
  signature and are missed.
- **Green (algae) pools** drift out of the hue band. Fixable with a second band at
  the cost of vegetation false positives — a good `thresholds` experiment.
- **Teal architecture** (roofs, courts) can pass the colour gate; smooth metal
  roofs even pass the texture gate. Confidence and the size filter contain the
  damage, but don't eliminate it.
- **Imagery vintage** varies by region; a pool built last year may not exist in
  the tiles yet.
- Areas are pixel-count × resolution² — accurate to roughly ±10–15% on clean
  imagery, worse when trees overhang the water.

## 8. Tuning it yourself

```bash
cd packages/cli
npx tsx src/dev/annotate.ts 33.594 -111.926 3 19 out.png
```

fetches a 3×3 tile grid around a coordinate, overlays the raw mask (orange), the
cleaned mask (magenta) and detection boxes coloured by strict-ratio, and prints
per-detection stats — the exact loop used to arrive at the defaults above. Every
threshold is a plain field on `DEFAULT_THRESHOLDS` / `DEFAULT_DETECTOR_OPTIONS`.
