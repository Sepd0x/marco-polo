# Changelog

Release versions only. Inside the repository the three detectors keep older
names: `results/v1` is v0.1, `results/v2` is v0.2, `results/v3` is v1.0
([detection](docs/DETECTION.md)).

## 1.0.0, 28 Oct 2026

The last release. Second model of the learned detector, scored once on the
blind TEST zones (TEST run 2): F1 89.2% [87.3, 90.8] against 37.4% for the
colour rules. Two of the nine targets are missed: the signed area error
(-8.1%, target within 5%) and false detections in the zone with no pools
(31 per km², the colour rules 8).

- Large pools: the trainer adds scaled copies of candidates for pools of
  400 m² and more; 46 of 69 found in the large-pool set, against 25 before.
- Area counts half of the second pixel ring around the mask: median area
  error on TEST from 18.6% to 14.6%.
- One detection per pool when two neighbouring tiles see the same shape.
- The CLI runs the learned detector with the app's windows, halo,
  thresholds and sources, and lists the same pools as the app.
- Worker speed: morphology, labelling and features skip empty words and
  reuse buffers; p95 60 ms per 512 px request on a Ryzen AI 9 365.
- Map labels in Martian Mono from the app's own glyphs; pool numbers stay
  whole inside the frame.
- Offline: a scan fails fast and says so, and resumes the failed tiles when
  the browser is back online. A scan with every tile failed reports failed.
- No Esri imagery trains or calibrates the model.
- Documentation names the detectors by release.

The v0.2.0 tag was cut late, on 28 Oct, at the commit that already holds the
work above. 1.0.0 adds only documentation and naming on top of it.

## 0.2.0, 10 Oct 2026

Learned detector. Colour proposes candidates; 56 features of colour, shape
and context, 300 gradient-boosted trees and a small neural network score
them, in web workers.

- Imagery by place: DGT in Portugal, PNOA in Spain, IGN in France, Esri
  elsewhere.
- Benchmark in `packages/eval`: frozen labels, DEV, DEV-2, GOLD and blind
  TEST zones drawn by lot, 95% intervals, targets fixed before the first
  TEST run.
- TEST run 1: F1 89.6% against 37.0% for the colour rules; three of the
  nine targets missed ([report](packages/eval/results/TEST_RUN_1.md)).

## 0.1.0, 6 Jul 2026

First release. Colour rules on Esri imagery: a per-pixel gate, morphology,
shape and size filters and a merger across tile edges. Draw an area, scan it,
list the pools by size.
