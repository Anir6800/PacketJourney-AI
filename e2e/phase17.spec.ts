import { expect, test, type Page } from '@playwright/test';

const errors: string[] = [];
test.beforeEach(({ page }) => {
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(() => expect(errors.splice(0), 'console and page errors').toEqual([]));

async function enterMessage(page: Page, message: string) {
  await page.goto('/');
  await expect(page.getByTestId('message-entry')).toBeVisible();
  await expect(page.locator('.hud, .rail, .stage, .dock')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Message to send' }).fill(message);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('story-question')).toHaveAttribute('data-q', 'transport');
}

test('message-first routed journey at desktop and phone widths', async ({ browser }) => {
  test.setTimeout(240_000); // two full flows (1440 and 390), each with a cold 3D load under CPU WebGL
  for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]] as const) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.getByTestId('message-entry')).toBeVisible();
    await expect(page.locator('.hud, .rail, .stage, .dock')).toHaveCount(0);
    await page.screenshot({ path: `docs/evidence/phase17/after/${name}-entry.png` });
    await page.getByRole('textbox', { name: 'Message to send' }).fill('héllo ✓');
    await expect(page.getByTestId('entry-count')).toHaveText('10 / 256 bytes UTF-8');
    await page.keyboard.press('Enter');
    for (const q of ['transport', 'ports', 'scope'] as const) {
      await expect(page.getByTestId('story-question')).toHaveAttribute('data-q', q);
      if (q === 'scope') await page.getByTestId('choice-routed').click();
      await page.keyboard.press('Enter');
    }
    await expect(page.getByTestId('story-question')).toHaveAttribute('data-q', 'fault');
    await page.screenshot({ path: `docs/evidence/phase17/after/${name}-question.png` });
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('story-question')).toHaveAttribute('data-q', 'confirm');
    await page.keyboard.press('Enter');
    const boot = page.getByTestId('run-boot');
    await expect(boot).toContainText('10 bytes UTF-8');
    await expect(boot).toContainText('datagram 18 B');
    await expect(boot).toContainText('total length 38');
    await expect(boot).toContainText('frame 64 B');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `docs/evidence/phase17/after/${name}-boot.png` });
    await page.keyboard.press('Shift');
    await expect(page.getByTestId('opening')).toHaveAttribute('data-message', 'héllo ✓');
    await expect(page.getByTestId('opening')).toContainText('68 C3 A9 6C 6C 6F 20 E2 9C 93');
    await page.waitForTimeout(700);
    await page.screenshot({ path: `docs/evidence/phase17/after/${name}-opening.png` });
    await expect(page.getByRole('group', { name: 'Mode' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('story-player')).toBeVisible();
    // Diagnose rather than guess if 3D does not mount: the 2D fallback caption states the reason.
    await expect(page.getByTestId('stage-3d'), await page.getByTestId('stage-2d').textContent({ timeout: 1000 }).catch(() => null) ?? 'no 2D caption').toBeVisible({ timeout: 30_000 });
    await page.waitForFunction(() => window.__pj.stageReady);
    // The glass chrome has finished rising from blurred to sharp before the evidence capture (pointer wakes idle chrome).
    await page.waitForFunction(() => [...document.querySelectorAll('.hud-enter')].every((e) => getComputedStyle(e).filter === 'none'), null, { timeout: 30_000 });
    await page.mouse.move(200, 300); // inside both the 1440 and 390 viewports
    await expect(page.locator('.app')).toHaveAttribute('data-chrome-idle', 'false');
    await page.waitForFunction(() => [...document.querySelectorAll('.hud-enter')].every((e) => getComputedStyle(e).opacity === '1'));
    await page.screenshot({ path: `docs/evidence/phase17/after/${name}-story-3d.png` });
    if (name === 'mobile') {
      await page.locator('.viewport').scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'docs/evidence/phase17/after/mobile-stage-3d.png' });
    }
    await page.mouse.move(5, 5);
    await page.getByRole('group', { name: 'View' }).getByRole('button', { name: '2D' }).click();
    await expect(page.getByTestId('stage-2d')).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
    // The 2D fallback draws the same nested shells from the scene model (line-style encoding, no hue).
    await expect(page.locator('[data-testid="stage-2d-shells"] [data-layer]')).not.toHaveCount(0);
    await page.screenshot({ path: `docs/evidence/phase17/after/${name}-story-2d.png` });
    await context.close();
  }
});

test('fullscreen denial leaves questions usable; Reduced motion skips boot and fullscreen', async ({ browser }) => {
  const denied = await browser.newContext();
  await denied.addInitScript(() => {
    Element.prototype.requestFullscreen = function () { (window as unknown as { fsRequests: number }).fsRequests = ((window as unknown as { fsRequests?: number }).fsRequests ?? 0) + 1; return Promise.reject(new Error('denied')); };
  });
  const page = await denied.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await enterMessage(page, 'Hello');
  expect(await page.evaluate(() => (window as unknown as { fsRequests?: number }).fsRequests), 'Enter requested fullscreen').toBe(1);
  await page.getByRole('button', { name: 'Skip - use defaults' }).click();
  await expect(page.getByTestId('run-boot')).toBeVisible();
  await page.keyboard.press('Shift');
  await expect(page.getByTestId('story-player')).toBeVisible({ timeout: 20_000 });
  await denied.close();

  const reduced = await browser.newContext({ reducedMotion: 'reduce' });
  await reduced.addInitScript(() => {
    Element.prototype.requestFullscreen = () => { throw new Error('Reduced motion requested fullscreen'); };
  });
  const rp = await reduced.newPage();
  rp.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  rp.on('pageerror', (e) => errors.push(e.message));
  await enterMessage(rp, 'Hello');
  await rp.getByRole('button', { name: 'Skip - use defaults' }).click();
  await expect(rp.getByTestId('story-player')).toBeVisible();
  await expect(rp.getByTestId('run-boot')).toHaveCount(0);
  await expect(rp.getByRole('group', { name: 'Motion' }).getByRole('button', { name: 'Reduced' })).toHaveAttribute('aria-pressed', 'true');
  await reduced.close();
});

test('3D transmission shell degrades to physical material after frame budget misses', async ({ page }) => {
  await page.addInitScript(() => { sessionStorage.setItem('pj.booted', '1'); sessionStorage.setItem('pj.mode', 'lab'); });
  await page.goto('/');
  await page.waitForFunction(() => window.__pj.stageReady && typeof window.__pj.materialFallback === 'function');
  expect(await page.evaluate(() => window.__pj.materialFallback?.())).toBe(false);
  const before = await page.evaluate(() => window.__pj.scene?.() as { shellVisuals: { material: string }[] });
  expect(before.shellVisuals.some((s) => s.material !== 'MeshPhysicalMaterial')).toBe(true);
  const png = (await page.locator('canvas').screenshot()).toString('base64');
  const pixels = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const probe = document.createElement('canvas');
    probe.width = image.width; probe.height = image.height;
    const ctx = probe.getContext('2d');
    if (!ctx) throw new Error('2D pixel probe unavailable');
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
    const shades = new Set<number>();
    let maxDelta = 0;
    for (let y = 0; y < probe.height; y += 16) for (let x = 0; x < probe.width; x += 16) {
      const i = (y * probe.width + x) * 4;
      const r = data[i] ?? 0, g = data[i + 1] ?? 0, b = data[i + 2] ?? 0;
      shades.add(r);
      maxDelta = Math.max(maxDelta, Math.abs(r - g), Math.abs(g - b));
    }
    return { shades: shades.size, maxDelta };
  }, png);
  expect(pixels.shades, '3D canvas has non-blank pixel variation').toBeGreaterThan(8);
  expect(pixels.maxDelta, '3D canvas pixels stay near grayscale').toBeLessThanOrEqual(6);
  await page.evaluate(() => window.__pj.forceMaterialFallback?.());
  await page.waitForFunction(() => window.__pj.materialFallback?.() === true);
  const after = await page.evaluate(() => window.__pj.scene?.() as { shellVisuals: { material: string }[] });
  expect(after.shellVisuals.every((s) => s.material === 'MeshPhysicalMaterial')).toBe(true);
});

test('F and Esc control fullscreen; idle chrome stays available to focused controls', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('pj.booted', '1');
    sessionStorage.setItem('pj.mode', 'lab');
    let active: Element | null = null;
    Object.defineProperty(Document.prototype, 'fullscreenElement', { get: () => active });
    Element.prototype.requestFullscreen = async () => { active = document.documentElement; document.dispatchEvent(new Event('fullscreenchange')); };
    Document.prototype.exitFullscreen = async () => { active = null; document.dispatchEvent(new Event('fullscreenchange')); };
  });
  await page.goto('/');
  await page.keyboard.press('f');
  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  const control = page.getByRole('button', { name: 'New message' });
  await control.focus();
  await page.waitForTimeout(2700);
  await expect(page.locator('.app')).toHaveAttribute('data-chrome-idle', 'false');
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.mouse.move(600, 400);
  await expect(page.locator('.app')).toHaveAttribute('data-chrome-idle', 'true', { timeout: 4000 });
  await page.keyboard.press('i');
  await expect(page.locator('.app')).toHaveAttribute('data-chrome-idle', 'false');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  await page.keyboard.press('f');
  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.keyboard.press('f');
  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  await control.click();
  await expect(page.getByTestId('message-entry')).toBeVisible();
});

test('Director starts from the entry shortcut with a run-derived preset message', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Alt+d');
  await expect(page.getByTestId('run-boot')).toContainText('TCP header 20 B');
  await page.keyboard.press('Shift');
  await expect(page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Director' })).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
  await expect(page.getByText('Director Mode')).toBeVisible();
});

test('frame timing is measured during 3D playback (SwiftShader only; real hardware NOT MEASURED)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => { sessionStorage.setItem('pj.booted', '1'); sessionStorage.setItem('pj.mode', 'lab'); });
  await page.goto('/');
  await page.waitForFunction(() => window.__pj.stageReady);
  await page.getByTestId('play').click();
  const t = await page.evaluate(() => new Promise<{ n: number; median: number; p95: number; max: number; frames: number }>((resolve) => {
    const d: number[] = [];
    const f0 = window.__pj.frames ?? 0;
    const end = performance.now() + 4000;
    let last = performance.now();
    const tick = (now: number) => {
      d.push(now - last);
      last = now;
      if (now < end) { requestAnimationFrame(tick); return; }
      d.sort((a, b) => a - b);
      const q = (p: number) => Math.round(d[Math.min(d.length - 1, Math.floor(p * d.length))] ?? 0);
      resolve({ n: d.length, median: q(0.5), p95: q(0.95), max: q(1), frames: (window.__pj.frames ?? 0) - f0 });
    };
    requestAnimationFrame(tick);
  }));
  const fx = await page.getByTestId('fx-status').textContent();
  console.log(`3D playback page frame intervals (headless SwiftShader): ${t.n} frames, median ${t.median} ms, p95 ${t.p95} ms, max ${t.max} ms; 3D renders ${t.frames}; fx="${fx}"`);
  expect(t.frames, 'the 3D stage renders while playing').toBeGreaterThan(0);
});
