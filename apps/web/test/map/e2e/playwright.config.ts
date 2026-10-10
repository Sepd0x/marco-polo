import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// Map rendering checks on the production build under the Pages base path.
// Tiles never come from the network: each test answers the real imagery
// hosts with synthetic tiles (see tiles.ts), so the CSP under test is the
// production one.
const port = Number(process.env.MAP_E2E_PORT ?? 5402);

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: join(tmpdir(), 'marco-polo-map-e2e'),
  reporter: 'list',
  workers: 1,
  timeout: 120_000,
  use: { baseURL: `http://localhost:${port}/marco-polo/` },
  webServer: {
    command: `npx vite build && npx vite preview --port ${port} --strictPort`,
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    env: { VITE_BASE: '/marco-polo/' },
    url: `http://localhost:${port}/marco-polo/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    {
      name: 'firefox',
      // PW_FIREFOX_PATH points at another Firefox build when the bundled one cannot start.
      use: {
        browserName: 'firefox',
        launchOptions: process.env.PW_FIREFOX_PATH ? { executablePath: process.env.PW_FIREFOX_PATH } : {},
      },
    },
  ],
});
