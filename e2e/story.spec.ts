import { expect, test, type Page } from '@playwright/test';

// Phase 10: Story Mode. Fresh sessions start in Story Mode (no pj.mode set).

const errors: string[] = [];
test.beforeEach(async ({ page }) => {
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => sessionStorage.setItem('pj.booted', '1'));
});
test.afterEach(() => {
  expect(errors.splice(0), 'console errors').toEqual([]);
});

const question = (page: Page) => page.getByTestId('story-question');
const next = (page: Page) => page.getByTestId('story-next');
/** Completes the typed prompt (instantly completable), then waits for the answer controls. */
async function reveal(page: Page) {
  // Clicking the console completes the typing (a no-op once typed), never submits the question.
  const c = page.getByTestId('story-prompt');
  for (let i = 0; i < 4 && (await c.getAttribute('data-done')) === null; i++) await c.click();
  await expect(page.getByTestId('story-answer')).toBeVisible();
}
async function answer(page: Page, q: string, act: () => Promise<void>) {
  await expect(question(page)).toHaveAttribute('data-q', q);
  await reveal(page);
  await act();
  await next(page).click();
}

async function routedTcpStory(page: Page, opts: { protocol?: 'TCP' | 'UDP'; message?: string } = {}) {
  await answer(page, 'message', async () => {
    if (opts.message) await page.locator('#story-msg').fill(opts.message);
  });
  await answer(page, 'transport', () => page.getByTestId(`choice-${opts.protocol ?? 'TCP'}`).click());
  await answer(page, 'ports', async () => undefined);
  await answer(page, 'scope', () => page.getByTestId('choice-routed').click());
  if ((opts.protocol ?? 'TCP') === 'TCP') await answer(page, 'payload', () => page.getByTestId('choice-raw').click());
  await answer(page, 'fault', () => page.getByTestId('choice-none').click());
  await expect(question(page)).toHaveAttribute('data-q', 'confirm');
  await reveal(page);
  await next(page).click(); // Start the story
  await expect(page.getByTestId('story-player')).toBeVisible();
}

const player = (page: Page) => page.getByTestId('story-player');
const beatNext = (page: Page) => page.getByTestId('story-beat-next');
async function finishTyping(page: Page) {
  // Each click completes one typed line (TypedConsole semantics); click until the whole caption is done.
  const c = page.getByTestId('story-caption');
  for (let i = 0; i < 8 && (await c.getAttribute('data-done')) === null; i++) await c.click();
  await expect(c).toHaveAttribute('data-done', '');
}

test('first run is Story Mode; one question at a time; invalid answers blocked; Back keeps answers', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Story' })).toHaveAttribute('aria-pressed', 'true');
  await expect(question(page)).toHaveCount(1);
  await expect(question(page)).toHaveAttribute('data-q', 'message');
  await reveal(page);
  await expect(page.getByTestId('story-prompt')).toContainText('What message should travel?');
  await page.locator('#story-msg').fill('');
  await next(page).click();
  await expect(page.getByRole('alert')).toContainText('Enter at least 1 byte');
  await expect(question(page)).toHaveAttribute('data-q', 'message');
  await page.locator('#story-msg').fill('héllo');
  await expect(page.getByTestId('story-bytes')).toHaveText('6 / 256 bytes UTF-8 · 5 characters');
  await next(page).click();
  await expect(question(page)).toHaveCount(1);
  await expect(question(page)).toHaveAttribute('data-q', 'transport');
  await reveal(page);
  await expect(page.getByTestId('choice-TCP')).toContainText('lost data is retransmitted');
  await expect(page.getByTestId('choice-UDP')).toContainText('loss is not repaired');
  await page.getByTestId('choice-TCP').click();
  await next(page).click();
  // Ports: invalid blocked.
  await reveal(page);
  await page.locator('#story-sport').fill('0');
  await next(page).click();
  await expect(page.getByRole('alert')).toContainText('Ports 1–65535');
  await expect(question(page)).toHaveAttribute('data-q', 'ports');
  await page.locator('#story-sport').fill('7007');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await reveal(page);
  await expect(page.locator('#story-msg')).toHaveValue('héllo');
});

test('routed TCP story: layers in order, decapsulation reversed, captions equal engine-built beats; keyboard and Skip', async ({ page }) => {
  test.setTimeout(300_000); // walks every beat of the story (~30) under software WebGL
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await routedTcpStory(page);
  const built = await page.evaluate(() => window.__pj.story?.() ?? []);
  expect(built.length).toBeGreaterThan(20);

  const seen: { chapter: string; kind: string; layer: string; text: string }[] = [];
  for (let i = 0; i < built.length; i++) {
    await finishTyping(page);
    const p = player(page);
    seen.push({
      chapter: (await p.getAttribute('data-chapter')) ?? '',
      kind: (await p.getAttribute('data-kind')) ?? '',
      layer: (await p.getAttribute('data-layer')) ?? '',
      text: (await page.getByTestId('story-caption-log').innerText()).trim(),
    });
    // Rendered caption = the engine-built beat (whose values unit tests re-derive from frame bytes).
    expect(seen[i]?.text.split('\n').filter(Boolean)).toEqual(built[i]?.text);
    if (seen[i]?.layer && seen[i]?.layer !== 'physical' && seen[i]?.chapter !== 'recap') {
      await expect(page.getByTestId('story-fields')).toBeVisible();
    }
    if (i < built.length - 1) await beatNext(page).click();
  }
  expect(seen.filter((s) => s.chapter === 'encap').map((s) => s.layer)).toEqual(['app', 'transport', 'internet', 'link', 'physical']);
  expect(seen.filter((s) => s.chapter === 'decap').map((s) => s.layer)).toEqual(['link', 'internet', 'transport', 'app']);
  expect(seen.some((s) => s.kind === 'state' && s.text.includes('ESTABLISHED'))).toBe(true);
  expect(seen.some((s) => s.kind === 'ack')).toBe(true);
  // Key fields show real values from the snapshot (Transport beat).
  await page.getByRole('button', { name: 'Restart story' }).click();
  await expect(question(page)).toHaveAttribute('data-q', 'message');

  // Keyboard: Space completes typing then advances; ← goes back; Skip chapter jumps ahead.
  await routedTcpStory(page);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Space'); // completes typing
  await expect(page.getByTestId('story-caption')).toHaveAttribute('data-done', '');
  const first = await player(page).getAttribute('data-beat');
  await page.keyboard.press('Space');
  await expect(player(page)).not.toHaveAttribute('data-beat', first ?? '');
  await page.keyboard.press('ArrowLeft');
  await expect(player(page)).toHaveAttribute('data-beat', first ?? '');
  await page.getByRole('button', { name: 'Skip chapter' }).click();
  await expect(player(page)).toHaveAttribute('data-chapter', 'journey');
  await expect(page.getByTestId('story-rail').locator('[aria-current="step"]')).toContainText('Journey');
});

test('UDP story has no handshake or ACK beats', async ({ page }) => {
  await page.goto('/');
  await routedTcpStory(page, { protocol: 'UDP' });
  const built = await page.evaluate(() => window.__pj.story?.() ?? []);
  expect(built.some((b) => ['state', 'ack', 'ack-send'].includes(b.kind))).toBe(false);
  expect(built.filter((b) => b.chapter === 'encap').map((b) => b.layer)).toEqual(['app', 'transport', 'internet', 'link', 'physical']);
  await finishTyping(page);
  await expect(page.getByTestId('story-caption-log')).toContainText('Application · your message');
});

test('Reduced motion shows the full text at once; the caret is static', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('group', { name: 'Motion' }).getByRole('button', { name: 'Reduced' }).click();
  await expect(page.getByTestId('story-prompt')).toHaveAttribute('data-done', '');
  await expect(page.getByTestId('story-answer')).toBeVisible();
  await routedTcpStory(page);
  await expect(page.getByTestId('story-caption')).toHaveAttribute('data-done', ''); // no typing at all
});

test('switching to Lab mid-story keeps the config and the selected event; Lab can replay as a story; story resumes after reload', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await routedTcpStory(page, { message: 'Ping!' });
  for (let i = 0; i < 3; i++) {
    await finishTyping(page);
    await beatNext(page).click();
  }
  const beatId = await player(page).getAttribute('data-beat');
  const step = await page.getByTestId('journey-step').textContent();
  await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Lab' }).click();
  await expect(page.locator('#msg')).toHaveValue('Ping!');
  await expect(page.locator('#scope')).toHaveValue('routed');
  await expect(page.getByRole('group', { name: 'Protocol' }).getByRole('button', { name: 'TCP' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('journey-step')).toHaveText(step ?? '');
  await expect(page.getByTestId('dirty')).toHaveCount(0); // Lab shows the story's run unchanged

  await page.getByTestId('replay-story').click();
  await expect(player(page)).toHaveAttribute('data-chapter', 'encap');
  await finishTyping(page);
  await beatNext(page).click();
  await beatNext(page).click(); // completes typing of beat 2
  const resumed = await player(page).getAttribute('data-beat');
  await page.reload();
  await expect(player(page)).toHaveAttribute('data-beat', resumed ?? '');
  expect(beatId).not.toBeNull();
});
