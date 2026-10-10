# Architecture

Marco Polo is a monorepo with one rule: **everything that reasons about the world
lives in `@marco-polo/core`**, and everything else is a thin host around it.

```
┌────────────────────────────────────────────────────────────────────┐
│                        @marco-polo/core                            │
│  pure TypeScript · zero dependencies · no DOM, no Node APIs        │
│                                                                    │
│  geo/       Web Mercator tile math, pixel↔WGS84, geodesic areas    │
│  scan/      polygon→tile plans, serpentine & spiral traversals     │
│  detect/    HSV water mask → morphology → components → contours    │
│  merge/     cross-tile fragment merger (dedupe + truncation)       │
│  rank/      largest-first ranking                                  │
└──────────────────────┬──────────────────────┬──────────────────────┘
                       │                      │
        ┌──────────────▼───────────┐   ┌──────▼──────────────────┐
        │        apps/web          │   │      packages/cli       │
        │  React + MapLibre GL     │   │  Node scanner           │
        │  Web Worker pool runs    │   │  jpeg-js/pngjs decode   │
        │  detect() off-thread     │   │  disk tile cache        │
        │  Cache API tile cache    │   │  GeoJSON/CSV output     │
        │  IndexedDB scan archive  │   └─────────────────────────┘
        └──────────────────────────┘
```

## Why client-side?

The pivotal early finding: the default imagery endpoint (Esri World Imagery) serves
tiles with `Access-Control-Allow-Origin: *`, which means satellite pixels are
readable from a browser canvas. That single fact makes the strongest architecture a
**static web app**:

- **Zero backend.** Nothing to deploy, secure, or pay for; the demo runs on GitHub
  Pages. Your drawn areas and scan results never leave your machine.
- **The user's browser is the rate limiter.** Each visitor fetches tiles for their
  own scan at a capped rate (default 5 tiles/s), exactly as a map client would while
  panning. There is no central scraper.
- **Workers keep 60 fps.** Tile decoding (`createImageBitmap`) and the CV pipeline
  run in a `Worker` pool sized to `hardwareConcurrency`, so the map stays fluid while
  scanning.

The CLI exists because a survey tool should also be scriptable and reproducible.
It runs the same engine and gives the same numbers.

## Scan lifecycle (web)

```
draw polygon ──► buildScanPlan(polygon, zoom, order)        [core]
                     │  tiles that intersect the polygon,
                     │  sequenced for spatial locality
                     ▼
             ScanController.start()
                     │  timer tick (1000/rate ms) → dispatch ≤1 tile
                     ▼
        fetchTileBlob() ──► Cache API hit? ──► createImageBitmap()
                     │                              │ transfer
                     ▼                              ▼
             tile fails: retry ×3,          WorkerPool.detect()
             then count + move on                   │ detectTile() [core]
                                                    ▼
                              TileDetection[] + RGBA thumbnail crops
                                                    │
                                                    ▼
                              DetectionMerger.addTileDetections()   [core]
                                    │ add / update / remove events
                                    ▼
                              zustand store ──► map overlays, ranked
                                    │           panel, telemetry
                                    ▼
                              on completion: finalize() → IndexedDB archive
```

Pause stops the dispatch timer (in-flight tiles finish); abort additionally cancels
in-flight fetches via `AbortController` and finalizes with partial results. Those
are real results, not a truncated file format.

## The merger (dedupe) in one paragraph

Every detection that touches a tile edge *might* continue in the neighbour tile. The
merger keeps clusters indexed by tile; when a new fragment arrives it probes the 8
neighbouring tiles for clusters whose geographic bbox comes within ~2.5 px (in metres
at that latitude/zoom) and joins them, transitively. Merged detections re-emit as
`update` events (the UI reorders the ranking live); a cluster that grows past the
plausible-pool ceiling is reclassified as open water and removed. A cluster stays
`truncated: true` only while a touched edge borders a tile that is unscanned or
outside the plan. That makes "this measurement is a lower bound" a fact, not a guess.

## State & rendering

- **zustand** store with `subscribeWithSelector`: React components subscribe to
  slices; the MapLibre layer managers (`ScanOverlay`, `DetectionMarkers`,
  `FrameOverlay`) subscribe imperatively, so the map path never triggers a React
  re-render. The scale bar and the cursor in the data strip are written straight
  into the DOM from bus events for the same reason.
- The tile grid uses feature state per tile; detection outlines are GeoJSON with
  data-driven paint (magenta over a dark casing). Markers are GL layers: a dot for
  the overview and the rank number, an image drawn on a canvas in the interface
  font and placed as text, so it needs no glyph server.
- The map is locked north up and flat. `FrameOverlay` draws the survey frame over
  it (neat line, fiducials, graduation, coordinates, réseau) and recomputes it on
  every move; the coordinates in the margin are only true without rotation.
- Detection **thumbnails are real pixels**: the worker crops the detection bbox from
  the tile it analysed and ships the RGBA buffer back (transferable), where it
  becomes a data-URL for the ranked list and the archive.

## Trade-offs made deliberately

| Decision | Cost | Why it wins |
|---|---|---|
| Classical CV instead of a learned model | misses camouflaged/indoor pools; some teal-roof false positives | zero setup, explainable, runs anywhere, tunable in the open; a `Detector`-shaped seam is left for an ONNX plug-in |
| Client-side scanning | scan lifetime tied to the tab | no backend, no keys, privacy by construction, deployable as static files |
| Area from pixel count × resolution² | ±10 to 15% vs. survey-grade | honest, fast, and correct *in expectation*; confidence exposes the rest |
| Rank numbers as canvas images in symbol layers | a small image per rank and label style (box, halo, open) | no cap on markers, no glyph server dependency, same font as the list |
