import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('Story and Lab main views pass axe WCAG A/AA checks at desktop and phone sizes', async ({ page }) => {
  test.setTimeout(120_000); // Four full-page axe scans while SwiftShader renders the 3D stage.
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => sessionStorage.setItem('pj.booted', '1'));

  for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    if (size.width === 390) await page.evaluate(() => sessionStorage.setItem('pj.mode', 'story'));
    await page.goto('/');
    await expect(page.getByTestId('story-question')).toBeVisible();
    let result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(result.violations, `Story ${size.width}: ${result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`).join('; ')}`).toEqual([]);

    await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Lab' }).click();
    await expect(page.getByTestId('journey-step')).toBeVisible();
    result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(result.violations, `Lab ${size.width}: ${result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`).join('; ')}`).toEqual([]);
  }
  expect(errors).toEqual([]);
});
