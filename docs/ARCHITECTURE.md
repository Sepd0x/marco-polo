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
│  detect/    v2: colour candidates → 56 features → trees + MLP      │
│             → calibrated score; v1: colour rules (baseline)        │
│  merge/     cross-tile fragment merger (dedupe + truncation)       │
│  rank/      largest-first order (the app also sorts by score)      │
└──────────────────────┬──────────────────────┬──────────────────────┘
                       │                      │
        ┌──────────────▼───────────┐   ┌──────▼──────────────────┐
        │        apps/web          │   │      packages/cli       │
        │  React + MapLibre GL     │   │  Node scanner           │
        │  Web Worker pool runs    │   │  jpeg-js/pngjs decode   │
        │  detect() off-thread     │   │  disk cache, no Esri    │
        │  tile cache by licence   │   │  GeoJSON/CSV output     │
        │  IndexedDB scan archive  │   └─────────────────────────┘
        └──────────────────────────┘
```

## Why client-side?

The imagery sources serve tiles with CORS headers, so a browser canvas can read
their pixels. That allows a static web app.

No backend: the demo is static files on GitHub Pages, and drawn areas and results
stay in the browser. Each visitor fetches tiles for their own scan at a capped
rate (default 5 tiles/s). Decoding and detection run in 2 to 4 workers (cores
minus one, `workerPool.ts`), so the map does not wait on them (frame rate not
measured).

The CLI runs the same engine from a script. Its default threshold is 0.55 for
every source, while the app holds each source to its calibrated threshold (0.50
DGT, 0.55 IGN, 0.43 Esri and PNOA), so a CLI scan at the default can list fewer
pools than the app.

## Scan lifecycle (web)

```
draw polygon ──► buildScanPlan(polygon, zoom, order)        [core]
                     │  tiles that intersect the polygon,
                     │  sequenced for spatial locality
                     ▼
             ScanController.start()
                     │  timer tick (1000/rate ms) → dispatch ≤1 tile
                     ▼
         fetchTile() ──► app cache hit? ──► createImageBitmap()
                     │                              │ transfer
                     ▼                              ▼
             tile fails: retry ×3,          WorkerPool.detect()
             then count + move on                   │ detectWindow() [core]
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
in-flight fetches via `AbortController` and finalizes with partial results.

## The merger (dedupe) in one paragraph

Every detection that touches a tile edge *might* continue in the neighbour tile. The
merger keeps clusters indexed by tile; when a new fragment arrives it probes the 8
neighbouring tiles for clusters whose geographic bbox comes within ~2.5 px (in metres
at that latitude/zoom) and joins them, transitively. Merged detections re-emit as
`update` events (the UI reorders the ranking live); a cluster that grows past the
plausible-pool ceiling is reclassified as open water and removed. A cluster stays
`truncated: true` only while a touched edge borders a tile that is unscanned or
outside the plan, so its measurement is a lower bound.

## State & rendering

- **zustand** store with `subscribeWithSelector`: React components subscribe to
  slices; the MapLibre layer managers (`ScanOverlay`, `DetectionMarkers`,
  `FrameOverlay`) subscribe imperatively, so the map path never triggers a React
  re-render. The scale bar and the cursor in the data strip are written straight
  into the DOM from bus events for the same reason.
- The tile grid uses feature state per tile; detection outlines are GeoJSON with
  data-driven paint (magenta over a dark casing). Markers are GL layers: a dot for
  the overview and the rank number, an image drawn on a canvas in the interface
  font and placed as text, so it needs no glyph server. Each pool also carries
  an invisible keep-out icon as large as the pool on screen; the numbers collide
  with it, so none covers a pool, and `map/labelPlace.ts` gives each zoom level
  only the sides where a number lies nearer to its own pool than to any other.
- The map is locked north up and flat. `FrameOverlay` draws the survey frame over
  it (neat line, fiducials, graduation, coordinates, réseau) and recomputes it on
  every move; the coordinates in the margin are only true without rotation.
- Detection **thumbnails are real pixels**: the worker crops the detection bbox from
  the tile it analysed and ships the RGBA buffer back (transferable), where it
  becomes a data-URL for the ranked list and the archive.

## Trade-offs made deliberately

| Decision | Cost | Why it wins |
|---|---|---|
| Small learned scorer (300 trees + 32/16 MLP) in plain TypeScript instead of a large network | misses covered pools and pools under trees; blue cars, panels and teal roofs still pass at times | 84 KB gzip, no runtime dependency, same scores in the browser, Node and the Python reference within 1e-5 |
| Client-side scanning | scan lifetime tied to the tab | no backend to run; areas and results stay in the browser |
| Area from the mask grown by one pixel ring | median area error 25.5% on DEV, 18.6% on TEST; areas run small (signed -12.2% DEV, -15.2% TEST) | simple and the same in every engine; the area targets are not met (docs/DETECTION.md) |
| Rank numbers as canvas images in symbol layers | a small image per rank and label style (box, halo, open) | no cap on markers, no glyph server dependency, same font as the list |
