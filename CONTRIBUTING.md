# Contributing

Issues and pull requests are welcome.

## Getting set up

```bash
git clone https://github.com/Sepd0x/marco-polo.git
cd marco-polo
npm install
npm run dev          # web app on :5173
npm test             # unit tests, all packages
npm run typecheck    # strict TS across all packages
```

Node 24+ is required. There is no build step for development. Every package runs
from TypeScript source (Vite in the web app, `tsx` in the CLI, vitest for tests).

## Where things live

| Path | What it is | Rules |
|---|---|---|
| `packages/core` | the engine | **zero dependencies, no DOM/Node APIs**. It must run in a worker, a browser and Node unchanged. New behaviour needs unit tests. |
| `apps/web` | the product | React + MapLibre. Map rendering goes through the imperative managers (`map/overlay.ts`, `map/markers.ts`), not React state. |
| `packages/cli` | headless scanner | keep flags documented in `--help`. |
| `docs/` | design docs | if you change detection behaviour, update `DETECTION.md`. Its numbers should be the real ones. |

## Detection changes

Detection changes need numbers. Run the benchmark on DEV and DEV-2 before and
after, on the imagery the product uses in each zone, and compare the two
reports:

```bash
npm run eval -- run --zones dev,dev-2 --source auto --detector v2 --out before
npm run eval -- run --zones dev,dev-2 --source auto --detector v2 --out after
npm run eval -- compare --baseline before/report.json --report after/report.json
```

Put the F1 and the false detections per km² of DEV and DEV-2 in the PR. TEST
is never run for tuning. See [`packages/eval/README.md`](packages/eval/README.md).

## Style

- TypeScript strict; no `any` unless quarantined and commented.
- Comments explain *why*, not *what*. Match the density that's already there.
- No new runtime dependencies in `core`, and a high bar for new ones in `web`.

## Conduct

Be decent. Technical disagreement is welcome; hostility is not. (If something
needs moderating, open an issue and it will be dealt with.)
