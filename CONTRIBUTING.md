# Contributing

Thanks for taking an interest in Marco Polo. Issues and pull requests are welcome.

## Getting set up

```bash
git clone https://github.com/Sepd0x/marco-polo.git
cd marco-polo
npm install
npm run dev          # web app on :5173
npm test             # engine tests
npm run typecheck    # strict TS across all packages
```

Node 20+ is required. There is no build step for development — every package runs
from TypeScript source (Vite in the web app, `tsx` in the CLI, vitest for tests).

## Where things live

| Path | What it is | Rules |
|---|---|---|
| `packages/core` | the engine | **zero dependencies, no DOM/Node APIs** — it must run in a worker, a browser and Node unchanged. New behaviour needs unit tests. |
| `apps/web` | the product | React + MapLibre. Map rendering goes through the imperative managers (`map/overlay.ts`, `map/markers.ts`), not React state. |
| `packages/cli` | headless scanner | keep flags documented in `--help`. |
| `docs/` | design docs | if you change detection behaviour, update `DETECTION.md` — the numbers in there are meant to be the real ones. |

## Detection changes

Threshold or pipeline changes must come with evidence: run the tuning harness
before/after on at least two of the reference areas and include the results in
the PR description.

```bash
cd packages/cli
npx tsx src/dev/annotate.ts 37.0745 -8.1155 3 19 vilamoura.png   # EU resort
npx tsx src/dev/annotate.ts 33.594 -111.926 3 19 scottsdale.png  # US desert suburb
```

Watch for both directions: new false positives (roads, roofs, cars) *and* lost
true pools. The joint saturation/brightness gate exists because of exactly this
loop — see `docs/DETECTION.md` §2.

## Style

- TypeScript strict; no `any` unless quarantined and commented.
- Comments explain *why*, not *what*. Match the density that's already there.
- No new runtime dependencies in `core`, and a high bar for new ones in `web`.

## Conduct

Be decent. Technical disagreement is welcome; hostility is not. (If something
needs moderating, open an issue and it will be dealt with.)
