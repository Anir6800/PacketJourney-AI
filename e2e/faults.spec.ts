import { expect, test, type Page } from '@playwright/test';

// Phase 11: fault lab. Faults are added through the Lab UI; visuals are checked at the event the engine reports.

type Scene = { step: number; notice: { device: string; text: string } | null; fracture: boolean; rings: { device: string; lit: number }[] };

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

const runBtn = (page: Page) => page.getByRole('button', { name: /^Run (new simulation|again)$/ });
const scene = (page: Page) => page.evaluate(() => window.__pj.scene?.() as unknown) as Promise<Scene>;
const ready = (page: Page) => page.waitForFunction(() => window.__pj.stageReady && typeof window.__pj.scene === 'function');

async function setup(page: Page, protocol: 'TCP' | 'UDP', template: 'routed' | 'same-lan') {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('#scope').selectOption(template);
  await page.getByRole('group', { name: 'Protocol' }).getByRole('button', { name: protocol }).click();
}
async function addFault(page: Page, preset: string, o: { packet?: string; hop?: number; attempt?: number; offset?: number; bit?: number; delay?: number } = {}) {
  await page.locator('#fault-preset').selectOption(preset);
  if (o.packet) await page.locator('#fault-packet').selectOption(o.packet);
  if (o.hop !== undefined) await page.locator('#fault-hop').selectOption(String(o.hop));
  if (o.attempt !== undefined) await page.locator('#fault-attempt').fill(String(o.attempt));
  if (o.offset !== undefined) await page.locator('#fault-offset').fill(String(o.offset));
  if (o.bit !== undefined) await page.locator('#fault-bit').fill(String(o.bit));
  if (o.delay !== undefined) await page.locator('#fault-delay').fill(String(o.delay));
  await page.getByTestId('fault-add').click();
}
async function stepTo(page: Page, tag: string, device?: string) {
  const rows = page.getByTestId('events').locator('li').filter({ has: page.locator('.ev-tag', { hasText: new RegExp(`^${tag}$`) }) });
  const row = device ? rows.filter({ hasText: device }).first() : rows.first();
  const before = await page.getByTestId('journey-step').textContent();
  await row.locator('summary').click();
  await page.waitForFunction((t) => document.querySelector('[data-testid=journey-step]')?.textContent !== t, before, { polling: 50, timeout: 2000 }).catch(() => undefined);
  const n = Number(((await page.getByTestId('journey-step').textContent()) ?? '').split(' / ')[0]) - 1;
  await page.waitForFunction((i) => (window.__pj.scene?.() as { step?: number } | undefined)?.step === i, n, { polling: 50, timeout: 5000 });
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

test('dropped TCP data frame: drop visuals at the reporting receiver (3D and 2D), cause chain to a single delivery', async ({ page }) => {
  await setup(page, 'TCP', 'routed');
  await addFault(page, 'drop', { packet: 'data', hop: 1 });
  await expect(page.getByTestId('fault-list')).toContainText('drop data · attempt 0 · hop 1');
  await runBtn(page).click();
  await ready(page);

  const chain = page.getByTestId('fault-chain');
  await expect(chain).toContainText('FAULT · drop (data, hop 1)');
  await expect(chain).toContainText('dropped before R2');
  await expect(chain).toContainText('A timer expires');
  await expect(chain).toContainText('A retransmits');
  await expect(chain).toContainText('B delivers once');

  await stepTo(page, 'drop:fault');
  const s = await scene(page);
  expect(s.notice).toEqual({ device: 'R2', text: 'DROPPED · simulated', tone: 'danger' });
  expect(s.fracture).toBe(true);
  await expect(page.locator('.label3d-notice')).toHaveText('DROPPED · simulated');
  await expect(page.getByTestId('svg-notice')).toHaveText('DROPPED · simulated');
  // RTO ring: armed for A while the data is outstanding.
  expect(s.rings.find((r) => r.device === 'A')?.lit ?? 0).toBeGreaterThan(0);
  await expect(page.getByTestId('rto-ring-A')).toBeVisible();

  // Same step in 2D view.
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: '2D' }).click();
  await expect(page.getByTestId('svg-notice')).toHaveText('DROPPED · simulated');
  await expect(page.getByTestId('rto-ring-A')).toBeVisible();

  // Chain chip jumps to the retransmission.
  await page.getByTestId('chain-tcp:retransmit').click();
  await expect(page.getByTestId('journey-caption')).toContainText('tcp:retransmit');
});

test('corrupted wire bit: pink byte, FCS fails at the next receiver; advanced corruption fails the transport checksum', async ({ page }) => {
  await setup(page, 'UDP', 'same-lan');
  await addFault(page, 'corrupt-wire', { packet: 'data', offset: 8, bit: 0 });
  await runBtn(page).click();
  await ready(page);
  await stepTo(page, 'fault:corrupt:wire');
  expect((await scene(page)).notice?.text).toBe('BIT FLIP · simulated');
  await expect(page.getByTestId('bit-flip')).toHaveCount(1);
  await stepTo(page, 'drop:link');
  await expect(page.getByTestId('journey-caption')).toContainText('FCS mismatch');
  await expect(page.getByTestId('fault-chain')).toContainText('FCS fails at B');
  await expect(page.getByTestId('bit-flip')).toHaveCount(1); // the flipped byte stays marked on the frame

  // Advanced: transport corruption with recomputed FCS (routed TCP): routers forward it, B's TCP checksum rejects it.
  await page.locator('#scope').selectOption('routed');
  await page.getByRole('group', { name: 'Protocol' }).getByRole('button', { name: 'TCP' }).click();
  await page.getByRole('button', { name: 'Remove fault 1' }).click();
  await addFault(page, 'corrupt-transport', { packet: 'data', offset: 20, bit: 3 });
  await runBtn(page).click();
  await expect(page.getByTestId('fault-chain')).toContainText('transport checksum fails at B');
  await stepTo(page, 'drop:transport');
  await expect(page.getByTestId('journey-caption')).toContainText('TCP checksum mismatch');
});

test('handshake cannot be targeted; lost ACK shows duplicate suppression at the receiver; Reduced motion is calm', async ({ page }) => {
  await setup(page, 'TCP', 'routed');
  const options = await page.locator('#fault-packet option').allTextContents();
  expect(options).toEqual(['data', 'ack', 'response', 'response-ack']);
  await page.locator('#reply-text').waitFor();
  await page.getByLabel('Echo app replies (custom behaviour, not HTTP)').uncheck();
  await addFault(page, 'lose-ack');
  await runBtn(page).click();
  await ready(page);
  await expect(page.getByTestId('fault-chain')).toContainText('B discards duplicate, re-ACKs');
  await page.getByRole('group', { name: 'Motion' }).getByRole('button', { name: 'Reduced' }).click();
  await stepTo(page, 'tcp:duplicate');
  const s = await scene(page);
  expect(s.notice).toEqual({ device: 'B', text: 'DUPLICATE · discarded, re-ACKed', tone: 'info' });
  await expect(page.getByTestId('svg-notice')).toHaveText('DUPLICATE · discarded, re-ACKed');
  await expect(page.getByTestId('fx-status')).toHaveText('Effects off · Reduced motion');
  // Events: exactly one delivery at B.
  expect(await page.getByTestId('events').locator('.ev-tag', { hasText: /^deliver:app$/ }).count()).toBe(1);
});

test('UDP delay is not loss: the datagram arrives late; UDP offers no ACK fault', async ({ page }) => {
  await setup(page, 'UDP', 'routed');
  expect(await page.locator('#fault-preset option').allTextContents()).not.toContain('Lose a TCP ACK');
  await addFault(page, 'delay', { packet: 'data', hop: 2, delay: 5 });
  await runBtn(page).click();
  await ready(page);
  await stepTo(page, 'fault:delay');
  expect((await scene(page)).notice?.text).toBe('DELAYED 5 ms · simulated');
  expect(await page.getByTestId('events').locator('.ev-tag', { hasText: /^deliver:app$/ }).count()).toBe(2); // request + reply
  expect(await page.getByTestId('events').locator('.ev-tag', { hasText: /^drop/ }).count()).toBe(0);
});
