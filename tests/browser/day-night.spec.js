import { test, expect } from './diagnostics-fixture.js';
import { writeFile } from 'node:fs/promises';
import { tick, read, setup, assertEnvironment, observeControls, activateControl } from './day-night-fixture.js';
import { assertColdFishingResources, assertLureInitialization, assertStableResourceIdentities } from './lighting-resource-contract.js';

test.use({ deviceScaleFactor: 0.5 });

for (const [seconds, label] of [[0, 'sunrise'], [90, 'day'], [175, 'dusk'], [180, 'night-boundary'],
  [270, 'night'], [350, 'morning'], [360, 'cycle-boundary'], [36270, 'later-night']]) {
  test(`saved ${label}: the very first production render uses ${seconds}s lighting`, async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setViewportSize({ width: 1000, height: 700 });
    await setup(page, seconds);
    const first = await page.evaluate(() => window.lightingProbe.first);
    assertEnvironment(first, seconds);
    expect(first.waterTime).toBe(0); expect(first.boat).toEqual([10, 20]);
    if (['day', 'dusk', 'night', 'morning'].includes(label)) {
      const path = testInfo.outputPath(`${label}.png`);
      await page.screenshot({ path });
      await testInfo.attach(label, { path, contentType: 'image/png' });
      const counts = testInfo.outputPath('render-counts.json');
      await writeFile(counts, JSON.stringify(await page.evaluate(() => window.lightingProbe.performance), null, 2));
      await testInfo.attach('render-counts', { path: counts, contentType: 'application/json' });
    }
    expect(errors).toEqual([]);
  });
}

test('lighting crosses both clock boundaries, handles long frames and freezes with menu/focus/visibility', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await setup(page, 178);
  await page.locator('#fish-button').click(); await tick(page);
  const display = page.locator('#fishing-conditions');
  const seconds = async () => Number(await display.getAttribute('data-cycle-progress')) * 360;
  const advanceTo = async target => page.clock.fastForward(Math.round((target - await seconds()) * 1000));
  for (const [boundary, beforePhase, afterPhase] of [[180, 'day', 'night'], [360, 'night', 'day']]) {
    await advanceTo(boundary - 0.05);
    await expect(display).toHaveAttribute('data-time-of-day', beforePhase);
    const before = await read(page);
    await page.clock.fastForward(100);
    await expect(display).toHaveAttribute('data-time-of-day', afterPhase);
    const after = await read(page);
    // Low mist samples cumulative elapsed time, including the crossed cycle.
    assertEnvironment(after, (boundary === 360 ? 360 : 0) + await seconds());
    for (const key of ['ambient', 'sun', 'moon', 'sky']) expect(Math.abs(before[key] - after[key])).toBeLessThan(0.01);
    for (const key of ['fog', 'deep', 'sunDirection']) before[key].forEach((v, i) => expect(Math.abs(v - after[key][i])).toBeLessThan(0.01));
  }
  await page.clock.fastForward(360000 * 20 + 270000);
  // Fog varies by cumulative night index, unlike the periodic lighting.
  const elapsedSeconds = async () => 360 * 21 + await seconds();
  assertEnvironment(await read(page), await elapsedSeconds());
  expect((await read(page)).waterTime).toBeLessThan(3); // simulation keeps its existing dt cap
  for (const reason of ['menu', 'blur', 'hidden']) {
    if (reason === 'menu') await page.locator('#menu-button').click();
    else await page.evaluate(reason => {
      if (reason === 'blur') window.dispatchEvent(new Event('blur'));
      else { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
    }, reason);
    const before = await read(page), clockBefore = await seconds();
    const renders = await page.evaluate(() => window.lightingProbe.renders);
    await page.clock.fastForward(600000);
    expect(await read(page)).toEqual(before);
    expect(await seconds()).toBe(clockBefore);
    expect(await page.evaluate(() => window.lightingProbe.renders)).toBe(renders);
    // resize() can render while paused; it must retain the same night scene.
    await page.setViewportSize(reason === 'blur' ? { width: 800, height: 600 } : { width: 600, height: 800 });
    await expect.poll(() => page.evaluate(() => window.lightingProbe.renders)).toBeGreaterThan(renders);
    expect(await read(page)).toEqual(before);
    if (reason === 'menu') await page.locator('#collection-close').click();
    else await page.evaluate(reason => {
      if (reason === 'blur') window.dispatchEvent(new Event('focus'));
      else { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }
    }, reason);
    await tick(page);
    expect(await seconds() - clockBefore).toBeCloseTo(0.25, 2);
    assertEnvironment(await read(page), await elapsedSeconds());
  }
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const saved = await page.evaluate(() => ['barb.save.v1.slotA', 'barb.save.v1.slotB'].map(k => JSON.parse(localStorage.getItem(k))).filter(Boolean).sort((a, b) => b.generation - a.generation)[0].data);
  expect(saved.saveVersion).toBe(2); expect(saved.settings).toEqual({});
  expect(saved.collection.catches).toEqual([]); expect(saved.achievements.unlocked).toEqual([]);
  await page.reload(); await tick(page);
  assertEnvironment(await page.evaluate(() => window.lightingProbe.first), saved.clock.elapsedSeconds);
});

for (const viewport of [{ width: 1000, height: 700, touch: false }, { width: 320, height: 568, touch: true },
  { width: 568, height: 320, touch: true }]) {
  test(`night sailing, FPS look and cast with ${viewport.touch ? 'touch' : 'mouse'} at ${viewport.width}x${viewport.height}`, async ({ createContext }, testInfo) => {
    const { touch, width, height } = viewport;
    const context = await createContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 0.5 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Boundary tests freeze rAF; operation regressions use the real timeline.
    // Do not compress seconds between native gestures with a mocked JS clock.
    // Start early enough that the entire real-time operation test stays at
    // night, including slow software WebGL runs (the test budget is 120s).
    await setup(page, 210, { freeze: false });
    await observeControls(page);
    // Landscape controls occupy the right half; start gestures on clear canvas.
    const cdp = await context.newCDPSession(page), x = width * (width > height && touch ? 0.35 : 0.6), y = height * 0.55;
    const down = async () => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }) : (await page.mouse.move(x, y), page.mouse.down());
    const move = (dy, dx = 0) => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy }] }) : page.mouse.move(x + dx, y + dy);
    const up = () => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) : page.mouse.up();
    const initial = await read(page);
    await down(); await move(-80);
    await expect(page.locator('#motion-label')).toHaveText('航行中');
    await expect.poll(async () => (await read(page)).boatSpeed).toBeGreaterThan(2);
    await up();
    await expect(page.locator('#motion-label')).toHaveText('停船中');
    expect((await read(page)).boatSpeed).toBe(0);
    await expect(page.locator('#joystick')).toBeHidden();
    expect((await read(page)).boat).not.toEqual(initial.boat);
    await activateControl(page, 'fish-button', touch);
    await expect(page.locator('#motion-label')).toHaveText('釣り視点');
    await expect(page.locator('body')).toHaveClass('fishing');
    await expect(page.locator('#reticle')).toBeVisible();
    await expect(page.locator('#fish-button')).toBeHidden();
    await expect(page.locator('#fish-button')).toBeDisabled();
    await expect(page.locator('#fishing-panel')).toBeVisible();
    await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'ready');
    await expect(page.locator('#fishing-conditions')).toHaveAttribute('data-time-of-day', 'night');
    await expect.poll(() => page.evaluate(() => window.lightingProbe.cameraHeight)).toBeCloseTo(2.15, 1);
    const cameraBefore = await page.evaluate(() => window.lightingProbe.camera);
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y).id, [x, y])).toBe('scene');
    await down(); await move(-60, 100);
    await expect.poll(() => page.evaluate(() => window.lightingProbe.camera)).not.toEqual(cameraBefore);
    await up();
    for (const id of ['menu-button', 'cast-button', 'return-button']) {
      const bounds = await page.locator(`#${id}`).boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width); expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
    }
    const path = testInfo.outputPath('moon-fishing.png');
    // The moon moves on the live shared clock. Follow it with ordinary
    // captured drags instead of assuming a fixed look still frames it after
    // all protocol round trips. No game state or input timestamps are forced.
    for (let attempt = 0; attempt < 8; attempt++) {
      const screen = await page.evaluate(() => window.lightingProbe.moonScreen);
      if (screen.slice(0, 2).every(v => Math.abs(v) < 0.6)) break;
      const dx = Math.abs(screen[0]) < 0.35 ? 0 : Math.sign(screen[0]) * Math.min(width * 0.2, 80);
      const dy = Math.abs(screen[1]) < 0.35 ? 0 : -Math.sign(screen[1]) * Math.min(height * 0.12, 45);
      await down(); await move(dy, dx);
      const movedAt = await page.evaluate(() => window.lightingProbe.renders);
      // Wait for an actual frame after movement before releasing capture;
      // pointerup clears any look delta that has not yet been consumed.
      await expect.poll(() => page.evaluate(() => window.lightingProbe.renders)).toBeGreaterThan(movedAt);
      await up();
    }
    await expect(page.locator('#fishing-conditions')).toHaveAttribute('data-time-of-day', 'night');
    await expect.poll(() => page.evaluate(() => window.lightingProbe.moonScreen.slice(0, 2).every(v => Math.abs(v) < 1))).toBe(true);
    const moonScreen = await page.evaluate(() => window.lightingProbe.moonScreen);
    expect(Math.abs(moonScreen[0])).toBeLessThan(1); expect(Math.abs(moonScreen[1])).toBeLessThan(1);
    await page.screenshot({ path }); await testInfo.attach('moon-fishing', { path, contentType: 'image/png' });
    const resources = () => page.evaluate(() => ({ counts: window.lightingProbe.performance, catalog: window.lightingProbe.resourceCatalog }));
    const memoryBefore = await resources();
    assertColdFishingResources(memoryBefore);
    await activateControl(page, 'cast-button', touch);
    await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'aim');
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y).id, [x, y])).toBe('scene');
    await down(); await move(-120); await up();
    await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'lure');
    await down();
    await expect(page.locator('#reel-state')).toHaveText('巻き取り中');
    await up();
    await expect(page.locator('#reel-state')).toHaveText('待機中');
    const { lighting, cycleProgress } = await page.evaluate(() => ({ lighting: window.lightingProbe.last,
      cycleProgress: Number(document.querySelector('#fishing-conditions').dataset.cycleProgress) }));
    assertEnvironment(lighting, cycleProgress * 360);
    const duringLure = await resources();
    const counts = testInfo.outputPath('render-counts.json');
    await writeFile(counts, JSON.stringify({ beforeCast: memoryBefore, duringLure }, null, 2));
    await testInfo.attach('render-counts', { path: counts, contentType: 'application/json' });
    assertLureInitialization(memoryBefore, duringLure);
    expect(duringLure.counts.calls).toBeLessThan(40);
    const frame = await page.evaluate(() => window.lightingProbe.renders);
    await expect.poll(() => page.evaluate(() => window.lightingProbe.renders)).toBeGreaterThan(frame);
    const nextFrame = await resources();
    assertStableResourceIdentities(duringLure, nextFrame);
    await writeFile(counts, JSON.stringify({ beforeCast: memoryBefore, duringLure, nextFrame }, null, 2));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('cold fishing GPU resources initialize once across preparation cancellation and three normal casts', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await setup(page, 270);
  const resources = () => page.evaluate(() => ({ counts: window.lightingProbe.performance, catalog: window.lightingProbe.resourceCatalog }));
  const phase = () => page.locator('#fishing-panel').getAttribute('data-phase');
  await page.locator('#fish-button').click(); await tick(page);
  const cold = await resources();
  const snapshots = [cold];
  const path = testInfo.outputPath('fishing-resource-initialization.json');
  const record = async snapshot => { snapshots.push(snapshot); await writeFile(path, JSON.stringify(snapshots, null, 2)); };
  await writeFile(path, JSON.stringify(snapshots, null, 2));
  await testInfo.attach('fishing-resource-initialization', { path, contentType: 'application/json' });
  assertColdFishingResources(cold);
  await page.locator('#cast-button').click(); await tick(page);
  await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'aim');
  const aim = await resources();
  await record(aim);
  expect(aim.catalog.fishing.filter(row => row.initialized).map(row => row.type)).toEqual(['RingGeometry']);
  expect(aim.catalog.cpuGeometryIds).toEqual(cold.catalog.cpuGeometryIds);
  await page.locator('#cancel-cast').click(); await tick(page);
  await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'ready');
  let initialized;
  for (let cast = 0; cast < 3; cast++) {
    await page.locator('#cast-button').click(); await tick(page);
    await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'aim');
    await page.mouse.move(500, 350); await page.mouse.down(); await page.mouse.up();
    await tick(page);
    for (let frame = 0; frame < 5 && await phase() === 'cast'; frame++) await tick(page);
    await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'lure');
    const lure = await resources();
    await record(lure);
    if (!initialized) { assertLureInitialization(cold, lure); initialized = lure; }
    else assertStableResourceIdentities(initialized, lure);
    for (let frame = 0; frame < 80 && await phase() !== 'ready'; frame++) await tick(page);
    await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'ready');
    const ready = await resources();
    await record(ready);
    assertStableResourceIdentities(initialized, ready);
  }
});
