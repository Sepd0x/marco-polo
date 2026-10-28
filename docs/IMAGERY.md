# Imagery sources and responsible use

The source registry is [`packages/core/src/providers.ts`](../packages/core/src/providers.ts).
With the default setting, `auto`, the scan picks the source by place: DGT
Ortos2025 in mainland Portugal, PNOA in Spain, IGN BD ORTHO in metropolitan
France and Corsica, Esri World Imagery elsewhere. An area that crosses a border
is split into parts, one source each. The Imagery picker on the map can fix one
source instead. The CLI takes the same choice with `--source auto|dgt|pnoa|ign|esri`.

## Sources

| source | imagery | request | licence | kept by the app | rate ceiling |
|---|---|---|---|---|--:|
| DGT Ortos2025 | aerial, 25 cm, flown 29 Mar to 26 Jul 2025 | WMS in EPSG:3857, 512 px per request | CC BY 4.0 | IndexedDB | 4/s |
| PNOA (IGN Spain) | aerial mosaic, 25 cm in most of Spain | WMTS, 256 px; the IGN TMS of the same mosaic as mirror | CC BY 4.0 | IndexedDB | 5/s |
| IGN BD ORTHO | aerial, 20 cm | WMTS, 256 px | Licence Ouverte 2.0 (Etalab) | IndexedDB | 5/s |
| Esri World Imagery | global mosaic; resolution and date vary by place | XYZ, 256 px | Esri terms of use | nothing | 5/s |

The registry also lists DGT OrtoSat2023 (30 cm satellite mosaic) as view
only: no licence for its image files was found, so it is never scanned.

Each source's attribution is shown on the map and written into every export.
For PNOA and IGN the export credit carries the capture date when it is known.

## Caching

- DGT, PNOA and IGN tiles are open data. The app keeps them in IndexedDB on
  the device, so a rescan reads them without a request. Settings, "Saved
  imagery", clears them.
- Esri tiles are never stored by the app or the CLI. In the browser, only the
  HTTP cache keeps them, for the max-age Esri sends.
- The CLI keeps open-licence tiles in `--cache-dir` (default `.tile-cache`)
  and never writes Esri tiles to disk.
- Training never uses Esri imagery.

## Rate

Requests go through a token bucket at the rate set in Settings (default 5 per
second, 1 to 10), never above the source's ceiling in the table. Each network
attempt takes a token, retries and halo neighbours included; a cache hit takes
none. 429, 5xx and network errors are retried up to 3 times with backoff. 404
and 204 mean "no imagery here". Other 4xx errors are not retried.

The detector expects RGB true colour at about the resolutions above. The
model was trained on DGT, PNOA and IGN imagery.

## Network

The production build sends a Content Security Policy that allows connections
only to these origins (`apps/web/src/map/csp.ts`):

- the imagery hosts in the table and the PNOA mirror;
- the capture date lookups: `services.arcgisonline.com`, `www.ign.es`,
  `data.geopf.fr`;
- OpenFreeMap (`tiles.openfreemap.org`) for street names (the glyphs are the app's own, Martian Mono, in `apps/web/public/glyphs/`);
- OpenStreetMap Nominatim, only when the search box is used.

Drawn areas, results and archives stay in the browser's storage. The app has
no backend and sends no analytics.

## Responsible use

The tool finds private amenities on private property from public imagery.
Anyone can view that imagery in a map client. The tool adds aggregation, and
aggregation changes the ethics.

Intended uses work on aggregate numbers: learning how a geospatial detection
pipeline works, pool density and water use at neighbourhood or city scale,
emergency planning (water sources), insurance portfolio models and municipal
registry checks.

Do not use it to profile a person or a property, whether for burglary or to
report a neighbour's undeclared pool. In most countries that enforcement is
the tax authority's job. Do not publish per-address datasets derived from
someone else's imagery service. Exports carry coordinates, not addresses.

Detections are estimates from imagery that can be years old. A detection, or
its absence, says nothing certain about a property today.
