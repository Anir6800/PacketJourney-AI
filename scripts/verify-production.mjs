import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const chunks = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', (r) => errors.push(`request: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); if (r.url().includes('JourneyStage3D')) chunks.push(r.url()); });
  await page.addInitScript(() => { globalThis.sessionStorage.setItem('pj.booted', '1'); globalThis.sessionStorage.setItem('pj.mode', 'lab'); });
  const response = await page.goto('http://127.0.0.1:4173/');
  assert.equal(response?.status(), 200);
  await page.waitForFunction(() => globalThis.__pj.stageReady && globalThis.__pj.drawCalls > 0, null, { timeout: 30000 });
  await page.getByTestId('stage-3d').waitFor({ state: 'visible' });
  assert.ok(chunks.length > 0, 'lazy 3D chunk loaded');
  await page.screenshot({ path: 'test-results/phase15-prod-3d-1440.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: '2D' }).click();
  await page.getByTestId('stage-2d').waitFor({ state: 'visible' });
  assert.equal(await page.locator('canvas').count(), 0);
  assert.equal(await page.locator('.journey-svg').isVisible(), true);
  await page.screenshot({ path: 'test-results/phase15-prod-2d-390.png' });
  await page.locator('.journey').screenshot({ path: 'test-results/phase15-prod-2d-journey-390.png' });
  await page.reload();
  await page.getByTestId('stage-2d').waitFor({ state: 'visible' });
  assert.deepEqual(errors, []);
  console.log(`production smoke: 3D loaded (${chunks.length} chunk), 2D journey loaded and persisted, console/page/request errors 0`);
} finally {
  await browser.close();
}
