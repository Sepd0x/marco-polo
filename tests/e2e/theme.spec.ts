import { expect, test } from './net.ts';
import * as ui from './ui.ts';

const background = (page: Parameters<typeof ui.rootTheme>[0]) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('the theme switch changes the theme', async ({ page }) => {
  await ui.openArea(page);
  // The browser asks for light and nothing is saved: the page follows the system.
  expect(await ui.rootTheme(page)).toBeNull();
  const light = await background(page);

  await expect(ui.themeToggle(page)).toHaveAccessibleName('Dark theme');
  await ui.themeToggle(page).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(ui.themeToggle(page)).toHaveAccessibleName('Light theme');
  expect(await background(page)).not.toBe(light);

  await ui.themeToggle(page).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await background(page)).toBe(light);

  // The choice is saved.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
