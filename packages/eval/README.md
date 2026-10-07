# eval

Benchmark for the pool detector. It scans ten fixed areas with the same tiles
the web app uses, matches the detections against labelled pools and reports
precision, recall, F1, area error and detector time, plus contact sheets of
every false positive and false negative.

```bash
npm run eval                                   # all areas, v1 at 0.55, tiles from cache or network
npm run eval -- run --zones dev --min-conf 0.5 # only the DEV areas
npm run eval -- --help
```

Results of the shipped detector are in [`results/v1-baseline/report.md`](results/v1-baseline/report.md).
Any change to detection should come with a new run next to it.

## DEV and TEST

| split | areas | use |
|---|---|---|
| DEV | Vilamoura, Scottsdale, Odemira (greenhouses), Puyricard (Aix), Balma | tune on these, look at their galleries as often as you like |
| TEST | Marbella, Birre (Cascais), Santa Barbara de Nexe (Algarve), Castelnau-le-Lez, Arcadia (Phoenix) | **never tune on these.** Run them to report a number, do not open their galleries while choosing thresholds or rules |

If a TEST area starts steering decisions it is no longer a test area: move it to
DEV and pick a new one. Area definitions, with the reason each one is in the
set, are in [`src/zones.ts`](src/zones.ts).

## Labels

`labels/<area>.geojson` is an OpenStreetMap extract (`leisure=swimming_pool`:
ways, multipolygon relations and points) fetched once through Overpass, so the
benchmark runs without network. Pools tagged `indoor=yes`, `covered=yes` or
`location=indoor`, or sitting inside a building footprint, become `ignore`
labels: a detection there is neither a hit nor a false positive. Points are
matched within 5 m, or when they fall inside a detected outline.

OSM alone was not good enough: in three areas it had a sixth of the pools or
less (Scottsdale 8%, Cascais 5%, Algarve 15%). So every area was checked against the
imagery and completed in `labels/<area>.extra.geojson`:

- unlabelled pools added, either from a colour candidate whose outline was
  confirmed by eye, or as a box drawn by eye for pools no colour rule fires on
  (dark, green, shaded);
- doubtful things (a pale shape that may be an empty pool) added as `ignore`;
- OSM pools that are covered, empty, absent from this imagery or mapped twice
  turned into `ignore`.

Review depth is recorded per area. "full" means every window was looked at;
"candidates" (Marbella, Castelnau, Arcadia, all with dense OSM mapping) means
every unlabelled candidate plus a sample of windows. Some label fixes came from
reading the first run's galleries; they apply detector-independent rules
(covered, absent, real pool) but were only looked for where v1 failed, so they
lean slightly in v1's favour. The report says how many labels each area has and
where they came from.

OSM is traced from other imagery and can sit a few metres off Esri. The shift
per area is measured with `npm run eval -- offset` (median offset between
confident detections and OSM polygons) and stored in `zones.ts`.

The labels are ODbL, see [`labels/ATTRIBUTION.md`](labels/ATTRIBUTION.md).

### Changing or adding labels

```bash
npm run eval -- labels --zone <id>             # refresh from Overpass (one query at a time)
npm run eval -- review --zone <id> --out <dir> # numbered windows + candidates.json
# write <dir>/<id>/review.json (format at the top of src/review.ts)
npm run eval -- extra  --zone <id> --review <dir>/<id>/review.json
```

## Matching and metrics

- A detection hits a label when its centre is inside the label polygon, or the
  two boxes overlap with IoU ≥ 0.3. Each label is matched once, greedily
  (centre-inside pairs first, then by IoU). A second detection on an already
  matched pool is a false positive marked "duplicate".
- Labels count by centroid inside the area, detections by centre, so nothing at
  the edge is counted twice. Labels are loaded with a 120 m margin and the scan
  covers the area plus 40 m, so pools on the edge are imaged whole.
- Precision is over detections, recall over labels. DEV and TEST totals are
  micro-averages (counts summed, then divided); the macro F1 is printed too.
- Area error: median of |detected − label| / label over hits on OSM polygons.
- Time: detector CPU time (detect + merge) per km² of scanned area, with tiles
  already decoded. It moves with machine load, treat it as a rough figure.

For misses with no detection at all, the run also reports which stage of the
core pipeline lost the pool (colour gate and which rule, texture ceiling,
size/shape, mask cleanup), by re-running with that stage relaxed.

## Imagery

Default is Esri World Imagery at z19, the app's default. `--template` takes any
`https://` XYZ template, so sources can be compared on the same labels. Tiles
are cached on disk keyed by URL (`--cache`, or `$MARCO_POLO_CACHE`, default
`~/.cache/marco-polo/tiles`); a full run is about 3,400 tiles and fetches at 4
per second at most. `--offline` refuses any network access.

## Galleries and taxonomy

`--gallery <dir>` writes `fp-NN.png` and `fn-NN.png` per area: 200 px crops with
the label in green (yellow dashed: ignored), the detection in magenta, and
detections below the threshold dashed orange. `items.json` lists every item.
`--taxonomy <dir>` folds hand categories (`<area>.json`, keyed by item id) into
the report; the categories used for v1 are in `results/v1-baseline/taxonomy/`.
