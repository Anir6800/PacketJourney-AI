import { expect, test, type Page } from '@playwright/test';

// Phase 12: Compare (TCP vs UDP) and Practice.

const errors: string[] = [];
test.beforeEach(async ({ page }) => {
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    sessionStorage.setItem('pj.booted', '1');
    sessionStorage.setItem('pj.mode', 'lab');
  });
});
test.afterEach(() => {
  expect(errors.splice(0), 'console errors').toEqual([]);
});

const metric = (page: Page, p: 'TCP' | 'UDP', k: string) => page.getByTestId(`m-${p}-${k}`);
/** The rendered text settles on the exact engine value (count-up ends exactly there). */
async function settled(page: Page, p: 'TCP' | 'UDP', k: string) {
  const el = metric(page, p, k);
  const exact = (await el.getAttribute('data-exact')) ?? '';
  await expect(el).toHaveText(exact);
  return exact;
}

test('compare: same data fault in both, metrics from events, separate cursors, no winner badge', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('#scope').selectOption('routed');
  await page.getByRole('button', { name: /^Run (new simulation|again)$/ }).click();
  await page.getByRole('tab', { name: 'Compare' }).click();
  await expect(page.getByTestId('compare')).toContainText('no winner is declared');

  expect(await settled(page, 'TCP', 'uniqueAppBytes')).toBe('10 B');
  expect(await settled(page, 'UDP', 'uniqueAppBytes')).toBe('10 B');
  const fullTcp = await settled(page, 'TCP', 'frameBytes');
  await page.getByRole('group', { name: 'Accounting' }).getByRole('button', { name: 'Delivery only' }).click();
  const delivTcp = await settled(page, 'TCP', 'frameBytes');
  expect(Number.parseInt(fullTcp, 10)).toBeGreaterThan(Number.parseInt(delivTcp, 10)); // handshake + pure ACK frames only in full
  expect(await settled(page, 'UDP', 'frameBytes')).toBe(delivTcp); // same two data frames × 3 hops in both

  await page.getByRole('group', { name: 'Compare fault' }).getByRole('button', { name: 'Drop first data' }).click();
  expect(await settled(page, 'TCP', 'uniqueAppBytes')).toBe('10 B'); // recovered once, not twice
  expect(await settled(page, 'TCP', 'retransmissions')).toBe('1');
  expect(await settled(page, 'UDP', 'uniqueAppBytes')).toBe('0 B'); // the request is lost, so the echo app never replies
  expect(await settled(page, 'UDP', 'retransmissions')).toBe('0');
  expect(await settled(page, 'TCP', 'droppedFrames')).toBe('1');
  expect(await settled(page, 'UDP', 'droppedFrames')).toBe('1');

  // After switching faults every rendered cell equals its exact engine value (no stale text from the previous run).
  for (const cell of await page.locator('[data-testid^=m-]').all()) await expect(cell).toHaveText((await cell.getAttribute('data-exact')) ?? 'x');
  expect(await settled(page, 'UDP', 'firstDeliveryMs')).toBe('n/a');
  expect(await settled(page, 'UDP', 'goodputBps')).toBe('n/a');

  // Separate cursors: stepping TCP never moves UDP.
  const udpCaption = await page.getByTestId('mini-caption-UDP').textContent();
  await page.getByRole('button', { name: 'TCP: first event' }).click();
  await expect(page.getByTestId('mini-TCP')).toContainText('event 1 /');
  await expect(page.getByTestId('mini-caption-UDP')).toHaveText(udpCaption ?? '');
  await expect(page.getByTestId('compare')).not.toContainText(/\bwins\b|better than|winner:/i); // only the "no winner is declared" disclaimer may mention it
});

test('compare under Reduced motion shows exact values at once', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('group', { name: 'Motion' }).getByRole('button', { name: 'Reduced' }).click();
  await page.getByRole('tab', { name: 'Compare' }).click();
  const el = metric(page, 'TCP', 'frameBytes');
  await expect(el).toHaveText((await el.getAttribute('data-exact')) ?? 'x', { timeout: 200 });
});

test('practice: answers hidden until submitted, evidence revealed, deterministic grade, reset clears', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Practice' }).click();
  const list = page.getByTestId('practice');
  await expect(list.locator('.practice-q')).toHaveCount(12);
  await expect(list.locator('[data-testid^=reveal-]')).toHaveCount(0);
  await expect(list).not.toContainText('02:00:00:00:02:00'); // the MAC answer is not in the page before submitting

  await page.locator('#a-mac-r1').fill('02:00:00:00:02:00');
  await page.locator('#a-mac-r1').press('Enter');
  await expect(page.getByTestId('reveal-mac-r1')).toContainText('✓ Correct');
  await expect(page.getByTestId('reveal-mac-r1')).toContainText('R1 → R2 dst MAC');
  await page.locator('#a-ttl-r2').fill('64');
  await page.getByTestId('q-ttl-r2').getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByTestId('reveal-ttl-r2')).toContainText('✕ Not quite');
  await expect(page.getByTestId('reveal-ttl-r2')).toContainText('answer 62');
  await expect(page.getByTestId('practice-score')).toContainText('2 / 12 answered · 1 correct');

  await page.reload();
  await page.getByRole('tab', { name: 'Practice' }).click();
  await expect(page.getByTestId('practice-score')).toContainText('2 / 12 answered'); // local progress resumes
  await page.getByTestId('practice-reset').click();
  await expect(page.getByTestId('practice-score')).toContainText('0 / 12 answered · 0 correct');
  await expect(page.locator('[data-testid^=reveal-]')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('pj.practice'))).toBeNull();
});
