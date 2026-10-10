import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './net.ts';
import * as ui from './ui.ts';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function seriousViolations(page: Parameters<typeof ui.scanArea>[0]) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target.join(' ')) }));
}

for (const theme of ['light', 'dark'] as const) {
  test(`no serious accessibility violations on the result, ${theme} theme`, async ({ page }) => {
    await ui.scanArea(page);
    if (theme === 'dark') {
      await ui.themeToggle(page).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    }
    expect(await seriousViolations(page)).toEqual([]);
  });
}
