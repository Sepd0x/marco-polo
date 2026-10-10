import { expect, test } from './net.ts';
import * as ui from './ui.ts';

test('the production page has a CSP and a scan breaks none of it', async ({ page, net, problems }) => {
  const res = await page.goto('./');
  const header = res?.headers()['content-security-policy'] ?? null;
  const meta = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  const policy = header ?? meta;
  expect(policy, 'a CSP header or meta').toBeTruthy();
  expect(policy).toContain("default-src 'self'");
  expect(policy).toMatch(/script-src 'self'(;|$)/);

  await ui.scanArea(page);
  expect(net.fixture.length).toBeGreaterThan(0);
  expect(problems.csp).toEqual([]);
  expect(problems.errors).toEqual([]);
  expect(problems.console).toEqual([]);
});
