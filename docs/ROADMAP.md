# Roadmap

Prioritised and specified so any contributor (or agent) can pick one up cold.
Each item lists where the seam is and what "done" means.

## P1 — highest value

### 1. Resumable scans
A closed tab currently loses an in-progress sweep. Persist progress and offer
"resume" from the archive.
- **Where:** `apps/web/src/scan/controller.ts` + `scan/persist.ts`.
- **How:** every N tiles, store `{ scanId, area, zoom, order, nextIndex, fragments }`.
  `DetectionMerger` needs `serialize()/restore()` (its state is plain data:
  clusters of `TileDetection` + processed tile keys). On boot, offer resume;
  rebuild the plan (deterministic for the same inputs) and skip `nextIndex` tiles.
- **Done when:** killing the tab mid-scan and reopening finishes the scan with
  identical results to an uninterrupted run (assert on a small AOI).

### 2. Esri Wayback — imagery time travel
Scanning *dated* imagery vintages turns the tool into a change tracker.
- **Where:** new provider option in `SettingsPanel`; template like
  `https://wayback.maptiles.arcgis.com/arcgis/rest/services/world_imagery/mapserver/tile/{release}/{z}/{y}/{x}`.
- **How:** fetch the release list once (`.../WMTS/1.0.0/WMTSCapabilities.xml` or
  the wayback config JSON), show a vintage dropdown, substitute `{release}`.
- **Done when:** the same AOI can be scanned on two vintages, and both scans
  sit in the archive labelled with their date.

### 3. Scan diffing
With (2): pools present in vintage B but not in A = new construction.
- **How:** match detections across two archived scans by centre distance
  (< 5 m) → classify added / removed / unchanged; render as green/red overlay
  and a diff export.

## P2 — strong upgrades

### 4. ONNX detector plug-in
The classical detector is the default; a learned model should be optional.
- **Where:** `detectTile()` is the seam — same signature in, `TileDetection[]` out.
  Define `interface Detector { detect(rgba, w, h, tile): TileDetection[] }`,
  implement `ColorDetector` (current) and `OnnxDetector` (onnxruntime-web,
  lazily loaded, model URL configurable; map boxes/masks into `TileDetection`).
- **Done when:** a settings toggle switches engines and the worker pool loads
  the model once per worker.

### 5. Hilbert-curve traversal
Third `TraversalOrder` with better locality than serpentine.
- **Where:** `packages/core/src/scan/plan.ts` (`hilbertSequence(range)`),
  d2xy conversion over the smallest power-of-two square covering the range.
  Unit-test locality: mean index-distance of adjacent tiles must beat serpentine.

### 6. PWA
Manifest + service worker (cache-first for the app shell only — tiles already
have their own cache). Install prompt makes the mobile experience first-class.

### 7. Marker decluttering
At low zoom, hundreds of markers collide. Cluster rank-chips (grid-bucket by
screen distance, show count) or hide chips below a zoom threshold and keep dots.

## P3 — polish & reach

8. **i18n** — extract UI strings; ship `pt-PT` first.
9. **Confidence calibration** — hand-label ~200 detections across the four
   reference areas, fit the weights in `scoreConfidence` (logistic regression),
   publish the table in DETECTION.md.
10. **AOI import** — accept a GeoJSON file drop as the search area (the CLI
    already parses these shapes).
11. **Share cards** — OG image endpoint is impossible without a backend, but a
    "copy summary" (top-5 pools + permalink) makes results portable.

## Non-goals (deliberate)

- No backend, no accounts, no telemetry — the zero-server property is the
  security/privacy story.
- No scraping providers that forbid it; keyed providers use the user's key.
- No address-level enrichment of exports (see docs/IMAGERY.md, responsible use).
