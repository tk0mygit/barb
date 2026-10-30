import { test, expect } from './diagnostics-fixture.js';
import { openQteFixture } from './qte-fixture.js';

// Trusted Chromium input, real monotonic clock and real rAF. No synthetic
// PointerEvent or patched scoring clock. Device acceptance is a separate gate.
for (const touch of [false, true]) for (const operation of ['flick', 'swipe', 'tap', 'target']) {
  test(`${touch ? 'touch' : 'mouse'} canvas → ${operation} → HUD → finite seal → single domain commit`, async ({ createContext }) => {
    const context = await createContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1000, height: 700 },
      hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 3 : 2 });
    const page = await context.newPage(), errors = [];
    const cdp = touch ? await context.newCDPSession(page) : null;
    page.on('pageerror', error => errors.push(error.message));
    await openQteFixture(page, operation);
    // Observe the opening frame, rather than locator assertion backoff (whose
    // next sample can consume most of a legitimate 0.5s operation window).
    await page.waitForFunction(() => document.querySelector('.qte-hud')?.dataset.state === 'active');
    await expect(page.locator('.qte-hud')).toHaveAttribute('data-state', 'active');
    const g = await page.evaluate(() => ({ ...window.qteFixture.hud.geometry, d: window.qteFixture.provider.getDescriptor(0),
      circles: [...document.querySelectorAll('.qte-target,.qte-target > span')].map(el=>el.getBoundingClientRect().toJSON()) }));
    if (operation === 'target') for (const [i, circle] of g.circles.entries()) {
      expect(circle.left + circle.width / 2).toBe(g.target.x); expect(circle.top + circle.height / 2).toBe(g.target.y);
      expect(circle.width).toBe(i ? 64 : 80); expect(circle.height).toBe(i ? 64 : 80);
    }
    const vectors = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
    const v = vectors[g.d.direction] ?? [0, 0], distance = operation === 'swipe' ? 80 : operation === 'flick' ? 50 : 0;
    const start = { x: g.target.x - v[0] * distance / 2, y: g.target.y - v[1] * distance / 2 };
    const end = { x: g.target.x + v[0] * distance / 2, y: g.target.y + v[1] * distance / 2 };
    expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.id, start)).toBe('scene');
    for (let i = 0; i < (operation === 'tap' ? 3 : 1); i++) {
      if (touch) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
        if (distance) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.mouse.move(start.x, start.y); await page.mouse.down();
        if (distance) await page.mouse.move(end.x, end.y);
        await page.mouse.up();
      }
    }
    const scored = await page.evaluate(() => ({ preview: window.qteFixture.delivery.preview(), snapshot: window.qteFixture.delivery.snapshot,
      evidence: window.qteFixture.evidence() }));
    expect(scored.preview.success, JSON.stringify(scored)).toBe(true);
    expect(await page.evaluate(() => window.qteFixture.fishing.state.fight.qte.successes)).toBe(0);
    if (operation === 'tap') await expect(page.locator('.qte-taps')).toContainText('3/3');
    await expect(page.locator('.qte-hud')).toHaveAttribute('data-state', 'success');
    const result = await page.evaluate(() => ({ snapshot: window.qteFixture.delivery.snapshot, fight: window.qteFixture.fishing.state.fight,
      commits: window.qteFixture.events.filter(e => e === 'qte-resolved').length,
      pointers: window.e2eDiagnostics.events.filter(e => e.type === 'pointerdown' && e.target === 'scene').map(e => ({ trusted: e.trusted, type: e.pointerType })) }));
    expect(result.snapshot.status).toBe('applied'); expect(result.fight.qte.successes).toBe(1); expect(result.fight.qte.failures).toBe(0);
    expect(result.commits).toBe(1); expect(result.pointers.length).toBe(operation === 'tap' ? 3 : 1);
    expect(result.pointers.every(p => p.trusted && p.type === (touch ? 'touch' : 'mouse'))).toBe(true);
    expect(await page.evaluate(() => window.qteFixture.delivery.poll())).toBe(false);
    expect(errors).toEqual([]);
  });
}

test('HUD safe insets, short landscape, layout failure and fixed target geometry through rotation/resize', async ({ createContext }) => {
  const context = await createContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const page = await context.newPage(); await openQteFixture(page, 'tap');
  // Hold a real menu pause while measuring multiple sizes; layout does not
  // spend the active window or claim a gesture/physical display success.
  await page.locator('#menu-button').tap();
  await expect(page.locator('#collection-dialog')).toBeVisible();
  const remaining = await page.evaluate(() => window.qteFixture.delivery.snapshot.remainingMs);
  for (const viewport of [{ width: 844, height: 390 }, { width: 568, height: 320 }, { width: 390, height: 844 }, { width: 360, height: 640 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => {
      for (const [key, value] of Object.entries({ top: 16, right: 24, bottom: 16, left: 24 })) document.documentElement.style.setProperty('--safe-' + key, value + 'px');
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const measured = await page.evaluate(() => ({ geometry: window.qteFixture.hud.geometry,
      canvas: document.querySelector('#scene').getBoundingClientRect().toJSON(),
      safe: document.querySelector('.qte-safe-probe').getBoundingClientRect().toJSON(),
      obstacles: [...document.querySelectorAll('.masthead,.action-panel,#fishing-panel,#reticle,.compass,.telemetry,.edition,#spot-status,#sale-notice,#achievement-notice')]
        .filter(e=>getComputedStyle(e).display!=='none').map(e=>({name:e.id||e.className,rect:e.getBoundingClientRect().toJSON()})) }));
    expect(measured.geometry, JSON.stringify(measured)).not.toBeNull();
    const p = measured.geometry.panel;
    expect(p.left).toBeGreaterThanOrEqual(24); expect(p.right).toBeLessThanOrEqual(viewport.width - 24);
    expect(p.top).toBeGreaterThanOrEqual(16); expect(p.bottom).toBeLessThanOrEqual(viewport.height - 16);
    for (const {rect:o} of measured.obstacles) expect(p.left < o.right && p.right > o.left && p.top < o.bottom && p.bottom > o.top).toBe(false);
  }
  expect(await page.evaluate(() => window.qteFixture.delivery.snapshot.remainingMs)).toBe(remaining);
  await page.setViewportSize({ width: 180, height: 240 });
  await expect(page.locator('.qte-hud')).toHaveAttribute('data-state', 'layout-unavailable');
  expect(await page.evaluate(() => window.qteFixture.delivery.snapshot.displayReady)).toBe(false);
});

test('menu suspends a completed tap checkpoint, native pointer capture/focus and fresh input on resume', async ({ createContext }) => {
  const context = await createContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage(); await openQteFixture(page, 'tap');
  await expect(page.locator('.qte-hud')).toHaveAttribute('data-state', 'active');
  const p = await page.evaluate(() => window.qteFixture.hud.geometry.target);
  await page.touchscreen.tap(p.x, p.y);
  await expect(page.locator('.qte-taps')).toContainText('1/3');
  await page.locator('#menu-button').tap();
  await expect(page.locator('#collection-dialog')).toBeVisible();
  expect(await page.evaluate(() => window.qteFixture.fishing.state.fight.paused)).toBe(true);
  await page.locator('#collection-close').tap();
  await expect.poll(() => page.evaluate(() => JSON.stringify({ state: window.qteFixture.hud.element.dataset.state,
    snapshot: window.qteFixture.delivery.snapshot, displays: window.qteFixture.displayCalls }))).toContain('"state":"active"');
  await expect(page.locator('.qte-taps')).toContainText('1/3');
  const fresh = await page.evaluate(() => window.qteFixture.hud.geometry.target);
  await page.touchscreen.tap(fresh.x, fresh.y); await page.touchscreen.tap(fresh.x, fresh.y);
  await expect(page.locator('.qte-hud')).toHaveAttribute('data-state', 'success');
  expect(await page.evaluate(() => window.qteFixture.events.filter(e => e === 'qte-resolved').length)).toBe(1);
});
