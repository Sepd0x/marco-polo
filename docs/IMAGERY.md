# Imagery sources, limits & responsible use

Marco Polo analyses standard **XYZ raster tiles** (Web Mercator, 256 px). It ships
with one default source and a pluggable seam for anything else.

## Default: Esri World Imagery

```
https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}
```

- High-resolution aerial/satellite composite (Maxar, Earthstar Geographics et al.),
  global coverage, generally to z19 in populated areas.
- Served with permissive CORS, which is what allows in-browser pixel analysis.
- **Attribution is required** and is shown on the map, in the app footer
  attribution control, and embedded in exports:
  *"Esri, Maxar, Earthstar Geographics, and the GIS User Community."*
- Esri's terms permit use of this service for maps and analysis with attribution;
  they do not permit bulk harvesting of imagery. Marco Polo is built to stay on
  the right side of that line (see "Being a polite client" below). If you plan
  sustained, large-scale scanning, get your own imagery entitlement — that's what
  the custom-endpoint setting is for.

## Being a polite client

- **Hard rate cap** — tiles are dispatched on a timer (default 5/s, max 10/s,
  user-visible in Settings). A scan is comparable traffic to a user panning the
  map, just more patient.
- **Local caching** — the browser keeps tiles in the Cache API; the CLI keeps them
  in `.tile-cache/`. Re-scans and threshold experiments hit cache, not the
  provider.
- **No fan-out** — the web app has no backend; each user fetches only what their
  own scan needs. The CLI is single-stream sequential.
- **Backoff** — HTTP 429/5xx retry with exponential backoff and jitter; permanent
  errors are not retried.

## Swapping the imagery source

Settings → *Imagery URL* (web) or `--template` (CLI) accepts any
`{z}/{x}/{y}` template: your own tile server, a licensed provider (Mapbox,
Maxar, Planet), or public regional orthophoto services (many national mapping
agencies publish free high-resolution orthophotos — often *better* than the
default for their country). Check the terms of whatever you point it at;
requirements differ on attribution, caching and derived data.

If you operate your own imagery, note the detector's assumptions: RGB truecolor,
roughly 0.2–0.6 m/px (z18–z19 equivalents), reasonably colour-balanced. NIR bands
would make water detection dramatically easier (NDWI), but standard tile services
don't carry them.

## Responsible use

This tool detects private amenities on private property from public imagery. The
imagery is public and viewable by anyone in any map client — Marco Polo adds
*aggregation*, and aggregation changes the ethics.

Fine (and the intended uses):

- Learning how geospatial CV pipelines work, end to end.
- Urban analysis at neighbourhood/city scale: pool density, water-use estimation,
  urban heat / affluence research on aggregate numbers.
- Emergency planning (identifying water sources), insurance portfolio modelling,
  municipal registry reconciliation — the same use-cases the GIS industry runs
  commercially.

Not fine:

- Profiling specific individuals or properties (burglary reconnaissance is the
  obvious abuse; "which of my neighbours has an undeclared pool" is a subtler
  one — in most jurisdictions enforcement from aerial imagery is the tax
  authority's prerogative, not a neighbour's).
- Publishing per-address datasets derived from someone else's imagery service.
  Export files carry coordinates, not addresses, and it should stay that way.

The detections are **estimates from imagery of unknown age**. Never treat a
detection (or its absence) as a statement of current fact about a property.

## Privacy posture of the app itself

Everything runs client-side. Drawn areas, scan results and archives live in your
browser's storage and never leave your machine. The only network traffic is tile
fetches to the imagery provider and (only when you use the search box) a geocoding
query to OpenStreetMap Nominatim. There is no analytics, no tracking, no backend.
