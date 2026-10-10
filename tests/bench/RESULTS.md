# Worker benchmark results

Detection time inside the worker (decode, no-data check, detection,
thumbnails), production build, 10 rounds over the fixture tiles. Targets were
fixed before measuring: p95 at most 150 ms per 512 px request with its halo,
50 ms per 256 px tile.

| date | commit | browser | CPU | 512 px p50 / p95 | 256 px p50 / p95 | result |
|---|---|---|---|--:|--:|---|
| 2026-10-10 | f4871e8 | Chromium 141, headless | Xeon 2.1 GHz, 4 cores | 163.8 / 236.7 ms | 35.3 / 57.1 ms | both above target |

v2 misses both targets on this machine. The scan does not wait on it at the
default rate: the app runs 2 to 4 workers (cores minus one), so 3 workers at
the 512 px p95 would handle about 12 requests per second (worked out, not
measured) against the 5 the scan sends. Firefox: not measured (no Firefox
build in this environment). The benchmark runs in `npm run verify`, not in CI.

The bench allows twice the target (300 and 100 ms p95) only when the `CI`
environment variable is set (`SLACK` in `bench.spec.ts`). Without it the limit
is the target itself, so timings like the ones above fail the bench step.
