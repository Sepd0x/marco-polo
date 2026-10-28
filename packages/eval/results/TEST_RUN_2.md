# TEST run 2 (28 Oct 2026)

v3 (`pool-v2.json` 715946884a6e, detector hash 3c2289a04d3b) against v1 at
0.55 on the seven TEST zones, logged in `TEST_RUNS.md` before it ran. The
model file keeps its name; v3 is its third model. Reports: `v3/report.json`
and, for v1, `v3/v1/report.json`, rerun on every zone with the merger of this
round (v1 TEST F1 37.0% in run 1, 37.4% now). Output of
`eval gate --report results/v3/report.json --baseline results/v3/v1/report.json`,
with the targets as fixed in `targets.json` before run 1:

| check | result | v1 | v2 (run 1) | v3 | target |
|---|---|--:|--:|--:|---|
| P1 TEST F1 gain | pass | 37.4% | 89.6% | 89.2% | +0.334 or more, interval above 0: +0.518 [0.471, 0.563] |
| P2 TEST errors ratio | pass | 2804 | 270 | 285 | 0.326 or less, interval below 1: 0.102 [0.082, 0.125] |
| P3 F1 per stratum, upper end at or above 0 | pass, all five | | | | pt-rest +0.816, es +0.112, fr +0.271, us +0.051, pt-north +0.628 |
| P4 false detections per km², no-pool zone | **fail** | 8.0 | 25.0 | 31.0 | no more than v1 |
| P5 median area error, labels both hit | pass | 26.1% | 18.4% | 11.7% | 15% or less (14 labels) |
| P6 median signed area error | **fail** | | -15.2% | -8.1% | within 5% |
| P7 Odemira false positives | pass | | 0 | 0 | 1 or less |
| P8 GOLD recall, product path minus mosaic | pass, all five | | | | |
| P9 every DEV and DEV-2 zone, upper end at or above 0 | pass, all eleven | | | | |

Per stratum (F1, v1 rerun, v2, v3): Viseu 5.9%, 89.7%, 87.5% · La Nucia
82.9%, 94.3%, 94.1% · Dammarie-les-Lys 33.3%, 58.4%, 60.5% · Santa Fe
Springs 82.9%, 87.9%, 88.0% · Mirandela 2.0%, 67.2%, 64.8%. Reported apart:
Brixen (hard) 19.4%, 8.7%, 16.0%, 20 pools, v3 finds 2; Dunkerque (no
pools) 8, 25 and 31 false detections.

What changed, and what the run says:

- Area: the half second ring brings the median error on the labels both
  versions hit from 18.4% to 11.7% (P5 passes). The signed error goes from
  -15.2% to -8.1% over 28 outlines; v3 still draws pools smaller than OSM,
  by less. On DEV the signed error was -2.0%, so TEST outlines read smaller
  than DEV ones.
- F1 does not move: 89.6% to 89.2%, inside the interval of either run. v3
  was justified on area, the large-pool class and duplicates, not on F1
  (DEV 79.9% to 80.6%, DEV-2 74.6% to 74.3%).
- Dunkerque: 31 false detections on 1 km² where v2 had 25 and v1 8. TEST
  zones have no galleries, so what they are is not measured. Thresholds
  moved for Esri (0.43 to 0.385) and DGT (0.50 to 0.309); IGN, Dunkerque's
  source, barely did (0.553 to 0.556), so the change there comes from the
  model.
- Mirandela and Viseu lose 2 to 2.5 pp, Dammarie-les-Lys gains 2: none of
  the five strata moves outside its interval.
- Pools of 400 m² or more are not in the TEST labels in any number; the
  class is measured on the large-pool set, apart (`v3/large/`): v1 37 of
  40, the v2 model 14, v3 29.

One TEST run remains. A third run needs a change justified on DEV and DEV-2
alone.
