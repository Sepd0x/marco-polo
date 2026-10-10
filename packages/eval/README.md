# eval

Benchmark for the pool detector. It scans fixed areas with the same tiles the
web app uses, matches the detections against frozen labels and reports
precision, recall, F1, area, length, width and centre errors, each with a 95%
interval, plus contact sheets of every error outside TEST.

```bash
npm run eval                                      # v1 on DEV and DEV-2, Esri, frozen labels
npm run eval -- run --zones dev --source auto     # each zone on the source the product scans there
npm run eval -- zones check                       # registry rules
npm run eval -- gate                              # committed reports against targets.json
npm run eval -- --help
```

## Zones and roles

`zones/registry.json` holds every zone with its role, its product source and
the places phase 0 looked at.

| role | use |
|---|---|
| DEV | tune here, look at galleries as often as you like |
| DEV-2 | the five former TEST zones; confirmation only, run at a freeze |
| GOLD | phase 0 gold (union of what the prototype methods proposed, checked by eye) |
| TEST | drawn from a pre-registered list; never tuned on, no galleries |
| TRAIN | zones a model learns from |

`eval zones check` fails when a TEST zone sits less than 50 km from any other
zone or seen place (or the smaller minimum its stratum has), so a training
zone added near a TEST zone is caught.

### The TEST draw

1. `zones/test-candidates.json` lists, per stratum, the municipalities a TEST
   zone may come from, with official codes. It was committed in `ddf92d4`,
   before any imagery of a candidate was opened, and is never edited.
2. `zones/test-candidates-v2.json` holds the rules in force: cells of 2 km,
   at least 20 pools, 50 km from every other zone and seen place (30 km from
   DEV zones and seen places in the north of Portugal). It keeps two zones of
   the first draw (Viseu, Dunkerque) and was committed before any imagery of
   a v2 cell was opened. The first rules (1 km cells, 40 pools) ran out in
   the north of Portugal and rejected 53 of the 55 zones reviewed; that draw
   stays in `zones/draw.json`.
3. `eval zones draw --stratum <id>` hashes the commit that added the rules
   with the stratum name to pick a municipality, then a cell of it (OSM land
   use only), and writes every attempt to `zones/draw-v2.json`.
4. A zone with fewer than 20 pools after review is rejected
   (`eval zones reject`) and the next municipality in the hashed order is
   drawn. Rejected zones stay on record in the registry.

Strata: north of Portugal and the rest of Portugal (DGT Ortos2025), Spain
(PNOA), France (IGN), United States (Esri), negative (ports and marinas) and
hard imagery (Esri winter or low-sun captures). The last two are reported
apart and never enter the totals. `results/TEST_ZONES.md` says where each
stratum stands.

Do not rebase or squash the commits that added the lists and the draws: each
draw is a function of the commit hash of its rules.

## Labels

Phase 0 zones: `labels/<zone>.geojson` is an OpenStreetMap extract
(`leisure=swimming_pool`), `labels/<zone>.extra.geojson` the hand additions and
corrections made on Esri imagery. Indoor, covered and duplicated pools are
`ignore`: a detection there counts neither way.

New zones are reviewed blind (`eval blind`): the zone is cut into 1024 px
windows of clean imagery with only a coordinate ruler, and every pool is
boxed by eye, with no detection and no OSM in view. OSM is merged afterwards;
every OSM pool the review did not box is shown on its own crop and judged
pool, absent or unsure. A second, independent pass covers 20% of the windows
(picked by hash) and their agreement (F1) must reach 0.90.

`labels/labels.sha256` freezes every label file. A run refuses changed labels
unless it passes `--relabel "<why>"`, which re-freezes and logs the change in
`labels/RELABEL_LOG.md`. A label absent from one source's imagery is listed in
`labels/<zone>.absent.<source>.json` and ignored on that source only.

Labels are ODbL, see [`labels/ATTRIBUTION.md`](labels/ATTRIBUTION.md).

## Matching and metrics

- Polygon label: hit when the detection centre is inside it or the boxes
  overlap with IoU >= 0.3.
- Point label: hit when the detection centre is within max(3 m, half the long
  side of its box) of the point and its area is at most max(4 x the median
  pool label of the zone, 150 m²). `--match v1` restores the phase 0 rule.
- Each label is matched once. Precision is over detections, recall over labels,
  totals are micro-averages.
- Intervals: block bootstrap, blocks of 4 x 4 z19 tiles resampled inside each
  zone, 2000 replicates, fixed seed. Comparisons of two runs use the same draws.
- Area error, length and width (minimum-area rectangle) are judged against OSM
  outlines only; `compare` and the gate also report area error on the labels
  both runs hit, so the sample does not change between versions.

## Sources

`--source esri|dgt|pnoa|ign|auto`. The DGT is read through its WMS with the
tile's EPSG:3857 box; `auto` is each zone's product source. Tiles are cached
on disk keyed by URL (`--cache`), a run writes the sha256 of every image it
read (`tiles.manifest`), and tiles without imagery (Esri placeholder, blank
DGT or PNOA answers, 404) count as missing, never as empty ground.

## TEST runs, targets and the gate

- `eval targets --baseline v1.json --report v2.json` fixes `targets.json` from
  DEV and DEV-2: each target is the stricter of the plan's floor and v2's
  pessimistic interval end there. It must be committed before the first TEST
  run.
- A detector other than v1 runs on TEST only with `--confirm-test "<why>"`,
  which logs the run in `results/TEST_RUNS.md` first. At most three. The v2
  report comes from `tools/train/report.ts`, which takes the same flag.
- `results/v1/report.json` and `results/v2/report.json` cover DEV, DEV-2, GOLD
  and TEST on the same frozen labels; `results/TEST_RUN_1.md` reads the first
  TEST run against the targets.
- `eval gate` reads the committed reports and fails when the detector code or
  model changed since the run, the labels differ from the frozen ones,
  `targets.json` changed after the first TEST run, a floor or target is missed,
  or a measurement is missing.
- `eval adjudicate prepare|apply` pools the unmatched detections of two runs,
  shuffled and shown without saying which version found them; confirmed pools
  form a second label set with its own sha256.
- `eval osm-recall` scores OSM against a blind count in 10 windows of a zone;
  training zones need 0.90.
