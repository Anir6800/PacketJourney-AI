import { expect, test, type Page } from '@playwright/test';

// Phase 09: one playback clock drives the master timeline, the 3D stage and every panel.

type M = {
  pt: number; playing: boolean; speed: number; duration: number; index: number; progress: number; vt: number; kind: string | null;
  loops: number; consumedMs: number; masterTime: number; masterDuration: number; span: number; activeTweens: number;
};

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

const motion = (page: Page) => page.evaluate(() => window.__pj.motion?.() as unknown) as Promise<M>;
const ready = (page: Page) => page.waitForFunction(() => window.__pj.stageReady && typeof window.__pj.motion === 'function' && typeof window.__pj.scene === 'function');
const seek = (page: Page, pt: number) => page.evaluate((t) => window.__pj.seek?.(t), pt);
const runBtn = (page: Page) => page.getByRole('button', { name: /^Run (new simulation|again)$/ });
const play = (page: Page) => page.getByTestId('play').click();

async function routedTcp(page: Page) {
  await page.locator('#scope').selectOption('routed');
  await page.getByRole('group', { name: 'Protocol' }).getByRole('button', { name: 'TCP' }).click();
  await runBtn(page).click();
  await page.waitForTimeout(300);
}

/** Everything a viewer can see that must be reproducible at a given presentation time. */
const visible = async (page: Page) => {
  // The Canvas commits through its own React root: wait until the mounted scene shows the clock's event.
  await page.waitForFunction(
    () => (window.__pj.scene?.() as { step: number }).step === (window.__pj.motion?.() as { index: number }).index,
    null,
    { polling: 50, timeout: 5000 },
  );
  // Cue progress is applied in useFrame: let the requested frame render before reading.
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  return page.evaluate(() => {
    const sc = window.__pj.scene?.() as { step: number; presentShells: unknown; shellVisuals: unknown; packetPos: unknown; labels: unknown };
    const m = window.__pj.motion?.() as { index: number; vt: number };
    const txt = (sel: string) => document.querySelector(sel)?.textContent ?? '';
    return JSON.stringify({
      index: m.index, vt: m.vt, step: sc.step, shells: sc.presentShells, visuals: sc.shellVisuals, packet: sc.packetPos, labels: sc.labels,
      decoder: txt('.decoder-head') + '|' + txt('[data-testid=decoder-value]'),
      tcp: Array.from(document.querySelectorAll('[data-testid^=tcp-state-]'), (e) => e.textContent).join(','),
      seq: Array.from(document.querySelectorAll('[data-testid^=snd-nxt-], [data-testid^=rcv-nxt-]'), (e) => e.textContent).join(','),
      ladder: Array.from(document.querySelectorAll('[data-arrow]'), (e) => getComputedStyle(e).strokeDashoffset).join(','),
      timestamp: txt('[data-testid=timestamp]'),
      caption: txt('[data-testid=journey-caption]'),
    });
  });
};

test('master timeline duration equals the mapped event span; starts paused at the end, no rAF', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const m = await motion(page);
  expect(m.masterDuration).toBeCloseTo(m.span, 6);
  expect(m.duration).toBeCloseTo(m.span, 6);
  expect(m.pt).toBeCloseTo(m.span, 6);
  expect(m.masterTime).toBeCloseTo(m.span, 6);
  expect([m.playing, m.loops, m.activeTweens]).toEqual([false, 0, 0]);
  await routedTcp(page);
  const r = await motion(page);
  expect(r.masterDuration).toBeCloseTo(r.span, 6);
  expect(r.span).toBeGreaterThan(m.span);
});

test('no double speed under StrictMode; pause freezes 3D packet, GSAP timeline and timestamp together', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await routedTcp(page);
  await seek(page, 0);
  const m0 = await motion(page);
  const t0 = await page.evaluate(() => performance.now());
  await play(page);
  await page.waitForTimeout(1500);
  const [m1, t1] = await Promise.all([motion(page), page.evaluate(() => performance.now())]);
  // One loop never consumes more wall time than passed (a duplicated StrictMode loop would consume ≈2×),
  // and PT = consumed × speed exactly. (Raw PT/wall rates depend on machine load under SwiftShader.)
  const consumed = (m1.consumedMs - m0.consumedMs) / 1000;
  expect(consumed).toBeGreaterThan(0);
  expect(consumed).toBeLessThanOrEqual((t1 - t0) / 1000 + 0.05);
  expect(m1.pt).toBeCloseTo(consumed, 6);
  expect(m1.loops).toBe(1);

  await play(page); // pause
  const a = await motion(page);
  const va = await visible(page);
  await page.waitForTimeout(700);
  const b = await motion(page);
  const vb = await visible(page);
  expect(b.pt).toBe(a.pt);
  expect(b.masterTime).toBe(a.masterTime);
  expect(a.masterTime).toBeCloseTo(a.pt, 6);
  expect(vb).toBe(va); // packet position, shells, timestamp, ladder all frozen
  expect([b.playing, b.loops, b.activeTweens]).toEqual([false, 0, 0]);
});

test('speed changes viewing duration only: virtual timestamps and metrics identical', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await ready(page);
  // Same-LAN UDP: short span. End state before playing (1× semantics, no playback at all):
  const endBefore = await visible(page);
  const statusBefore = await page.getByTestId('dock-status').textContent();
  const samples = [0.4, 2.2, 5.05, 9.3];
  const at1: string[] = [];
  for (const s of samples) {
    await seek(page, s);
    at1.push(await visible(page));
  }
  // Viewing rate through the real rAF loop: PT gained per wall second the loop consumed equals the speed exactly.
  // (Raw wall-clock rates under headless SwiftShader vary run to run; the loop's own wall budget does not.)
  const rateAt = async (label: string) => {
    await page.getByRole('group', { name: 'Speed' }).getByRole('button', { name: label }).click();
    await seek(page, 0);
    const a = await motion(page);
    await play(page);
    await page.waitForTimeout(1500);
    await play(page);
    const b = await motion(page);
    return (b.pt - 0) / ((b.consumedMs - a.consumedMs) / 1000);
  };
  const r1 = await rateAt('1×');
  const r2 = await rateAt('2×');
  console.log(`PT per consumed wall second: 1× ${r1.toFixed(6)}, 2× ${r2.toFixed(6)}`);
  expect(r1).toBeCloseTo(1, 6);
  expect(r2).toBeCloseTo(2, 6);
  // Play to the end at 2×: the final state equals the unplayed end state.
  await play(page);
  await page.waitForFunction(() => (window.__pj.motion?.() as { playing: boolean }).playing === false, null, { timeout: 60_000 });
  const m = await motion(page);
  expect(m.pt).toBeCloseTo(m.span, 6);
  expect(await visible(page)).toBe(endBefore);
  expect(await page.getByTestId('dock-status').textContent()).toBe(statusBefore);
  for (const [i, s] of samples.entries()) {
    await seek(page, s);
    expect(JSON.parse(await visible(page)), `sample ${s}`).toEqual(JSON.parse(at1[i] ?? "{}"));
  }
});

test('scrubbing backward through 12 sampled times reproduces the forward states exactly', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await ready(page);
  await routedTcp(page);
  const { span } = await motion(page);
  const times = Array.from({ length: 12 }, (_, i) => Number(((span * (i + 0.37)) / 12).toFixed(3)));
  const fwd = new Map<number, string>();
  // Forward play to each sample (the clock runs, then pauses), …
  await seek(page, 0);
  await page.getByRole('group', { name: 'Speed' }).getByRole('button', { name: '2×' }).click();
  for (const t of times) {
    await seek(page, t);
    await page.waitForTimeout(120);
    fwd.set(t, await visible(page));
  }
  // … then scrub backward with the range input itself.
  const scrub = page.getByTestId('scrub');
  for (const t of [...times].reverse()) {
    await scrub.evaluate((el, v) => {
      const input = el as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, String(v));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, t);
    await page.waitForTimeout(120);
    const back = await visible(page);
    expect(JSON.parse(back), `t = ${t}`).toEqual(JSON.parse(fwd.get(t) ?? "{}"));
  }
  // Shells mid-wrap are partly scaled (motion actually happens), and differ from the cue's end.
  const wrap = await page.evaluate(() => {
    const evs = Array.from(document.querySelectorAll('[data-testid=events] .ev-tag'), (e) => e.textContent);
    return evs.indexOf('encap:link');
  });
  await page.getByTestId('events').locator('li').nth(wrap).locator('summary').click();
  const end = (await motion(page)).pt;
  await seek(page, end - 0.25);
  await page.waitForTimeout(150);
  const mid = await page.evaluate(() => (window.__pj.scene?.() as { shellVisuals: { layer: string; scale: number }[] }).shellVisuals.find((s) => s.layer === 'link')?.scale ?? 0);
  expect(mid).toBeGreaterThan(0.34); // 1.15 → 1 wrap still in progress (radius 0.34)
});

test('reset leaves zero active tweens and no rAF loop; new runs too', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await play(page);
  await page.waitForTimeout(400);
  expect((await motion(page)).loops).toBe(1);
  await page.getByRole('button', { name: 'Rewind to start' }).click();
  const m = await motion(page);
  expect([m.pt, m.playing, m.loops, m.activeTweens]).toEqual([0, false, 0, 0]);
  await play(page);
  await page.waitForTimeout(200);
  await runBtn(page).click();
  const r = await motion(page);
  expect([r.playing, r.loops, r.activeTweens]).toEqual([false, 0, 0]);
  expect(r.pt).toBeCloseTo(r.span, 6);
});

test('Reduced motion: shells switch instantly, no scramble, no camera move, still steppable', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await routedTcp(page);
  await page.getByRole('group', { name: 'Motion' }).getByRole('button', { name: 'Reduced' }).click();
  const idx = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid=events] .ev-tag'), (e) => e.textContent).indexOf('encap:link'));
  await page.getByTestId('events').locator('li').nth(idx).locator('summary').click();
  const end = (await motion(page)).pt;
  await seek(page, end - 0.3); // mid-cue
  await page.waitForTimeout(150);
  const s = await page.evaluate(() => window.__pj.scene?.() as { shellVisuals: { layer: string; scale: number; opacity: number }[] });
  expect(s.shellVisuals.find((v) => v.layer === 'link')).toMatchObject({ scale: 0.34, opacity: 0.22 }); // final state at once
  const dec = await page.getByTestId('decoder-value').textContent();
  expect(dec).toMatch(/^FCS [0-9A-F]{2}( [0-9A-F]{2}){3}$/); // real value immediately, no scramble
  expect(await page.getByTestId('fx-status').textContent()).toBe('Effects off · Reduced motion');
  // Follow rig: the camera jumps (no dolly) when stepping.
  await page.getByRole('group', { name: 'Camera' }).getByRole('button', { name: 'Follow packet' }).click();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  const m = await motion(page);
  expect(m.index).toBe(idx + 1);
});

test('hidden tab pauses with a visible note; keyboard shortcuts are guarded in fields; one live announcer', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await play(page);
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect((await motion(page)).playing).toBe(false);
  await expect(page.getByTestId('hidden-pause')).toContainText('Paused: tab was hidden');
  await expect(page.locator('html')).toHaveAttribute('data-hidden', 'true');
  expect(await page.locator('.grid-plane').evaluate((el) => getComputedStyle(el).animationPlayState)).toBe('paused');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('html')).toHaveAttribute('data-hidden', 'false');

  // Space on the page toggles play; Space inside the message field types a space instead.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Space');
  expect((await motion(page)).playing).toBe(true);
  await page.keyboard.press('Space');
  expect((await motion(page)).playing).toBe(false);
  await expect(page.getByTestId('hidden-pause')).toHaveCount(0);
  await page.locator('#msg').focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Space');
  expect((await motion(page)).playing).toBe(false);
  await expect(page.locator('#msg')).toHaveValue('Hello ');
  const before = await motion(page);
  await page.keyboard.press('ArrowLeft'); // moves the caret, not the timeline
  expect((await motion(page)).pt).toBe(before.pt);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Home');
  expect((await motion(page)).pt).toBe(0);
  await page.keyboard.press('ArrowRight');
  expect((await motion(page)).index).toBe(1); // Home → event 0, ArrowRight → event 1

  // Exactly one polite live region speaks per event (the console log is a separate role=log).
  expect(await page.locator('[aria-live="polite"]:not([role="log"])').count()).toBe(1);
  await expect(page.getByTestId('announcer')).toContainText('Step 2:');
});
