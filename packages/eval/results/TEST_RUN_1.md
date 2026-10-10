# TEST run 1 (10 Oct 2026)

v2 (`pool-v2.json` d9c3672b29ae, detector hash 62ba002bff61) against v1 at
0.55 on the seven TEST zones, logged in `TEST_RUNS.md` before it ran. Reports:
`v1/report.json`, `v2/report.json`. Output of `eval gate`, the targets as
fixed in `targets.json` before the run:

| check | result | v1 | v2 | target |
|---|---|--:|--:|---|
| P1 TEST F1 gain | pass | 37.0% | 89.6% | +0.334 or more, interval above 0: +0.526 [0.478, 0.569] |
| P2 TEST errors ratio | pass | 2851 | 270 | 0.326 or less, interval below 1: 0.095 [0.077, 0.116] |
| P3 F1 per stratum, upper end at or above 0 | pass, all five | | | pt-rest +0.838, es +0.114, fr +0.251, us +0.050, pt-north +0.653 |
| P4 false detections per km², no-pool zone | **fail** | 8.0 | 25.0 | no more than v1 |
| P5 median area error, labels both hit | **fail** | 26.1% | 18.4% | 15% or less (14 labels) |
| P6 median signed area error | **fail** | | -15.2% | within 5% |
| P7 Odemira false positives | pass | | 0 | 1 or less |
| P8 GOLD recall, product path minus mosaic | pass, all five | | | |
| P9 every DEV and DEV-2 zone, upper end at or above 0 | pass, all eleven | | | |

Per stratum (F1, v1 then v2): Viseu 5.9% to 89.7%, La Nucia 82.9% to 94.3%,
Dammarie-les-Lys 33.3% to 58.4%, Santa Fe Springs 82.9% to 87.9%, Mirandela
1.9% to 67.2%. Reported apart: Brixen (hard) 19.4% to 8.7%, 20 pools, v2 finds
1; Dunkerque (no pools) 8 to 25 false detections.

What the misses say:

- Area: v2 draws pools smaller than the OSM outline. DEV showed it before
  TEST (signed -12.2%, DEV-2 -22.2%), and no area target was met on DEV
  either (median error 25.5%). The TEST figure rests on 24 outlines.
- Dunkerque: 25 false detections on 1 km² where v1 had 8. TEST zones have no
  galleries, so what they are is not measured.
- Dammarie-les-Lys recall is 48%: half the pools there are missed.
- Brixen: v2 misses 19 of 20 pools on Esri in the Alps.

Provenance: `targets.json` names commit c5d7966, the working branch where the
targets were computed. That branch was squashed into 06d7b86, which brought
`targets.json` here before the run (e676b20); the run row in `TEST_RUNS.md`
holds the sha256 of that same file.

Two TEST runs remain. A second run needs a change justified on DEV and DEV-2
alone.
