import { expect, test, type Page } from '@playwright/test';

const errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    sessionStorage.setItem('pj.booted', '1');
    sessionStorage.setItem('pj.mode', 'lab');
  });
});
test.afterEach(() => expect(errors.splice(0), 'console errors').toEqual([]));

async function openLab(page: Page) {
  await page.route('**/api/health', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByText('Save & present')).toBeVisible();
  await expect(page.getByTestId('ai-status')).toContainText('offline');
}

test('all eight presets regenerate and run with the AI server unavailable', async ({ page }) => {
  await openLab(page);
  const cases = [
    ['tcp-hello', 'seed 1401', 'TCP'],
    ['udp-echo', 'seed 42', 'UDP'],
    ['routed-ttl-mac', 'seed 1403', 'UDP'],
    ['tcp-data-loss', 'seed 1404', 'TCP'],
    ['tcp-ack-loss', 'seed 1405', 'TCP'],
    ['udp-loss', 'seed 1406', 'UDP'],
    ['header-corruption', 'seed 1407', 'UDP'],
    ['application-session', 'seed 1408', 'TCP'],
  ] as const;
  for (const [id, seed, protocol] of cases) {
    await page.locator('#preset').selectOption(id);
    await expect(page.getByTestId('run-info')).toContainText(seed);
    await expect(page.getByTestId('run-info')).toContainText(protocol);
    await expect(page.locator('.event')).not.toHaveCount(0);
  }
  await expect(page.getByText('HTTP session, connection A')).toBeVisible();
  await expect(page.getByTestId('preset-note')).toContainText('different client port');
});

test('export/import round-trip regenerates the same event tags; invalid, huge and newer files are rejected', async ({ page }) => {
  await openLab(page);
  await page.locator('#preset').selectOption('tcp-data-loss');
  const tags = await page.locator('.ev-tag').allTextContents();
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export JSON' }).click(),
  ]).then(([item]) => item);
  const path = await download.path();
  expect(path).not.toBeNull();
  await page.locator('#preset').selectOption('udp-echo');
  await page.getByLabel('Import scenario JSON').setInputFiles(path ?? '');
  await expect(page.getByRole('status')).toContainText('Events were regenerated');
  await expect(page.getByTestId('run-info')).toContainText('seed 1404');
  expect(await page.locator('.ev-tag').allTextContents()).toEqual(tags);

  const input = page.getByLabel('Import scenario JSON');
  await input.setInputFiles({ name: 'newer.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"packetjourney-ai/scenario","version":99,"modelVersion":"14"}') });
  await expect(page.getByRole('alert')).toContainText('newer than supported');
  await input.setInputFiles({ name: 'huge.json', mimeType: 'application/json', buffer: Buffer.alloc(64 * 1024 + 1, 32) });
  await expect(page.getByRole('alert')).toContainText('safe limit');
  await input.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{not-json') });
  await expect(page.getByRole('alert')).toContainText('not valid JSON');
});

test('corrupt local data recovers, settings persist, reset clears progress, and the print summary is readable', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('phase14-corrupt-seeded')) return;
    sessionStorage.setItem('phase14-corrupt-seeded', '1');
    localStorage.setItem('pj.preferences.v1', '{bad');
    localStorage.setItem('pj.scenario.v1', '{bad');
    localStorage.setItem('pj.practice', '"bad"');
  });
  await openLab(page);
  await expect(page.getByText(/Corrupt saved configuration was cleared/)).toBeVisible();
  await page.getByRole('group', { name: 'Motion' }).getByRole('button', { name: 'Reduced' }).click();
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: '2D' }).click();
  await page.reload();
  await expect(page.getByRole('group', { name: 'Motion' }).getByRole('button', { name: 'Reduced' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'View' }).getByRole('button', { name: '2D' })).toHaveAttribute('aria-pressed', 'true');
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('region', { name: 'Printable single-run summary' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Printable single-run summary' })).toContainText('SIMULATED');
  await expect(page.getByRole('region', { name: 'Printable single-run summary' })).toContainText('Performance is NOT MEASURED');
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('button', { name: 'Reset demo & local data' }).click();
  await expect(page.getByText(/reset to local defaults/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pj.practice'))).toBeNull();
});

test('Director completes offline in forced 2D and 3D; Space pauses, chapters jump, Esc exits', async ({ page, context }) => {
  test.setTimeout(180_000);
  await page.clock.install();
  await openLab(page);
  await page.getByRole('group', { name: 'Motion' }).getByRole('button', { name: 'Reduced' }).click();
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: '2D' }).click();
  await page.locator('#preset').selectOption('udp-loss');
  await page.getByTestId('start-director').click();
  await expect(page.getByTestId('director')).toHaveAttribute('data-playing', 'true');
  await expect(page.getByTestId('stage-2d')).toContainText('View set to 2D');
  await page.locator('.journey').screenshot({ path: 'test-results/phase14-director-2d.png' });
  await page.keyboard.press('Space');
  await expect(page.getByTestId('director')).toHaveAttribute('data-playing', 'false');
  const pausedBeat = await page.getByTestId('director').getAttribute('data-beat');
  await page.clock.fastForward(20_000);
  await expect(page.getByTestId('director')).toHaveAttribute('data-beat', pausedBeat ?? '');
  await page.keyboard.press('Space');
  for (let i = 0; i < 80 && (await page.getByTestId('director').getAttribute('data-complete')) !== 'true'; i++)
    await page.clock.fastForward(4_000);
  await expect(page.getByTestId('director')).toHaveAttribute('data-complete', 'true');
  await page.locator('.director-chapters').getByRole('button', { name: 'Journey' }).click();
  await expect(page.getByText(/Journey · beat/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('director')).toHaveCount(0);

  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: '3D' }).click();
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error test override
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      return type === 'webgl2' || type === 'webgl' ? null : original.call(this, type as '2d', ...(args as []));
    };
  });
  await page.reload();
  await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Director' }).click();
  await expect(page.getByRole('group', { name: 'View' }).getByRole('button', { name: '2D' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('stage-2d')).toContainText('WebGL unavailable');
  await page.keyboard.press('Escape');

  const p3 = await context.newPage();
  await p3.clock.install();
  p3.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text());
  });
  p3.on('pageerror', (error) => errors.push(error.message));
  await p3.addInitScript(() => {
    sessionStorage.setItem('pj.booted', '1');
    sessionStorage.setItem('pj.mode', 'lab');
  });
  await p3.route('**/api/health', (route) => route.abort());
  await p3.goto('/');
  await p3.getByRole('group', { name: 'Motion' }).getByRole('button', { name: 'Reduced' }).click();
  await p3.getByRole('group', { name: 'View' }).getByRole('button', { name: '3D' }).click();
  await p3.locator('#preset').selectOption('udp-loss');
  await p3.getByTestId('start-director').click();
  await expect(p3.getByTestId('stage-3d')).toBeVisible({ timeout: 60_000 });
  await p3.locator('.viewport').screenshot({ path: 'test-results/phase14-director-3d.png' });
  for (let i = 0; i < 80 && (await p3.getByTestId('director').getAttribute('data-complete')) !== 'true'; i++)
    await p3.clock.fastForward(4_000);
  await expect(p3.getByTestId('director')).toHaveAttribute('data-complete', 'true');
  await expect(p3.getByTestId('stage-3d')).toBeVisible();
  await p3.close();
});
