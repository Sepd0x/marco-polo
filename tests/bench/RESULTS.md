# Worker benchmark results

Detection time inside the worker (decode, no-data check, detection,
thumbnails), production build, 10 rounds over the fixture tiles. Targets were
fixed before measuring: p95 at most 150 ms per 512 px request with its halo,
50 ms per 256 px tile.

| date | commit | browser | CPU | 512 px p50 / p95 | 256 px p50 / p95 | result |
|---|---|---|---|--:|--:|---|
| 2026-10-10 | f4871e8 | Chromium 141, headless | Xeon 2.1 GHz, 4 cores | 163.8 / 236.7 ms | 35.3 / 57.1 ms | both above target |
| 2026-10-28 | e7b2f13 | Chromium 156, headless | AMD Ryzen AI 9 365, 10 cores | 73.3 / 106.3 ms | 16.3 / 25.7 ms | both within target |
| 2026-10-28 | e63fdb2 | Chromium 156, headless | AMD Ryzen AI 9 365, 10 cores | 50.9 / 74.4 ms | 11.8 / 18.3 ms | both within target |

The learned detector misses both targets on this machine. The scan does not wait on it at the
default rate: the app runs 2 to 4 workers (cores minus one), so 3 workers at
the 512 px p95 would handle about 12 requests per second (worked out, not
measured) against the 5 the scan sends. Firefox: not measured (no Firefox
build in this environment). The benchmark runs in `npm run verify`, not in CI.

The bench allows twice the target (300 and 100 ms p95) only when the `CI`
environment variable is set (`SLACK` in `bench.spec.ts`). Without it the limit
is the target itself, so timings like the ones above fail the bench step.

## 28 Oct 2026: speed work (e7b2f13 to e63fdb2)

Same detections, scores, polygons, thumbnail crops and candidate features
bit for bit: `apps/web/test/scan/detectorGolden.test.ts` pins them on every
fixture tile (bitmap with halo, XYZ with eight neighbours, colour rules), recorded at
e7b2f13 before any change. The parity test still matches 433 of 433
candidates with a worst score difference of 0.

This PC was shared with other heavy jobs during the evening, so single runs
moved by up to 50 %. The two rows above are the quietest run of each build.
Four runs of each build, interleaved old and new:

| build | 512 px p50 / p95, median of 4 | 256 px p50 / p95, median of 4 | quietest run, 512 / 256 |
|---|--:|--:|--:|
| e7b2f13 | 93.7 / 155.6 ms | 21.8 / 36.8 ms | 74.4 / 134.1, 16.8 / 31.2 ms |
| e63fdb2 | 72.1 / 111.9 ms | 15.4 / 27.7 ms | 50.9 / 74.4, 11.8 / 18.3 ms |
| d0d5880 (v1.0 model) | 45.1 / 60.3 ms, one run | 10.0 / 14.9 ms, one run | same run |

Where the worker time goes now (Chromium, mean per request, from the
`stages` the worker reports): 512 px: decode 2.6, no-data 0.4, detection
39.2, thumbnails 5.8 ms (4.5 thumbnails per request); 256 px: decode 1.2,
no-data 0.1, detection 8.7, thumbnails 2.0 ms. Inside detection (Node,
`npx tsx tests/bench/stages.ts 6`, each tile's fastest round, 512 px, before
then after): colour to HSV 1.4 / 1.4, colour gates 4.0 / 4.2, morphology
6.8 / 4.6, labelling 7.8 / 4.9, the whole candidate stage 44.1 / 31.8 ms, of
which the features are most of the rest; scoring 1.1 and outlines 1.5 ms
did not change. The no-data check went from 1.1 to 0.2 ms.

What changed: features (two-pass distance grid, typed accumulators, row ends
for the oriented box, typed fill for enclosed holes; commit a7c1533, kept
apart so it can be reapplied after the retrain), morphology (buffers kept
between calls, empty words skipped, four pixels per step on non-empty
words), labelling (empty words skipped, interior neighbours without bounds
tests), and a no-data check that stops once its answer is certain. Decoding
was already native (createImageBitmap and a 2D canvas). Encoding the
thumbnails all at once instead of one after another did not change the time
in Chromium, so it was left out.

Not measured: the 4-core Xeon of the first row. If the gain there matches
this PC's (about 1.4 times at the 512 px p95, 1.3 times at the 256 px p95),
the Xeon would land near 170 ms at 512 px, still above the 150 ms target,
and near 43 ms at 256 px, within its 50 ms (worked out, not measured).
DevTools CPU throttling does not reach dedicated workers, so it cannot
stand in for a slower CPU here.

Firefox: Playwright's Firefox does not start on this PC (`browserType.launch:
spawn UNKNOWN`), as before; not measured.

The 256 px sample is a bare tile (halo 0). The scan sends XYZ tiles with
their eight neighbours, a 352 px window, so the product's 256 px requests
cost more than this row says.

The v1.0 model row (28 Oct, Ryzen AI 9 365, Chromium 156 headless) is a single quiet run with no other jobs on the machine, so it is not comparable with the medians above, which ran under load. Both targets pass. Firefox still fails to launch here (spawn UNKNOWN).
