import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { tick, read, setup, assertEnvironment, observeControls, activateControl } from './day-night-fixture.js';

test.use({ deviceScaleFactor: 0.5 });

async function attachCounts(page, testInfo, label) {
  const counts = await page.evaluate(() => window.lightingProbe.performance);
  const path = testInfo.outputPath(`${label}-render-counts.json`);
  await writeFile(path, JSON.stringify(counts, null, 2));
  await testInfo.attach(`${label}-render-counts`, { path, contentType: 'application/json' });
  return counts;
}

test('clear and foggy nights differ visually, share water/terrain fog and keep identical GPU costs', async ({ browser }, testInfo) => {
  const contexts = [];
  const counts = [], screenshots = [];
  try {
    // Same night phase, camera and animation time; only the cycle index differs.
    for (const [seconds, label] of [[270, 'clear-night'], [990, 'foggy-night']]) {
      const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
      contexts.push(context);
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await setup(page, seconds);
      assertEnvironment(await page.evaluate(() => window.lightingProbe.first), seconds);
      await page.evaluate(() => window.dispatchEvent(new Event('blur'))); // freeze the exact view for the pair
      const path = testInfo.outputPath(`${label}.png`);
      screenshots.push(await page.screenshot({ path }));
      await testInfo.attach(label, { path, contentType: 'image/png' });
      counts.push(await attachCounts(page, testInfo, label));
      // The actual renderer converts the water's uniform into the same output
      // color space as standard terrain fog, without changing scene.fog.color.
      const colors = await page.evaluate(() => ({ water: window.lightingProbe.uploadedWaterFog, scene: window.lightingProbe.outputFog }));
      colors.water.forEach((v, i) => expect(v).toBeCloseTo(colors.scene[i], 7));
      expect((await read(page)).fogStrength).toBe(label === 'foggy-night' ? 1 : 0);
      expect(errors).toEqual([]);
    }
    expect(screenshots[0].equals(screenshots[1])).toBe(false);
    expect(counts[1]).toEqual(counts[0]);
    expect(counts[1].calls).toBeLessThan(40);
  } finally {
    for (const context of contexts) await context.close();
  }
});

test('fog fades at both boundaries, freezes with menu/focus/visibility and restores the saved night on first render', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await setup(page, 898); // cycle 2, just before its foggy night
  await page.locator('#fish-button').click({ force: true }); await tick(page);
  const display = page.locator('#fishing-conditions');
  const phase = async () => Number(await display.getAttribute('data-cycle-progress')) * 360;
  const advanceTo = async target => page.clock.fastForward(Math.round((target - await phase()) * 1000));
  const assertCurrent = async () => assertEnvironment(await read(page), 720 + await phase());
  for (const [target, strength] of [[180, 0], [186, 0.5], [192, 1], [270, 1], [348, 1], [354, 0.5], [359.999, 0]]) {
    await advanceTo(target);
    await assertCurrent();
    expect((await read(page)).fogStrength).toBeCloseTo(strength, 2);
  }
  await page.clock.fastForward(100); // include a rendered frame on the daytime side
  await expect(display).toHaveAttribute('data-time-of-day', 'day');
  expect((await read(page)).fogStrength).toBe(0);
  // One long active frame crosses whole cycles and lands inside a later fade.
  await page.clock.fastForward(720000 + 186000 - Math.round(await phase() * 1000));
  expect((await read(page)).fogStrength).toBeCloseTo(0.5, 2); // cycle 5 is also foggy
  const assertCurrentCycle5 = async () => assertEnvironment(await read(page), 1800 + await phase());
  await assertCurrentCycle5();
  for (const reason of ['menu', 'blur', 'hidden']) {
    if (reason === 'menu') await page.locator('#menu-button').click({ force: true });
    else await page.evaluate(reason => {
      if (reason === 'blur') window.dispatchEvent(new Event('blur'));
      else { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
    }, reason);
    const before = await read(page), clockBefore = await phase();
    const renders = await page.evaluate(() => window.lightingProbe.renders);
    await page.clock.fastForward(600000);
    expect(await read(page)).toEqual(before); expect(await phase()).toBe(clockBefore);
    expect(await page.evaluate(() => window.lightingProbe.renders)).toBe(renders);
    await page.setViewportSize(reason === 'blur' ? { width: 800, height: 600 } : { width: 600, height: 800 });
    await expect.poll(() => page.evaluate(() => window.lightingProbe.renders)).toBeGreaterThan(renders);
    expect(await read(page)).toEqual(before);
    if (reason === 'menu') await page.locator('#collection-close').click({ force: true });
    else await page.evaluate(reason => {
      if (reason === 'blur') window.dispatchEvent(new Event('focus'));
      else { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }
    }, reason);
    await tick(page);
    expect(await phase() - clockBefore).toBeCloseTo(0.25, 2);
    await assertCurrentCycle5();
  }
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const saved = await page.evaluate(() => ['barb.save.v1.slotA', 'barb.save.v1.slotB'].map(key => JSON.parse(localStorage.getItem(key)))
    .filter(Boolean).sort((a, b) => b.generation - a.generation)[0].data);
  expect(saved.saveVersion).toBe(1); expect(saved.settings).toEqual({});
  expect(Object.keys(saved.clock)).toEqual(['elapsedSeconds']);
  expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual(['barb.save.v1.slotA', 'barb.save.v1.slotB']);
  await page.reload(); await tick(page);
  assertEnvironment(await page.evaluate(() => window.lightingProbe.first), saved.clock.elapsedSeconds);
  const countsBefore = await attachCounts(page, testInfo, 'before-jumps');
  for (const dt of [500, 4000, 360000 * 100 + 90000]) await page.clock.fastForward(dt);
  const seconds = saved.clock.elapsedSeconds + 0.25 + 0.5 + 4 + 360 * 100 + 90;
  assertEnvironment(await read(page), seconds);
  expect(await attachCounts(page, testInfo, 'after-jumps')).toEqual(countsBefore);
});

for (const viewport of [{ width: 1000, height: 700, touch: false }, { width: 320, height: 568, touch: true },
  { width: 568, height: 320, touch: true }]) {
  test(`foggy night remains readable and operable at ${viewport.width}x${viewport.height}`, async ({ browser }, testInfo) => {
    const { touch, width, height } = viewport;
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      await setup(page, 990, { freeze: false });
      await observeControls(page);
      expect((await read(page)).fogStrength).toBe(1);
      const cdp = await context.newCDPSession(page), x = width * (touch && width > height ? 0.35 : 0.6), y = height * 0.55;
      const down = async () => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }) : (await page.mouse.move(x, y), page.mouse.down());
      const move = (dy, dx = 0) => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy }] }) : page.mouse.move(x + dx, y + dy);
      const up = () => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) : page.mouse.up();
      const initialBoat = (await read(page)).boat;
      await down(); await move(-80);
      await expect(page.locator('#motion-label')).toHaveText('航行中');
      await expect.poll(async () => (await read(page)).boatSpeed).toBeGreaterThan(2);
      await up();
      await expect(page.locator('#motion-label')).toHaveText('停船中');
      expect((await read(page)).boat).not.toEqual(initialBoat);
      let path = testInfo.outputPath('fog-sailing.png');
      await page.screenshot({ path }); await testInfo.attach('fog-sailing', { path, contentType: 'image/png' });
      await activateControl(page, 'fish-button', touch);
      await expect(page.locator('#reticle')).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.lightingProbe.cameraHeight)).toBeCloseTo(2.15, 1);
      const beforeLook = await page.evaluate(() => window.lightingProbe.camera);
      await down(); await move(-30, 70); await up();
      await expect.poll(() => page.evaluate(() => window.lightingProbe.camera)).not.toEqual(beforeLook);
      for (const id of ['menu-button', 'cast-button', 'return-button']) {
        const box = await page.locator(`#${id}`).boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width); expect(box.y + box.height).toBeLessThanOrEqual(height);
      }
      path = testInfo.outputPath('fog-fishing.png');
      await page.screenshot({ path }); await testInfo.attach('fog-fishing', { path, contentType: 'image/png' });
      await attachCounts(page, testInfo, 'fog-fishing');
      await activateControl(page, 'cast-button', touch);
      await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'aim');
      await down(); await move(-120); await up();
      await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'lure');
      await down(); await expect(page.locator('#reel-state')).toHaveText('巻き取り中');
      await up(); await expect(page.locator('#reel-state')).toHaveText('待機中');
      expect((await read(page)).fogStrength).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}
