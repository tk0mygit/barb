import { execFileSync } from 'node:child_process';
import { test, expect } from './diagnostics-fixture.js';
import { installPausedClock } from './clock-fixture.js';
import { openQteFixture, observeQteUI, captureQteUI } from './qte-fixture.js';

// Compare against the exact PM-approved implementation, not an approximation
// of its compact/obstacle algorithm. CI already fetches the real base history.
const approvedBase = '0cc246e387585363747a24ea82d818f91ba95bfe';
const oldSource = execFileSync('git', ['show', `${approvedBase}:src/ui/qte-layout.js`], { cwd: new URL('../../', import.meta.url) }).toString();
const { calculateQteLayout: calculateApprovedLayout } = await import(`data:text/javascript;base64,${Buffer.from(oldSource).toString('base64')}`);
const vectors = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
const inside = (p, r) => r && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;

function assertTransparent(measured) {
  for (const style of measured.styles) {
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)'); expect(style.backgroundImage).toBe('none');
    for (const key of ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'outlineWidth']) expect(style[key]).toBe('0px');
    expect(style.outlineStyle).toBe('none'); expect(style.boxShadow).toBe('none'); expect(style.pointerEvents).toBe('none');
  }
  expect(measured.stateText.length).toBeGreaterThan(0); expect(measured.endpoints).toBe(0);
}

function assertCentral(measured) {
  const { canvas: c, safe: s, viewport: v, geometry: g, region: r } = measured;
  const bounds = { left: Math.max(c.left, s.left, v?.left ?? -Infinity), top: Math.max(c.top, s.top, v?.top ?? -Infinity),
    right: Math.min(c.right, s.right, v?.right ?? Infinity), bottom: Math.min(c.bottom, s.bottom, v?.bottom ?? Infinity) };
  expect((r.left + r.right) / 2).toBeCloseTo((bounds.left + bounds.right) / 2, 1);
  expect((r.top + r.bottom) / 2).toBeCloseTo((bounds.top + bounds.bottom) / 2, 1);
  expect(g.region.left).toBe(r.left); expect(g.region.right).toBe(r.right);
  expect(g.region.top).toBe(r.top); expect(g.region.bottom).toBe(r.bottom);
  expect(r.left).toBeGreaterThanOrEqual(bounds.left); expect(r.right).toBeLessThanOrEqual(bounds.right);
  expect(r.top).toBeGreaterThanOrEqual(bounds.top); expect(r.bottom).toBeLessThanOrEqual(bounds.bottom);
  expect(r.width).toBeGreaterThanOrEqual(216); expect(r.height).toBeGreaterThanOrEqual(120);
}

async function activatePausedFixture(page) {
  for (let n = 0; n < 12 && !await page.evaluate(() => window.qteFixture.delivery.snapshot.displayReady); n++) await page.clock.fastForward(100);
  await expect(page.locator('.qte-hud')).toHaveAttribute('data-state', 'active');
}

async function nativeGesture(page, context, touch, start, end) {
  if (touch) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    if (end.x !== start.x || end.y !== start.y) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
    await page.clock.fastForward(20);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    if (end.x !== start.x || end.y !== start.y) await page.mouse.move(end.x, end.y);
    await page.clock.fastForward(20); await page.mouse.up();
  }
}

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
    const measured = await observeQteUI(page), g = { ...measured.geometry, d: measured.descriptor, circles: measured.circles };
    assertTransparent(measured); assertCentral(measured);
    expect(measured.grid.filter(p => p.hit !== 'scene'), JSON.stringify(measured)).toEqual([]);
    expect(measured.snapshot.deadline - measured.snapshot.active).toBe(operation === 'tap' ? 2000 : 500);
    if (operation === 'target') for (const circle of g.circles) {
      expect(circle.left + circle.width / 2).toBe(g.target.x); expect(circle.top + circle.height / 2).toBe(g.target.y);
      expect(circle.width).toBe(touch ? 80 : 64); expect(circle.height).toBe(touch ? 80 : 64);
    }
    if (operation === 'target') { expect(g.circles).toHaveLength(1); expect(measured.instruction).toMatch(/半径.*マウス32.*タッチ40px/); }
    expect(measured.arrowVisible).toBe(['flick', 'swipe'].includes(operation));
    expect(measured.tapsVisible).toBe(operation === 'tap'); expect(measured.targetVisible).toBe(operation === 'target');
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
    await test.info().attach('native-operation-geometry-time', { body: JSON.stringify({ measured, start, end, scored, result }), contentType: 'application/json' });
    expect(errors).toEqual([]);
  });
}

test('HUD safe insets, short landscape, layout failure and fixed target geometry through rotation/resize', async ({ createContext }, info) => {
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
      for (const [key, value] of Object.entries({ top: 16.375, right: 24.125, bottom: 16.375, left: 24.125 })) document.documentElement.style.setProperty('--safe-' + key, value + 'px');
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const measured = await observeQteUI(page);
    expect(measured.geometry, JSON.stringify(measured)).not.toBeNull();
    const p = measured.geometry.panel;
    expect(p.left).toBeGreaterThanOrEqual(24); expect(p.right).toBeLessThanOrEqual(viewport.width - 24);
    expect(p.top).toBeGreaterThanOrEqual(16); expect(p.bottom).toBeLessThanOrEqual(viewport.height - 16);
    // Overlap is now approved. The scoring rectangle stays centred and safe;
    // a modal menu owns hit testing only while delivery is suspended.
    assertCentral(measured); assertTransparent(measured); expect(measured.state).toBe('suspended');
    const previous = calculateApprovedLayout(measured);
    if (previous) {
      expect(measured.region.width).toBeGreaterThan(previous.region.right - previous.region.left);
      expect(measured.region.height).toBeGreaterThan(previous.region.bottom - previous.region.top);
    }
  }
  // Chromium pinch zoom changes the real visualViewport in fractional CSS px;
  // keep the native menu pause instead of extending or replacing QTE time.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.125 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const zoomed = await observeQteUI(page); assertCentral(zoomed); assertTransparent(zoomed);
  expect(zoomed.viewport.scale).toBeCloseTo(1.125, 3);
  await info.attach('fractional-insets-visual-viewport-zoom', { body: JSON.stringify(zoomed), contentType: 'application/json' });
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }); await cdp.detach();
  expect(await page.evaluate(() => window.qteFixture.delivery.snapshot.remainingMs)).toBe(remaining);
  await page.setViewportSize({ width: 180, height: 240 });
  await expect(page.locator('.qte-hud')).toHaveAttribute('data-state', 'layout-unavailable');
  expect(await page.evaluate(() => window.qteFixture.delivery.snapshot.displayReady)).toBe(false);
  assertTransparent(await observeQteUI(page));
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

// All eight real descriptors are checked independently. Pausing the browser
// before module loading makes explicit review screenshots cost no operation
// time; the original eight tests above still prove the real 0.5s clock.
const directionProfiles = {
  right: { id: 'pc', width: 1000, height: 700, touch: false },
  up: { id: 'portrait', width: 390, height: 844, touch: true },
  down: { id: 'landscape', width: 844, height: 390, touch: true },
  left: { id: 'short-landscape', width: 568, height: 320, touch: true },
};
for (const operation of ['flick', 'swipe']) for (const [direction, profile] of Object.entries(directionProfiles)) {
  test(`central transparent ${operation}/${direction}: ${profile.id} SVG and enlarged native region`, async ({ createContext }, info) => {
    const context = await createContext({ viewport: { width: profile.width, height: profile.height }, hasTouch: profile.touch, isMobile: profile.touch });
    const page = await context.newPage(); await installPausedClock(page);
    await openQteFixture(page, operation, { direction }); await activatePausedFixture(page);
    const measured = await observeQteUI(page);
    assertTransparent(measured); assertCentral(measured);
    expect(measured.descriptor).toMatchObject({ operation, direction }); expect(measured.direction).toBe(direction);
    expect(measured.grid.filter(p => p.hit !== 'scene'), JSON.stringify(measured)).toEqual([]);
    expect(measured.snapshot.deadline - measured.snapshot.active).toBe(500);
    expect(measured.arrows).toHaveLength(operation === 'swipe' ? 2 : 1);
    expect(measured.arrowOpacity).toBeGreaterThan(.4); expect(measured.arrowOpacity).toBeLessThan(1);
    expect(measured.targetVisible).toBe(false); expect(measured.tapsVisible).toBe(false);
    const expectedRotation = { right: [1, 0, 0, 1], up: [0, -1, 1, 0], down: [0, 1, -1, 0], left: [-1, 0, 0, -1] }[direction];
    for (const arrow of measured.arrows) {
      const rotation = arrow.transform === 'none' ? [1, 0, 0, 1] : arrow.transform.match(/matrix\(([^)]+)\)/)[1].split(',').slice(0, 4).map(Number);
      rotation.forEach((n, i) => expect(n).toBeCloseTo(expectedRotation[i], 5));
      expect(arrow.paths).toBe(1); expect(arrow.rect.width).toBeCloseTo(arrow.rect.height, 3);
      expect(arrow.rect.left).toBeGreaterThanOrEqual(measured.region.left); expect(arrow.rect.right).toBeLessThanOrEqual(measured.region.right);
      expect(arrow.rect.top).toBeGreaterThanOrEqual(measured.region.top); expect(arrow.rect.bottom).toBeLessThanOrEqual(measured.region.bottom);
    }
    const centers = measured.arrows.map(({ rect: r }) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }));
    expect(centers.reduce((sum, c) => sum + c.x, 0) / centers.length).toBeCloseTo(measured.geometry.target.x, 1);
    expect(centers.reduce((sum, c) => sum + c.y, 0) / centers.length).toBeCloseTo(measured.geometry.target.y, 1);
    if (centers.length === 2) {
      if (['up', 'down'].includes(direction)) { expect(centers[0].x).toBeCloseTo(centers[1].x, 3); expect(centers[1].y).toBeGreaterThan(centers[0].y); }
      else { expect(centers[0].y).toBeCloseTo(centers[1].y, 3); expect(centers[1].x).toBeGreaterThan(centers[0].x); }
    }
    for (const r of measured.foreground) {
      expect(r.left).toBeGreaterThanOrEqual(measured.canvas.left); expect(r.right).toBeLessThanOrEqual(measured.canvas.right);
      expect(r.top).toBeGreaterThanOrEqual(measured.canvas.top); expect(r.bottom).toBeLessThanOrEqual(measured.canvas.bottom);
    }
    expect(measured.timer.height).toBeLessThanOrEqual(3); expect(measured.timer.text).toMatch(/0\.[0-5]秒/);
    const old = calculateApprovedLayout(measured), v = vectors[direction], distance = operation === 'swipe' ? 80 : 50;
    const candidates = measured.grid.filter(p => !inside(p, old?.region)).map(start => ({ start: { x: start.x, y: start.y },
      end: { x: start.x + v[0] * distance, y: start.y + v[1] * distance } })).filter(({ end }) => inside(end, measured.geometry.region));
    // Prefer the visual FIGHT overlap when available. It is intentionally
    // pointer-events:none; a disabled button must still fail the grid above.
    candidates.sort((a, b) => Number(inside(b.start, measured.fight)) - Number(inside(a.start, measured.fight)));
    expect(candidates.length, JSON.stringify({ measured, old })).toBeGreaterThan(0);
    const gesture = candidates[0];
    expect(inside(gesture.start, old?.region)).toBeFalsy();
    expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.id, gesture.end)).toBe('scene');
    if (profile.id === 'pc') expect(inside(gesture.start, measured.fight), JSON.stringify({ gesture, measured })).toBe(true);
    await captureQteUI(page, info, `${operation}-${direction}-${profile.id}`, { approvedBase, old, measured, gesture });
    await nativeGesture(page, context, profile.touch, gesture.start, gesture.end);
    const pending = await page.evaluate(() => ({ snapshot: window.qteFixture.delivery.snapshot, preview: window.qteFixture.delivery.preview(),
      evidence: window.qteFixture.evidence(), ingress: window.e2eDiagnostics.events.filter(e => e.target === 'scene') }));
    expect(pending.preview.success, JSON.stringify(pending)).toBe(true);
    expect(pending.ingress.some(e => e.type === 'pointerdown' && e.trusted && e.pointerType === (profile.touch ? 'touch' : 'mouse'))).toBe(true);
    const remaining = await page.evaluate(() => window.qteFixture.delivery.snapshot.cut - window.qteFixture.delivery.clock.read().active);
    await page.clock.fastForward(remaining + 32);
    await expect(page.locator('.qte-hud')).toHaveAttribute('data-state', 'success');
    expect(await page.evaluate(() => window.qteFixture.fishing.state.fight.qte.successes)).toBe(1);
    await info.attach('enlarged-region-native-result', { body: JSON.stringify({ gesture, pending, after: await observeQteUI(page) }), contentType: 'application/json' });
  });
}

test('transparent warning, active, suspended, urgent, receipt wait and failure retain text and the same time budget', async ({ createContext }, info) => {
  const context = await createContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage(); await installPausedClock(page); await openQteFixture(page, 'swipe', { direction: 'up' });
  await page.clock.fastForward(16);
  const states = [await observeQteUI(page)]; expect(states[0].state).toBe('warning'); assertTransparent(states[0]);
  await activatePausedFixture(page);
  const active = await observeQteUI(page); states.push(active); expect(active.state).toBe('active'); assertTransparent(active);
  await page.locator('#menu-button').tap(); await page.clock.fastForward(16);
  const suspended = await observeQteUI(page); states.push(suspended); expect(suspended.state).toBe('suspended'); assertTransparent(suspended);
  await page.clock.fastForward(1000);
  expect(await page.evaluate(() => window.qteFixture.delivery.snapshot.remainingMs)).toBe(suspended.snapshot.remainingMs);
  await page.locator('#collection-close').tap(); await page.clock.fastForward(16);
  const awaiting = await observeQteUI(page); states.push(awaiting); expect(awaiting.state).toBe('awaiting-display'); assertTransparent(awaiting);
  await page.clock.fastForward(16);
  const resumed = await observeQteUI(page); states.push(resumed); expect(resumed.state).toBe('active'); assertTransparent(resumed);
  expect(resumed.snapshot.deadline).toBe(active.snapshot.deadline);
  const untilUrgent = resumed.snapshot.remainingMs - 100;
  if (untilUrgent > 0) await page.clock.fastForward(untilUrgent);
  const urgent = await observeQteUI(page); states.push(urgent); expect(urgent.urgent).toBe('true'); assertTransparent(urgent);
  await page.clock.fastForward(urgent.snapshot.remainingMs + 1);
  const waiting = await observeQteUI(page); states.push(waiting); expect(waiting.state).toBe('awaiting-result'); assertTransparent(waiting);
  await page.clock.fastForward(100);
  const failed = await observeQteUI(page); states.push(failed); expect(failed.state).toBe('failure'); assertTransparent(failed);
  expect(failed.stateText).toContain('×');
  await captureQteUI(page, info, 'transparent-state-timeline', { states });
});
