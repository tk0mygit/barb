import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { Quaternion, Vector3 } from 'three';
import { tick, read, setup, assertEnvironment, observeControls, activateControl } from './day-night-fixture.js';

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
  await page.locator('#fish-button').click({ force: true }); await tick(page);
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
    assertEnvironment(after, await seconds());
    for (const key of ['ambient', 'sun', 'moon', 'sky']) expect(Math.abs(before[key] - after[key])).toBeLessThan(0.01);
    for (const key of ['fog', 'deep', 'sunDirection']) before[key].forEach((v, i) => expect(Math.abs(v - after[key][i])).toBeLessThan(0.01));
  }
  await page.clock.fastForward(360000 * 20 + 270000);
  // Fog varies by cumulative night index, unlike the periodic lighting.
  const elapsedSeconds = async () => 360 * 21 + await seconds();
  assertEnvironment(await read(page), await elapsedSeconds());
  expect((await read(page)).waterTime).toBeLessThan(3); // simulation keeps its existing dt cap
  for (const reason of ['menu', 'blur', 'hidden']) {
    if (reason === 'menu') await page.locator('#menu-button').click({ force: true });
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
    if (reason === 'menu') await page.locator('#collection-close').click({ force: true });
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
  expect(saved.saveVersion).toBe(1); expect(saved.settings).toEqual({});
  expect(saved.collection.catches).toEqual([]); expect(saved.achievements.unlocked).toEqual([]);
  await page.reload(); await tick(page);
  assertEnvironment(await page.evaluate(() => window.lightingProbe.first), saved.clock.elapsedSeconds);
});

for (const viewport of [{ width: 1000, height: 700, touch: false }, { width: 320, height: 568, touch: true },
  { width: 568, height: 320, touch: true }]) {
  test(`night sailing, FPS look and cast with ${viewport.touch ? 'touch' : 'mouse'} at ${viewport.width}x${viewport.height}`, async ({ browser }, testInfo) => {
    const { touch, width, height } = viewport;
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 0.5 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Boundary tests freeze rAF; operation regressions use the real timeline.
    // Do not compress seconds between native gestures with a mocked JS clock.
    // Start early enough that the entire real-time operation test stays at
    // night, including slow software WebGL runs (the test budget is 120s).
    await setup(page, 210, { freeze: false });
    await observeControls(page);
    try {
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
      await down(); await move(-60, 100); await up();
      await expect.poll(() => page.evaluate(() => window.lightingProbe.camera)).not.toEqual(cameraBefore);
      for (const id of ['menu-button', 'cast-button', 'return-button']) {
        const bounds = await page.locator(`#${id}`).boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width); expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
      }
      const path = testInfo.outputPath('moon-fishing.png');
      // The moon moves on the live shared clock. Follow it with ordinary
      // captured drags instead of assuming a fixed look still frames it after
      // all protocol round trips. No game state or input timestamps are forced.
      const forward = rotation => new Vector3(0, 0, -1).applyQuaternion(new Quaternion().fromArray(rotation));
      for (let attempt = 0; attempt < 5; attempt++) {
        const view = await page.evaluate(() => ({ rotation: window.lightingProbe.camera,
          direction: window.lightingProbe.last.moonDirection, screen: window.lightingProbe.moonScreen }));
        if (view.screen.slice(0, 2).every(v => Math.abs(v) < 0.6)) break;
        const current = forward(view.rotation), moon = new Vector3().fromArray(view.direction);
        const yaw = Math.atan2(current.x, -current.z), pitch = Math.asin(current.y);
        const difference = Math.atan2(moon.x, -moon.z) - yaw;
        const turn = Math.atan2(Math.sin(difference), Math.cos(difference));
        const dx = Math.max(-width * 0.3, Math.min(width * 0.3, turn / 0.004));
        const dy = Math.max(-height * 0.25, Math.min(height * 0.25, (pitch - Math.asin(moon.y)) / 0.004));
        const nextYaw = yaw + dx * 0.004, nextPitch = pitch - dy * 0.004;
        const expected = new Vector3(Math.sin(nextYaw) * Math.cos(nextPitch), Math.sin(nextPitch), -Math.cos(nextYaw) * Math.cos(nextPitch));
        await down(); await move(dy, dx);
        // Keep the pointer held until a real frame consumes its movement.
        await expect.poll(async () => forward(await page.evaluate(() => window.lightingProbe.camera)).angleTo(expected)).toBeLessThan(0.08);
        await up();
      }
      await expect(page.locator('#fishing-conditions')).toHaveAttribute('data-time-of-day', 'night');
      await expect.poll(() => page.evaluate(() => window.lightingProbe.moonScreen.slice(0, 2).every(v => Math.abs(v) < 1))).toBe(true);
      const moonScreen = await page.evaluate(() => window.lightingProbe.moonScreen);
      expect(Math.abs(moonScreen[0])).toBeLessThan(1); expect(Math.abs(moonScreen[1])).toBeLessThan(1);
      await page.screenshot({ path }); await testInfo.attach('moon-fishing', { path, contentType: 'image/png' });
      const memoryBefore = await page.evaluate(() => window.lightingProbe.performance);
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
      const performance = await page.evaluate(() => window.lightingProbe.performance);
      expect(performance.geometries).toBeLessThanOrEqual(memoryBefore.geometries + 1);
      expect(performance.calls).toBeLessThan(40);
      const counts = testInfo.outputPath('render-counts.json');
      await writeFile(counts, JSON.stringify({ beforeCast: memoryBefore, duringLure: performance }, null, 2));
      await testInfo.attach('render-counts', { path: counts, contentType: 'application/json' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      const controlsPath = testInfo.outputPath('control-events.json');
      await writeFile(controlsPath, JSON.stringify(await page.evaluate(() => ({
        ...window.controlProbe, lighting: window.lightingProbe.last,
        motion: document.querySelector('#motion-label').textContent,
        reticleHidden: document.querySelector('#reticle').hidden,
        fishingPhase: document.querySelector('#fishing-panel').dataset.phase,
      })), null, 2));
      await testInfo.attach('control-events', { path: controlsPath, contentType: 'application/json' });
      await context.close();
    }
  });
}
