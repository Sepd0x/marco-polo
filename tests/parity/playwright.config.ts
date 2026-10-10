import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// Decodes the fixture JPEGs in real browsers and compares them with the Node
// decoder that the CLI, the benchmark and the training tools use. No server:
// bytes go in by value.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: join(tmpdir(), 'marco-polo-parity'),
  reporter: 'list',
  workers: 1,
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
