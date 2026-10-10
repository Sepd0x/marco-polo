import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

/*
 * Worker benchmark on the production build (base /marco-polo/), served by
 * vite preview. Build first: VITE_BASE=/marco-polo/ npm run build.
 */
const port = Number(process.env.BENCH_PORT ?? 5401);

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: join(tmpdir(), 'marco-polo-bench'),
  reporter: 'list',
  workers: 1,
  timeout: 180_000,
  use: { baseURL: `http://localhost:${port}/marco-polo/` },
  webServer: {
    command: `npm --workspace @marco-polo/web run preview -- --port ${port} --strictPort`,
    url: `http://localhost:${port}/marco-polo/`,
    env: { VITE_BASE: '/marco-polo/' },
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      // PW_CHROMIUM_PATH points at another Chromium build when the bundled one cannot start.
      use: {
        browserName: 'chromium',
        launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
      },
    },
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
