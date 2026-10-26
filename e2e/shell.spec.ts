import { expect, test, type Page } from '@playwright/test';

// Lab Mode: these specs drive the configuration form directly (Story Mode is the first-run default).
const skipBoot = (page: Page) =>
  page.addInitScript(() => {
    sessionStorage.setItem('pj.booted', '1');
    sessionStorage.setItem('pj.mode', 'lab');
  });

const gsapWarnings: string[] = [];
test.beforeEach(({ page }) => {
  page.on('console', (m) => (/gsap/i.test(m.text()) || m.type() === 'error') && gsapWarnings.push(m.text()));
});
test.afterEach(() => {
  // Fails on any GSAP warning or any console error (e.g. React key collisions).
  expect(gsapWarnings.splice(0), 'GSAP warnings / console errors').toEqual([]);
});

test('dark shell shows SIMULATED badge and AI status', async ({ page }) => {
  await skipBoot(page);
  await page.goto('/');
  await expect(page.getByTestId('simulated-badge')).toHaveText('SIMULATED');
  // Whether AI is configured depends on the local .env; the badge must match what the server reports.
  const health = (await (await page.request.get('/api/health')).json()) as { aiConfigured: boolean };
  await expect(page.getByTestId('ai-status')).toHaveText(health.aiConfigured ? 'online' : 'server up · AI not configured');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(5, 7, 13)');
});

test('View 2D shows the SVG fallback', async ({ page }) => {
  await skipBoot(page);
  await page.goto('/');
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: '2D' }).click();
  await expect(page.getByTestId('stage-2d')).toContainText('View set to 2D');
  await expect(page.locator('canvas')).toHaveCount(0);
});

test('boot: plays once under StrictMode, completes, then never replays this session', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__pj.bootCompletions === 1, null, { timeout: 4000 });
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__pj.bootCompletions)).toBe(1);
  expect(await page.evaluate(() => window.__pj.gsapActive())).toBe(0);
  await page.reload();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__pj.bootCompletions)).toBe(0);
  await expect(page.locator('.wordmark-text')).toHaveText('PacketJourney');
});

test('boot: skippable by key and by click', async ({ browser }) => {
  for (const how of ['key', 'click'] as const) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForTimeout(150);
    if (how === 'key') await page.keyboard.press('Shift');
    else await page.mouse.click(5, 5);
    expect(await page.evaluate(() => window.__pj.bootCompletions)).toBe(1);
    expect(await page.evaluate(() => window.__pj.gsapActive())).toBe(0);
    await expect(page.locator('.wordmark-text')).toHaveText('PacketJourney');
    const opacities = await page.locator('.hud-enter, .badge-sim').evaluateAll((els) => els.map((e) => getComputedStyle(e).opacity));
    expect(opacities.every((o) => o === '1')).toBe(true);
    await ctx.close();
  }
});

test('reduced motion: final states, no tweens, console text instant', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByRole('group', { name: 'Motion' }).getByRole('button', { name: 'Reduced' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__pj.gsapActive())).toBe(0);
  expect(await page.evaluate(() => window.__pj.bootCompletions)).toBe(0);
  await expect(page.locator('.wordmark-text')).toHaveText('PacketJourney');
  await expect(page.getByTestId('console-log').locator('p')).toHaveCount(5);
  expect(await page.locator('.grid-plane').evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
  await ctx.close();
});

test('TypedConsole: Enter completes a line; each line announced once', async ({ page }) => {
  await skipBoot(page);
  await page.goto('/');
  const log = page.getByTestId('console-log').locator('p');
  const con = page.getByTestId('console');
  await con.focus();
  for (let i = 1; i <= 5; i++) {
    await page.keyboard.press('Enter');
    await expect(log).toHaveCount(i);
  }
  const texts = await log.allTextContents();
  expect(new Set(texts).size).toBe(5);
  expect(texts[0]).toContain('5 bytes UTF-8: 48 65 6C 6C 6F');
  expect(texts[1]).toContain('UDP header 8 B → datagram 13 B');
  expect(texts[2]).toContain('total length 33');
  expect(texts[3]).toContain('frame 64 B');
});

const tags = (page: Page) => page.getByTestId('events').locator('.ev-tag').allTextContents();
const row = (page: Page, tag: string, nth = 0) =>
  page
    .getByTestId('events')
    .locator('li')
    .filter({ has: page.locator('.ev-tag', { hasText: new RegExp(`^${tag}$`) }) })
    .nth(nth);
const runBtn = (page: Page) => page.getByRole('button', { name: /^Run (new simulation|again)$/ });

test('Headers: selecting a field highlights its exact byte offsets', async ({ page }) => {
  await skipBoot(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('group', { name: 'Protocol' }).getByRole('button', { name: 'TCP' }).click();
  await runBtn(page).click();
  await page.getByRole('tab', { name: 'Headers' }).click();
  const hl = () => page.locator('.byte[data-hl]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-off'))));

  await page.getByTestId('field-ipv4.totalLength').click();
  expect(await hl()).toEqual([16, 17]);
  await expect(page.getByTestId('field-detail')).toContainText('16–17');
  await expect(page.getByTestId('field-ipv4.totalLength')).toContainText('45 (0x002D)');

  await page.getByTestId('field-ethernet.dst').click();
  expect(await hl()).toEqual([0, 1, 2, 3, 4, 5]);

  await page.getByTestId('field-tcp.syn').click(); // 1-bit flag inside byte 34+13
  expect(await hl()).toEqual([47]);
  await expect(page.getByTestId('hl-range')).toContainText('bits');

  await page.getByTestId('field-fcs.crc32').click();
  expect(await hl()).toEqual([60, 61, 62, 63]);
  await expect(page.locator('.bytegrid')).toBeInViewport();
  await page.screenshot({ path: 'test-results/headers-1440.png' });

  await page.getByRole('group', { name: 'Protocol' }).getByRole('button', { name: 'UDP' }).click();
  await runBtn(page).click();
  await page.getByTestId('field-udp.length').click();
  expect(await hl()).toEqual([38, 39]);
  await expect(page.getByTestId('field-udp.length')).toContainText('13 (0x000D)');
});

test('payload validation: byte count, non-ASCII, oversize not truncated', async ({ page }) => {
  await skipBoot(page);
  await page.goto('/');
  const input = page.getByLabel('Message');
  await input.fill('héllo ✓');
  await expect(page.getByTestId('byte-count')).toHaveText('10 / 256 bytes · 7 characters');
  await page.getByRole('button', { name: 'Run new simulation' }).click();
  await expect(page.getByTestId('reps').locator('li')).toHaveCount(7);
  await expect(page.getByTestId('reps')).toContainText('E2 9C 93');
  await input.fill('é'.repeat(129));
  await expect(page.getByTestId('byte-count')).toHaveText('258 / 256 bytes · 129 characters');
  await expect(page.getByRole('alert')).toContainText('Nothing was truncated');
  await expect(page.getByRole('button', { name: 'Run new simulation' })).toBeDisabled();
  expect(await input.inputValue()).toHaveLength(129);
});

test('run lifecycle: one event history, dirty draft, explicit run/reset, deterministic re-run', async ({ page }) => {
  await skipBoot(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const first = await tags(page);
  expect(first[0]).toBe('session:start');
  expect(first).not.toContain('hop:R1:forward'); // default: same-LAN UDP
  await expect(page.getByTestId('dock-status')).toContainText(`${first.length} events`);

  // Same config + seed → identical history on re-run.
  await expect(page.getByTestId('run-info')).toContainText('Run #1');
  await page.getByRole('button', { name: 'Run again' }).click();
  await expect(page.getByTestId('run-info')).toContainText('Run #2');
  expect(await tags(page)).toEqual(first);

  // Editing marks the draft dirty; the running history is untouched until Run.
  await page.getByRole('group', { name: 'Protocol' }).getByRole('button', { name: 'TCP' }).click();
  await expect(page.getByTestId('dirty')).toBeVisible();
  expect(await tags(page)).toEqual(first);
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByTestId('dirty')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Protocol' }).getByRole('button', { name: 'UDP' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('group', { name: 'Protocol' }).getByRole('button', { name: 'TCP' }).click();
  await page.getByLabel('Destination', { exact: true }).selectOption('routed');
  await expect(page.getByLabel('IPv4 address').first()).toBeDisabled();
  await runBtn(page).click();
  await expect(page.getByTestId('dirty')).toHaveCount(0);
  expect(await tags(page)).toContain('hop:R1:forward');

  // Selecting an event shows the reducer snapshot at that index.
  await row(page, 'tcp:state:ESTABLISHED').locator('summary').click();
  await expect(page.getByTestId('snapshot-detail')).toContainText('Snapshot after #');
  await expect(page.getByTestId('snapshot-detail')).toContainText('ESTABLISHED');
  await page.screenshot({ path: 'test-results/events-1440.png' });
});

test('UDP slice: Hello delivered unchanged, transport/app statuses, configured reply, no ACKs', async ({ page }) => {
  await skipBoot(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const t = await tags(page);
  expect(t.filter((x) => /ack|syn|timer|retransmit|fin/.test(x))).toEqual([]);
  expect(t).toEqual(expect.arrayContaining(['verify:link', 'verify:internet', 'verify:transport', 'socket:select', 'app:processed', 'app:respond']));

  // Receiver: transport accepted first, application processed after.
  await row(page, 'decap:transport').locator('summary').click();
  await expect(page.getByTestId('rx-transport')).toContainText('accepted');
  await expect(page.getByTestId('rx-app')).toContainText('pending');
  await row(page, 'deliver:app').locator('summary').click();
  await expect(page.getByTestId('journey-caption')).toContainText('"Hello" delivered to B echo app');
  await expect(page.getByTestId('lbytes-app')).toHaveText('48 65 6C 6C 6F');
  await page.getByRole('button', { name: 'Next event' }).click();
  await expect(page.getByTestId('journey-caption')).toContainText('app:processed');
  await expect(page.getByTestId('rx-app')).toContainText('processed');
  await page.screenshot({ path: 'test-results/udp-journey-1440.png' });

  // Reply arrives at A with the configured text.
  await row(page, 'deliver:app', 1).locator('summary').click();
  await expect(page.getByTestId('journey-caption')).toContainText('"World" delivered to A client app');

  // Layer cards show the actual frame bytes on the wire.
  await row(page, 'hop:A:egress').locator('summary').click();
  await expect(page.getByTestId('lbytes-link')).toHaveText(/^02 00 00 00 0A 20 02 00 00 00 0A 10 08 00$/);
  await expect(page.getByTestId('lbytes-transport')).toHaveText(/^C3 50 1B 5F 00 0D /);
  await expect(page.getByTestId('packet-marker')).toBeVisible();

  // Expandable field details.
  const enc = row(page, 'encap:transport');
  await enc.locator('summary').click();
  await expect(enc.getByTestId('ev-details')).toBeVisible();
  await expect(enc.getByTestId('ev-details')).toContainText('Source port');
  await expect(enc.getByTestId('ev-details')).toContainText('50000 (0xC350)');
  await expect(page.getByTestId('udp-checksum-note')).toContainText('RFC 768');
});

test('UDP slice: wrong port reaches no app; reply can be disabled; invalid input blocks the run', async ({ page }) => {
  await skipBoot(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  await page.getByLabel('Send to destination port').fill('9999');
  await runBtn(page).click();
  let t = await tags(page);
  expect(t).toContain('socket:none');
  expect(t).not.toContain('deliver:app');
  expect(t).not.toContain('app:respond');
  await row(page, 'socket:none').locator('summary').click();
  await expect(page.getByTestId('rx-transport')).toContainText('rejected');
  await expect(page.getByTestId('journey-caption')).toContainText('No application on UDP port 9999');

  await page.getByLabel('Send to destination port').fill('7007');
  await page.getByLabel('Echo app replies').uncheck();
  await runBtn(page).click();
  t = await tags(page);
  expect(t).toContain('deliver:app');
  expect(t).not.toContain('app:respond');

  const ip = page.locator('#client-ip');
  await ip.fill('192.168.1.300');
  await expect(page.locator('#client-ip-err')).toContainText('0–255');
  await expect(ip).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#server-mac').fill('01:00:5e:00:00:01');
  await expect(page.locator('#server-mac-err')).toContainText('unicast');
  await page.locator('#client-port').fill('0');
  await expect(page.locator('#client-port-err')).toContainText('1–65535');
  await expect(page.getByTestId('blocked')).toContainText('fix 3 fields');
  await expect(runBtn(page)).toBeDisabled();
  await page.screenshot({ path: 'test-results/udp-invalid-1440.png', fullPage: true });
  await ip.fill('192.0.2.20'); // duplicate of server
  await page.locator('#server-mac').fill('02:00:00:00:0a:20');
  await page.locator('#client-port').fill('50000');
  await expect(page.locator('#server-ip-err')).toContainText('different IPv4');
  await expect(runBtn(page)).toBeDisabled();
});

test('TCP: handshake states, exact seq/ACK in cards, headers and log; switching to UDP clears TCP state', async ({ page }) => {
  await skipBoot(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('group', { name: 'Protocol' }).getByRole('button', { name: 'TCP' }).click();
  await expect(page.locator('#isn-client')).toHaveValue('1000');
  await expect(page.locator('#isn-server')).toHaveValue('5000');
  await runBtn(page).click();

  const t = await tags(page);
  expect(t.slice(0, 3)).toEqual(['tcp:state:LISTEN', 'app:send', 'tcp:connect']);
  expect(t.indexOf('tcp:state:SYN-SENT')).toBeLessThan(t.indexOf('tcp:state:SYN-RECEIVED'));
  await expect(page.getByTestId('four-tuple')).toHaveText('192.0.2.10:50000 ↔ 192.0.2.20:7007');

  // After SYN-SENT: client SYN-SENT, server still LISTEN.
  await row(page, 'tcp:state:SYN-SENT').locator('summary').click();
  await expect(page.getByTestId('tcp-state-A')).toHaveText('SYN-SENT');
  await expect(page.getByTestId('tcp-state-B')).toHaveText('LISTEN');
  await expect(page.getByTestId('snd-nxt-A')).toHaveText('1001');
  await expect(page.getByTestId('packet-marker')).toHaveCount(0); // state event: no packet in flight

  // SYN-ACK header bytes in the log.
  const synAck = page.getByTestId('events').locator('li').filter({ hasText: 'TCP header [SYN, ACK] seq 5000 ack 1001' });
  await expect(synAck).toHaveCount(1);

  // Final state: both ESTABLISHED, numbers match the spec fixture.
  await page.getByRole('button', { name: 'Last event' }).click();
  await expect(page.getByTestId('tcp-state-A')).toHaveText('ESTABLISHED');
  await expect(page.getByTestId('tcp-state-B')).toHaveText('ESTABLISHED');
  await expect(page.getByTestId('snd-nxt-A')).toHaveText('1006');
  await expect(page.getByTestId('rcv-nxt-A')).toHaveText('5006');
  await expect(page.getByTestId('snd-nxt-B')).toHaveText('5006');
  await expect(page.getByTestId('rcv-nxt-B')).toHaveText('1006');
  await page.screenshot({ path: 'test-results/tcp-1440.png' });
  await expect(page.getByTestId('events').locator('li').filter({ hasText: 'TCP header [ACK] seq 5001 ack 1006' })).toHaveCount(1);
  await expect(page.getByTestId('events').locator('li').filter({ hasText: 'TCP header [ACK] seq 1006 ack 5006' })).toHaveCount(1);

  // Transport ACK before application processing.
  const all = await tags(page);
  const deliverB = all.indexOf('deliver:app');
  expect(all.indexOf('app:processed', deliverB)).toBeGreaterThan(all.indexOf('encap:transport', deliverB));

  // Headers tab shows the data segment's numbers.
  await page.getByRole('tab', { name: 'Headers' }).click();
  await expect(page.getByTestId('field-tcp.seqNumber')).toContainText('1001');
  await expect(page.getByTestId('field-tcp.ackNumber')).toContainText('5001');

  // Switching protocol clears TCP state from the stage.
  await page.getByRole('tab', { name: 'Journey' }).click();
  await page.getByRole('group', { name: 'Protocol' }).getByRole('button', { name: 'UDP' }).click();
  await runBtn(page).click();
  await expect(page.getByTestId('tcp-cards')).toHaveCount(0);
  expect((await tags(page)).some((x) => x.startsWith('tcp:'))).toBe(false);
});

test('Routed: three hops, per-hop MACs, unchanged IPs, scope overlays, TTL 1 expiry', async ({ page }) => {
  await skipBoot(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByLabel('Destination', { exact: true }).selectOption('routed');
  await runBtn(page).click();
  const t = await tags(page);
  for (const tag of ['hop:A:egress', 'hop:R1:forward', 'hop:R1:egress', 'hop:R2:forward', 'hop:R2:egress', 'hop:B:ingress']) expect(t).toContain(tag);
  expect(t.filter((x) => x === 'deliver:app')).toHaveLength(2); // request + reply via the reverse route

  // Hop scope (default): R1 → R2 link, MACs of that link.
  await row(page, 'hop:R1:egress').locator('summary').click();
  await expect(page.getByTestId('scope-panel')).toHaveAttribute('data-scope', 'hop');
  await expect(page.getByTestId('scope-src-mac')).toHaveText('02:00:00:00:01:01');
  await expect(page.getByTestId('scope-dst-mac')).toHaveText('02:00:00:00:02:00');
  await expect(page.getByTestId('svg-link-L2')).toHaveAttribute('data-scoped', '');
  await expect(page.getByTestId('arp-note')).toContainText('prepopulated');
  await page.screenshot({ path: 'test-results/routed-hop-1440.png' });

  // Host scope: endpoint IPs unchanged, TTL decremented once.
  await page.getByRole('group', { name: 'Delivery scope' }).getByRole('button', { name: 'Host ↔ host' }).click();
  await expect(page.getByTestId('scope-src-ip')).toHaveText('192.0.2.10');
  await expect(page.getByTestId('scope-dst-ip')).toHaveText('203.0.113.20');
  await expect(page.getByTestId('scope-ttl')).toHaveText('63');
  await expect(page.getByTestId('scope-arc')).toBeVisible();

  // Route lookup at R2 highlights the matched route.
  await row(page, 'route:lookup', 2).locator('summary').click();
  await page.getByRole('group', { name: 'Delivery scope' }).getByRole('button', { name: 'Hop ↔ hop' }).click();
  await page.getByText('Route table of R2').click();
  await expect(page.locator('.routes li[data-hot]')).toHaveText('203.0.113.0/24 directly connected dev eth1');

  // TCP over the routed path: end-to-end connection.
  await page.getByRole('group', { name: 'Protocol' }).getByRole('button', { name: 'TCP' }).click();
  await runBtn(page).click();
  await page.getByRole('group', { name: 'Delivery scope' }).getByRole('button', { name: 'Process ↔ process' }).click();
  await expect(page.getByTestId('scope-panel')).toContainText('end-to-end');
  await expect(page.getByRole('group', { name: 'Delivery scope' }).getByRole('button', { name: 'Process ↔ process' })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300); // let the 160 ms button transition settle before capturing evidence
  await page.screenshot({ path: 'test-results/routed-process-1440.png' });

  // TTL 1: dropped at R1, nothing delivered.
  await page.getByRole('group', { name: 'Protocol' }).getByRole('button', { name: 'UDP' }).click();
  await page.getByLabel('Initial TTL').fill('1');
  await runBtn(page).click();
  const t1 = await tags(page);
  expect(t1).toContain('drop:ttl');
  expect(t1).not.toContain('hop:R1:egress');
  expect(t1).not.toContain('deliver:app');
  await row(page, 'drop:ttl').locator('summary').click();
  await expect(page.getByTestId('journey-caption')).toContainText('R1 drops the packet: TTL 1');
  await expect(page.getByTestId('journey-caption')).toContainText('ICMP Time Exceeded is NOT BUILT');
  await page.getByLabel('Initial TTL').fill('0');
  await expect(page.locator('#ttl-err')).toContainText('1–255');
});

test('keyboard reaches mode switch, tabs and inspector (1440)', async ({ page }) => {
  await skipBoot(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    seen.add(
      await page.evaluate(() => {
        const a = document.activeElement;
        if (!a) return '';
        if (a.closest('[aria-label="Mode"]')) return 'mode';
        if (a.getAttribute('role') === 'tab') return 'tab';
        if (a.closest('#inspector')) return 'inspector';
        return a.tagName;
      }),
    );
  }
  expect([...seen]).toEqual(expect.arrayContaining(['mode', 'tab']));
  // Inspector has no focusables of its own yet besides the region; reach it via a layer row.
  await page.getByRole('button', { name: /Internet/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#inspector h2')).toContainText('Internet');
  // Arrow keys move between tabs.
  await page.getByRole('tab', { name: 'Journey' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Headers' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Headers' })).toHaveAttribute('aria-selected', 'true');
});

test('1280: inspector is a keyboard-operable drawer', async ({ page }) => {
  await skipBoot(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Inspector' });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#inspector')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close inspector' })).toBeFocused();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/vp-1280-drawer.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('#inspector')).toHaveAttribute('inert', '');
});

for (const [w, h] of [[1440, 900], [1280, 800], [390, 844]] as const) {
  test(`layout ${w}x${h}: no horizontal overflow or clipping`, async ({ page }) => {
    await skipBoot(page);
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/');
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('button, input, select, h1, .badge, [role=tab], .stack-row, .hud-label')]
        .filter((el) => !el.closest('[inert]') && el.offsetParent !== null)
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.right > window.innerWidth + 0.5 || r.left < -0.5 || el.scrollWidth > el.clientWidth + 1;
        })
        .map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(clipped).toEqual([]);
    // Every tab fully inside its tablist (no hidden overflow).
    const tabsFit = await page.evaluate(() => {
      const list = document.querySelector('[role=tablist]')?.getBoundingClientRect();
      return [...document.querySelectorAll('[role=tab]')].every((t) => {
        const r = t.getBoundingClientRect();
        return list && r.left >= list.left - 0.5 && r.right <= list.right + 0.5;
      });
    });
    expect(tabsFit).toBe(true);
    // Units must stay lowercase despite the uppercase HUD label (ms ≠ MS).
    await expect(page.getByTestId('dock-status')).toContainText(/virtual end \d+\.\d{3} ms/);
    await page.screenshot({ path: `test-results/vp-${w}.png`, fullPage: true });
  });
}

test('core app runs with AI server down', async ({ page }) => {
  await skipBoot(page);
  await page.route('**/api/health', (r) => r.abort());
  await page.goto('/');
  await expect(page.getByTestId('simulated-badge')).toBeVisible();
  await expect(page.getByTestId('ai-status')).toHaveText('offline · core app unaffected');
  await page.waitForFunction(() => window.__pj.stageReady);
  // The deliberately aborted /api/health request is the only console error allowed here.
  const problems = gsapWarnings.splice(0);
  expect(problems.every((p) => p.includes('net::ERR_FAILED'))).toBe(true);
});

test('Close + HTTP session: FIN states, cookie survives connection A, B recognized; UDP disables HTTP', async ({ page }) => {
  await skipBoot(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('group', { name: 'Protocol' }).getByRole('button', { name: 'TCP' }).click();

  // Raw close: full close sequence and educational TIME-WAIT.
  await page.getByLabel('Close the connection after the exchange').check();
  await runBtn(page).click();
  const t = await tags(page);
  const order = ['tcp:state:FIN-WAIT-1', 'tcp:state:CLOSE-WAIT', 'tcp:state:FIN-WAIT-2', 'tcp:state:LAST-ACK', 'tcp:state:TIME-WAIT', 'timer:fire:time-wait'];
  for (let i = 1; i < order.length; i++) expect(t.indexOf(order[i - 1] ?? ''), order[i]).toBeLessThan(t.indexOf(order[i] ?? ''));
  await expect(page.getByTestId('tcp-state-A')).toHaveText('CLOSED');
  await expect(page.getByTestId('tcp-state-B')).toHaveText('CLOSED');
  await expect(page.getByTestId('time-wait-A')).toContainText('educational');

  // HTTP session demo.
  await page.locator('#payload-mode').selectOption('http');
  await runBtn(page).click();
  const panel = page.getByTestId('session-panel');
  await expect(panel.getByTestId('session-verdict')).toHaveText('unrecognized');
  await expect(panel.getByTestId('http-request')).toContainText('GET / HTTP/1.1␍␊');
  await expect(panel.getByTestId('http-response')).toContainText('Content-Length: 43');
  const issued = (await panel.getByTestId('session-issued').textContent()) ?? '';
  expect(issued).toMatch(/^demo-[0-9a-f]{8}$/);
  await expect(panel.getByTestId('tuple-b')).toHaveText('192.0.2.10:50001 ↔ 192.0.2.20:7007');
  await panel.getByRole('button', { name: 'Connection B' }).click();
  await expect(panel.getByTestId('session-verdict')).toHaveText('recognized');
  await expect(panel.getByTestId('cookie-sent')).toHaveText(issued);
  await expect(page.getByTestId('four-tuple')).toHaveText('192.0.2.10:50001 ↔ 192.0.2.20:7007');

  await page.locator('#cookie-b').selectOption('invalid');
  await runBtn(page).click();
  await panel.getByRole('button', { name: 'Connection B' }).click();
  await expect(panel.getByTestId('session-verdict')).toHaveText('unrecognized');

  // UDP: HTTP option disabled with a reason; mode falls back to raw.
  await page.getByRole('group', { name: 'Protocol' }).getByRole('button', { name: 'UDP' }).click();
  await expect(page.locator('#payload-mode')).toHaveValue('raw');
  await expect(page.locator('#payload-mode option[value=http]')).toBeDisabled();
  await expect(page.getByTestId('payload-mode-hint')).toContainText('disabled for UDP');
});
