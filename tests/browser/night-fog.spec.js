import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { getNightFogProfile } from '../../src/world/night-fog.js';
import { tick, read, setup, assertEnvironment, observeControls, activateControl } from './day-night-fixture.js';

test.use({ deviceScaleFactor: 0.5 });
const reviewImages = [];
test.afterAll(async ({}, testInfo) => {
  if (!reviewImages.length) return;
  const figures = await Promise.all(reviewImages.map(async ({ label, path, counts }) =>
    `<figure><figcaption>${label}${counts ? ' — ' + JSON.stringify(counts) : ''}</figcaption><img src="data:image/png;base64,${(await readFile(path)).toString('base64')}"></figure>`));
  const path = testInfo.outputPath('fog-review.html');
  await writeFile(path, `<!doctype html><meta charset="utf-8"><title>BARB fog review</title>
    <style>body{background:#15222b;color:#eee;font:16px system-ui;margin:24px}figure{margin:24px 0}img{max-width:100%;height:auto}figcaption{margin-bottom:8px}</style>
    <h1>Phase 4B-1,2 Update</h1><p>Production build; matched boat (10,20), heading 0, night phase 90s. CLEAR / FOG ≈30,50,70% / DENSE 95%. Layer pair hides only the three mist meshes in the test observer. Dense controls use real PC/touch input.</p>${figures.join('')}`);
  await testInfo.attach('fog-review-gallery', { path, contentType: 'text/html' });
});

async function attachCounts(page, testInfo, label) {
  const counts = await page.evaluate(() => window.lightingProbe.performance);
  const path = testInfo.outputPath(`${label}-render-counts.json`);
  await writeFile(path, JSON.stringify(counts, null, 2));
  await testInfo.attach(`${label}-render-counts`, { path, contentType: 'application/json' });
  return counts;
}

// Fixed genuine night indices near each requested optical target. All views
// use the same saved boat, camera, midnight phase and untouched production fog.
for (const [index, label] of [[0, 'clear'], [8301, 'fog-30'], [3971, 'fog-50'], [5825, 'fog-70'], [1, 'dense-95']]) {
  test(`matched night view ${label}: calibrated fog and bounded GPU cost`, async ({ browser }, testInfo) => {
    const profile = getNightFogProfile(index), seconds = index * 360 + 270;
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await setup(page, seconds);
      assertEnvironment(await page.evaluate(() => window.lightingProbe.first), seconds);
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      const path = testInfo.outputPath(`${label}.png`);
      await page.screenshot({ path });
      await testInfo.attach(label, { path, contentType: 'image/png' });
      const actual = await attachCounts(page, testInfo, label);
      reviewImages.push({ label, path, counts: actual });
      // Stable scene topology; each independent case checks the same baseline
      // and the exact three-sheet cost, without retaining five GPU contexts.
      const fog = profile.targetFogAmount > 0;
      expect(actual).toEqual({ calls: 30 + (fog ? 3 : 0), triangles: 220228 + (fog ? 6144 : 0),
        geometries: 23 + (fog ? 1 : 0), textures: 3, programs: 12 + (fog ? 1 : 0) });
      if (label === 'fog-50') {
        const pair = await page.evaluate(async () => {
          const pair = window.lightingProbe.captureMistPair();
          const pixels = async data => {
            const image = new Image(); image.src = data; await image.decode();
            const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
            return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          };
          const a = await pixels(pair.withMist), b = await pixels(pair.withoutMist);
          let changed = 0, maximum = 0;
          for (let i = 0; i < a.length; i += 4) {
            const delta = Math.max(...[0, 1, 2].map(c => Math.abs(a[i + c] - b[i + c])));
            if (delta > 0) changed++; maximum = Math.max(maximum, delta);
          }
          return { ...pair, changed, maximum };
        });
        expect(pair.changed).toBeGreaterThan(1000); expect(pair.maximum).toBeGreaterThan(1);
        for (const name of ['withMist', 'withoutMist']) {
          const path = testInfo.outputPath(`surface-${name}.png`);
          await writeFile(path, Buffer.from(pair[name].split(',')[1], 'base64'));
          await testInfo.attach(`surface-${name}`, { path, contentType: 'image/png' });
          reviewImages.push({ label: `surface-${name}`, path });
        }
        await testInfo.attach('surface-pixel-difference', { body: JSON.stringify({ changed: pair.changed, maximum: pair.maximum }), contentType: 'application/json' });
      }

      const colors = await page.evaluate(() => ({ water: window.lightingProbe.uploadedWaterFog, scene: window.lightingProbe.outputFog }));
      colors.water.forEach((v, i) => expect(v).toBeCloseTo(colors.scene[i], 7));
      expect((await read(page)).fogStrength).toBeCloseTo(profile.targetFogAmount, 7);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}

test('fog fades at both boundaries, freezes with menu/focus/visibility and restores the saved night on first render', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await setup(page, 898); // cycle 2, just before its foggy night
  await page.locator('#fish-button').click({ force: true }); await tick(page);
  const display = page.locator('#fishing-conditions');
  const phase = async () => Number(await display.getAttribute('data-cycle-progress')) * 360;
  const advanceTo = async target => page.clock.fastForward(Math.round((target - await phase()) * 1000));
  const assertCurrent = async () => assertEnvironment(await read(page), 720 + await phase());
  for (const [target, strength] of [[180, 0], [186, 0.475], [192, 0.95], [270, 0.95], [348, 0.95], [354, 0.475], [359.999, 0]]) {
    await advanceTo(target);
    await assertCurrent();
    expect((await read(page)).fogStrength).toBeCloseTo(strength, 2);
  }
  await page.clock.fastForward(100); // include a rendered frame on the daytime side
  await expect(display).toHaveAttribute('data-time-of-day', 'day');
  expect((await read(page)).fogStrength).toBe(0);
  // One long active frame crosses whole cycles and lands inside a later fade.
  await page.clock.fastForward(2880000 + 186000 - Math.round(await phase() * 1000));
  expect((await read(page)).fogStrength).toBeCloseTo(0.475, 2); // cycle 11 is dense
  const assertCurrentCycle11 = async () => assertEnvironment(await read(page), 3960 + await phase());
  await assertCurrentCycle11();
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
    await assertCurrentCycle11();
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
  const after = await attachCounts(page, testInfo, 'after-jumps');
  for (const field of ['geometries', 'textures', 'programs']) expect(after[field]).toBe(countsBefore[field]);
  const visible = (await read(page)).mistVisible;
  expect(after.calls).toBe(countsBefore.calls - (visible ? 0 : 3));
  expect(after.triangles).toBe(countsBefore.triangles - (visible ? 0 : 6144));
});

for (const viewport of [{ width: 1000, height: 700, touch: false }, { width: 320, height: 568, touch: true },
  { width: 568, height: 320, touch: true }]) {
  test(`dense fog remains readable and operable at ${viewport.width}x${viewport.height}`, async ({ browser }, testInfo) => {
    const { touch, width, height } = viewport;
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      await setup(page, 932, { freeze: false });
      await observeControls(page);
      expect((await read(page)).fogStrength).toBe(0.95);
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
      reviewImages.push({ label: `dense TPS ${width}×${height}`, path });
      await activateControl(page, 'fish-button', touch);
      await expect(page.locator('#reticle')).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.lightingProbe.cameraHeight)).toBeCloseTo(2.15, 1);
      const beforeLook = await page.evaluate(() => window.lightingProbe.camera);
      await down(); await move(-30, 70);
      await expect.poll(() => page.evaluate(() => window.lightingProbe.camera)).not.toEqual(beforeLook);
      await up();
      for (const id of ['menu-button', 'cast-button', 'return-button']) {
        const box = await page.locator(`#${id}`).boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width); expect(box.y + box.height).toBeLessThanOrEqual(height);
      }
      path = testInfo.outputPath('fog-fishing.png');
      await page.screenshot({ path }); await testInfo.attach('fog-fishing', { path, contentType: 'image/png' });
      reviewImages.push({ label: `dense FPS ${width}×${height}`, path });
      await attachCounts(page, testInfo, 'fog-fishing');
      await activateControl(page, 'cast-button', touch);
      await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'aim');
      await down(); await move(-120); await up();
      await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'lure');
      await down(); await expect(page.locator('#reel-state')).toHaveText('巻き取り中');
      await up(); await expect(page.locator('#reel-state')).toHaveText('待機中');
      expect((await read(page)).fogStrength).toBe(0.95);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}
