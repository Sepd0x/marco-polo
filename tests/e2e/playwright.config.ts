import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

/*
 * End-to-end tests on the production build (base /marco-polo/). The web
 * server builds the app, then serves it with vite preview, so the CSP meta
 * the build adds is in the page. No test reaches the network: every request
 * to another host is answered from the open fixture or with an empty reply
 * (see net.ts).
 */
const port = Number(process.env.E2E_PORT ?? 5402);
const base = '/marco-polo/';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: join(tmpdir(), 'marco-polo-e2e'),
  reporter: 'list',
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${port}${base}`,
    browserName: 'chromium',
    colorScheme: 'light',
    locale: 'en-GB',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    launchOptions: {
      // PW_CHROMIUM_PATH points at another Chromium build when the bundled one cannot start.
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
      // A second guard after page routing: no host name resolves, so nothing can leave the machine.
      args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--no-proxy-server'],
    },
  },
  webServer: {
    command: `npm --workspace @marco-polo/web run build && npm --workspace @marco-polo/web run preview -- --base ${base} --port ${port} --strictPort`,
    url: `http://localhost:${port}${base}`,
    env: { VITE_BASE: base },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
