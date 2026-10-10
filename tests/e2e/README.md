# End-to-end tests

Playwright tests of the web app, run on the production build.

## Running

```sh
npm run e2e
```

The web server in `playwright.config.ts` builds the app with `VITE_BASE=/marco-polo/`, then serves `apps/web/dist` with `vite preview` on port 5402. Set `E2E_PORT` for another port. The CSP meta only exists in that build.

When the bundled Chromium cannot start, point `PW_CHROMIUM_PATH` at another build:

```sh
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run e2e
```

## Files

- `net.ts`: network routing, the test fixture that collects console errors and CSP violations, and the scan area.
- `ui.ts`: every locator and UI step. A UI redesign should only change this file.
- `*.spec.ts`: the tests.

## How the fixture is served

No test uses the network. Every request to a host other than the preview server goes through `context.route`:

- Imagery requests whose URL is listed in `packages/eval/fixtures/open/manifest.json` get the bytes of that tile's `file`. The URLs there are the exact requests the app makes, so the match is on the full URL.
- The OpenFreeMap TileJSON gets a document with the label layers and no data; label tiles and glyphs get 204.
- Nominatim gets an empty list.
- Everything else, such as imagery outside the fixture or capture date lookups, gets 204, which the app reads as no imagery.

Chromium also starts with a host resolver rule that resolves no host name, so a request that slipped past routing would fail instead of reaching the internet.

The scan area is the PNOA block `pnoa-pozuelo` less its outer ring of tiles, opened with an `#aoi=` link. PNOA is a 256 px XYZ source at z19, so each scan request maps to one fixture tile, and the eight neighbours read for the halo are in the block too. The DGT block is not used: the app asks DGT for 512 px WMS images with a halo on a z18 grid, which no fixture tile matches.

Imagery licences are in `packages/eval/fixtures/open/ATTRIBUTION.md`.
