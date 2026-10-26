import { expect, test, type Page } from '@playwright/test';

// Phase 08: 3D journey stage. Entity, shell and label assertions go through the dev-only test hook
// (window.__pj.scene), which reports what is mounted in the three.js scene graph.

type Scene = {
  template: string;
  step: number;
  devices: { id: string; kind: string; selected: boolean }[];
  links: { id: string; label: string; active: boolean }[];
  presentShells: { layer: string; color: string; label: string }[];
  bitStream: boolean;
  labels: string[];
  rig: string;
  postprocessing: boolean;
};

const errors: string[] = [];
test.beforeEach(async ({ page }) => {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (process.env.PJ_DEBUG) console.log('[browser]', m.type(), m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    sessionStorage.setItem('pj.booted', '1');
    sessionStorage.setItem('pj.mode', 'lab');
  });
});
test.afterEach(() => {
  expect(errors.splice(0), 'console errors').toEqual([]);
});

const ready = (page: Page) => page.waitForFunction(() => window.__pj.stageReady && typeof window.__pj.scene === 'function');
const scene = (page: Page) => page.evaluate(() => (window.__pj.scene?.() ?? null) as unknown) as Promise<Scene>;
const runBtn = (page: Page) => page.getByRole('button', { name: /^Run (new simulation|again)$/ });
async function step(page: Page, tag: string, device?: string) {
  const rows = page.getByTestId('events').locator('li').filter({ has: page.locator('.ev-tag', { hasText: new RegExp(`^${tag}$`) }) });
  const row = device ? rows.filter({ hasText: device }).first() : rows.first();
  const before = await page.getByTestId('journey-step').textContent();
  await row.locator('summary').click();
  // The event log selects on the async `toggle` event: wait for the journey to move before reading its step.
  await page.waitForFunction((t) => document.querySelector('[data-testid=journey-step]')?.textContent !== t, before, { polling: 50, timeout: 2000 }).catch(() => undefined);
  // The stage renders the journey's current step; wait until the mounted scene reports it, then bring it on screen.
  const n = Number(((await page.getByTestId('journey-step').textContent()) ?? '').split(' / ')[0]) - 1;
  await page.waitForFunction((i) => (window.__pj.scene?.() as { step?: number } | undefined)?.step === i, n, { polling: 100, timeout: 5000 }).catch(async (e: unknown) => {
    const got = await page.evaluate(() => (window.__pj.scene?.() as { step?: number } | undefined)?.step);
    throw new Error(`step ${tag}: journey index ${n}, scene step ${got} (${String(e)})`);
  });
  await page.locator('.viewport').scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
}
const layers = (s: Scene) => s.presentShells.map((x) => x.layer);

async function routed(page: Page) {
  await page.locator('#scope').selectOption('routed');
  await runBtn(page).click();
}

test('3D stage lazy-loads; same-LAN and routed entity counts and labels come from the fixtures', async ({ page }) => {
  const chunks: string[] = [];
  page.on('request', (r) => r.url().includes('JourneyStage3D') && chunks.push(r.url()));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await ready(page);
  expect(chunks.length).toBeGreaterThan(0);
  await expect(page.locator('canvas')).toHaveAttribute('aria-label', /3D journey stage/);

  let s = await scene(page);
  expect(s.devices.map((d) => [d.id, d.kind])).toEqual([['A', 'host'], ['B', 'host']]);
  expect(s.links.map((l) => l.label)).toEqual(['L1 · 192.0.2.0/24']);
  expect(s.labels).toEqual(expect.arrayContaining(['A · host', 'B · host', 'A.eth0 192.0.2.10/24\n02:00:00:00:0a:10']));
  expect(await page.evaluate(() => window.__pj.drawCalls)).toBeGreaterThan(0);
  // Read the composited canvas screenshot: WebGL's drawing buffer is deliberately not preserved.
  const png = (await page.locator('canvas').screenshot()).toString('base64');
  const pixels = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D pixel reader unavailable');
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<string>();
    for (let y = 0; y < canvas.height; y += 20) for (let x = 0; x < canvas.width; x += 20) {
      const i = (y * canvas.width + x) * 4;
      colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    return colors.size;
  }, png);
  expect(pixels, '3D canvas has visible, varied pixels').toBeGreaterThan(8);

  await routed(page);
  await page.waitForTimeout(200);
  s = await scene(page);
  expect(s.template).toBe('routed');
  expect(s.devices.map((d) => d.kind)).toEqual(['host', 'router', 'router', 'host']);
  expect(s.links.map((l) => l.label)).toEqual(['L1 · 192.0.2.0/24', 'L2 · 198.51.100.0/30', 'L3 · 203.0.113.0/24']);
  expect(s.labels.filter((l) => /^\w+\.eth\d /.test(l))).toHaveLength(6);
  // Labels are real DOM text over the canvas, visible to the user.
  await expect(page.locator('.label3d-link', { hasText: 'L2 · 198.51.100.0/30' })).toBeVisible();
});

test('shells mirror snapshots at encapsulation, router and decapsulation points', async ({ page }) => {
  test.setTimeout(90_000); // 14 steps under software WebGL in headless Chromium
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await ready(page);
  await routed(page);

  await step(page, 'app:send');
  expect(layers(await scene(page))).toEqual(['app']);
  await step(page, 'encap:transport');
  expect(layers(await scene(page))).toEqual(['transport', 'app']);
  await step(page, 'encap:internet');
  expect(layers(await scene(page))).toEqual(['internet', 'transport', 'app']);
  await step(page, 'encap:link');
  let s = await scene(page);
  expect(s.presentShells.map((x) => [x.layer, x.color])).toEqual([
    ['link', '#FBBF24'], ['internet', '#2DD4BF'], ['transport', '#38BDF8'], ['app', '#A78BFA'],
  ]);
  expect(s.presentShells[0]?.label).toBe('Ethernet · 02:00:00:00:0a:10 → 02:00:00:00:01:00');

  await step(page, 'decap:link', 'R1');
  expect(layers(await scene(page))).toEqual(['internet', 'transport', 'app']); // link shell dissolved at R1
  await step(page, 'hop:R1:forward');
  s = await scene(page);
  expect(s.presentShells[0]?.label).toContain('TTL 64 → 63');
  await expect(page.getByTestId('shell-labels')).toContainText('TTL 64 → 63');
  await step(page, 'encap:link', 'R1');
  s = await scene(page);
  expect(s.presentShells[0]?.label).toBe('Ethernet · 02:00:00:00:01:01 → 02:00:00:00:02:00'); // re-formed with new MACs
  await step(page, 'hop:R1:egress');
  s = await scene(page);
  expect(s.links.find((l) => l.active)?.id).toBe('L2');
  expect(s.bitStream).toBe(true);
  expect(s.labels).toContain('bit stream · teaching view');

  await step(page, 'decap:internet', 'B');
  expect(layers(await scene(page))).toEqual(['transport', 'app']);
  await step(page, 'deliver:app', 'B');
  expect(layers(await scene(page))).toEqual(['app']);
});

test('3D selection updates the inspector and 2D selection updates the 3D stage', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await ready(page);
  await routed(page);
  await page.locator('.viewport').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);

  const at = await page.evaluate(() => window.__pj.screenOf?.('device-R2') ?? null);
  expect(at).not.toBeNull();
  if (!at) return;
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('device-detail')).toContainText('R2 · router');
  await expect(page.getByTestId('device-detail')).toContainText('198.51.100.2/30');
  expect((await scene(page)).devices.find((d) => d.id === 'R2')?.selected).toBe(true);
  await expect(page.getByTestId('svg-node-R2')).toHaveAttribute('aria-pressed', 'true');

  // 2D → 3D: keyboard on the SVG node.
  await page.getByTestId('svg-node-R1').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('device-detail')).toContainText('R1 · router');
  const s = await scene(page);
  expect(s.devices.filter((d) => d.selected).map((d) => d.id)).toEqual(['R1']);

  // Shell click selects the same layer as the layer stack.
  await step(page, 'encap:link');
  const shell = await page.evaluate(() => window.__pj.screenOf?.('shell-app') ?? null);
  if (!shell) throw new Error('no app shell');
  await page.mouse.click(shell.x, shell.y);
  await expect(page.locator('.inspector .layer-title')).toContainText('Application');
});

test('View 2D and missing WebGL show the 2D journey with the same steps', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await ready(page);
  await routed(page);
  const steps3d = await page.getByTestId('journey-step').textContent();
  const tags3d = await page.getByTestId('events').locator('.ev-tag').allTextContents();

  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: '2D' }).click();
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByTestId('stage-2d')).toContainText('2D view · View set to 2D');
  await expect(page.getByTestId('journey-step')).toHaveText(steps3d ?? '');
  expect(await page.getByTestId('events').locator('.ev-tag').allTextContents()).toEqual(tags3d);

  // No WebGL2 at all.
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error test override
    HTMLCanvasElement.prototype.getContext = function (type: string, ...a: unknown[]) {
      return type === 'webgl2' || type === 'webgl' ? null : orig.call(this, type as '2d', ...(a as []));
    };
  });
  await page.reload();
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByTestId('stage-2d')).toContainText('WebGL unavailable');
  await expect(page.locator('.journey-svg')).toBeVisible();
});

test('context loss falls back to 2D with a visible note; restore brings 3D back', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const extension = await page.evaluate(() => {
    const loss = document.querySelector('canvas')?.getContext('webgl2')?.getExtension('WEBGL_lose_context');
    if (!loss) return false;
    (window as Window & { restoreGl?: () => void }).restoreGl = () => loss.restoreContext();
    loss.loseContext();
    return true;
  });
  expect(extension, 'SwiftShader exposes WEBGL_lose_context').toBe(true);
  await expect(page.getByTestId('stage-2d')).toContainText('WebGL context lost');
  await expect(page.locator('.viewport-3d')).toBeHidden();
  await page.evaluate(() => (window as Window & { restoreGl?: () => void }).restoreGl?.());
  await expect(page.locator('.viewport-3d')).toBeVisible();
  await expect(page.getByTestId('stage-2d')).toHaveCount(0);
});

test('reduced motion disables postprocessing; renderer memory stable across five resets', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await ready(page);
  expect((await scene(page)).postprocessing).toBe(true);
  await page.getByRole('group', { name: 'Motion' }).getByRole('button', { name: 'Reduced' }).click();
  await expect(page.getByTestId('fx-status')).toHaveText('Effects off · Reduced motion');
  expect((await scene(page)).postprocessing).toBe(false);

  await routed(page);
  await page.waitForTimeout(300);
  const samples: { geometries: number; textures: number }[] = [];
  // One warm-up reset uploads first-use resources (bit stream, effects passes); then five measured resets.
  for (let i = 0; i < 6; i++) {
    await runBtn(page).click();
    await step(page, 'hop:R1:egress'); // exercises the bit stream mount/unmount too
    await step(page, 'end:complete');
    await page.waitForTimeout(600); // R3F disposes removed objects on an idle callback
    const info = await page.evaluate(() => window.__pj.renderInfo?.() ?? null);
    if (!info) throw new Error('no renderInfo');
    if (i > 0) samples.push({ geometries: info.geometries, textures: info.textures });
  }
  console.log(`renderer.info.memory across 5 resets: ${JSON.stringify(samples)}`);
  expect(new Set(samples.map((x) => `${x.geometries}/${x.textures}`)).size).toBe(1);
});

for (const vp of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`screenshots ${vp.width}x${vp.height}: labels inside the stage`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/');
    await ready(page);
    await routed(page);
    await step(page, 'hop:R1:forward');
    await page.locator('.viewport').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.locator('.viewport').screenshot({ path: `test-results/stage3d-${vp.width}.png` });
    const box = await page.locator('.viewport').boundingBox();
    if (!box) throw new Error('no viewport');
    const cue = vp.width === 390 ? await page.getByTestId('cue-overlay').boundingBox() : null;
    // Every device label must be on screen inside the stage.
    for (const id of ['A · host', 'R1 · router', 'R2 · router', 'B · host']) {
      const label = page.locator('.label3d-device', { hasText: id });
      await expect(label, id).toBeVisible();
      const lb = await label.boundingBox();
      expect(lb, id).not.toBeNull();
      if (!lb) continue;
      expect(lb.x).toBeGreaterThanOrEqual(box.x - 1);
      expect(lb.x + lb.width).toBeLessThanOrEqual(box.x + box.width + 1);
      expect(lb.y).toBeGreaterThanOrEqual(box.y - 1);
      expect(lb.y + lb.height).toBeLessThanOrEqual(box.y + box.height + 1);
      if (cue) expect(cue.x + cue.width <= lb.x || lb.x + lb.width <= cue.x || cue.y + cue.height <= lb.y || lb.y + lb.height <= cue.y, `${id} clear of mobile cue`).toBe(true);
    }
  });
}
