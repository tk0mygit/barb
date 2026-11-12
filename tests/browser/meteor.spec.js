import { test, expect } from './diagnostics-fixture.js';
import { writeFile } from 'node:fs/promises';
import { setup, tick } from './day-night-fixture.js';
import { assertResourceCatalog } from './lighting-resource-contract.js';
import { assertMeteorNightResources } from '../helpers/meteor-night-resources.js';
import { findMeteorEvent } from '../helpers/meteor-event.js';
import { sampleMeteor } from '../../src/world/meteor.js';
import { createGameClock } from '../../src/game/game-clock.js';

const event = findMeteorEvent();
const readMeteor = page => page.evaluate(() => ({ snapshot: window.lightingProbe.meteorEvidence,
  calls: window.lightingProbe.meteorCalls, counts: window.lightingProbe.performance, catalog: window.lightingProbe.resourceCatalog }));
async function savePair(page, info, label) {
  const pair = await page.evaluate(async () => {
    const pair = window.lightingProbe.captureMeteorPair();
    const pixels = async url => {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return { data: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
    };
    const a = await pixels(pair.withMeteor), b = await pixels(pair.withoutMeteor);
    let changed = 0, distinct = 0, lower = 0, clipped = 0, maximum = 0, moonChanged = 0, moonPixels = 0;
    let minX = a.width, maxX = -1, minY = a.height, maxY = -1;
    const [mx, my, mz] = pair.moonScreen, moonX = (mx + 1) * a.width / 2, moonY = (1 - my) * a.height / 2;
    for (let p = 0; p < a.width * a.height; p++) {
      const i = p * 4, x = p % a.width, y = Math.floor(p / a.width);
      const delta = Math.max(...[0, 1, 2].map(c => Math.abs(a.data[i + c] - b.data[i + c])));
      if (delta) { changed++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      if (delta >= 6) distinct++;
      if (delta && y >= a.height * .35) lower++;
      if (delta && Math.max(...a.data.slice(i, i + 3)) >= 250) clipped++;
      maximum = Math.max(maximum, delta);
      // Actual bright interior of the production moon, not a fabricated mask.
      if (mz > -1 && mz < 1 && Math.hypot(x - moonX, y - moonY) < a.height * .008 && b.data[i] > 170 && b.data[i + 1] > 170) {
        moonPixels++; if (delta) moonChanged++;
      }
    }
    return { ...pair, stats: { width: a.width, height: a.height, changed, distinct, lower, clipped, maximum,
      minX, maxX, minY, maxY, moonPixels, moonChanged } };
  });
  for (const key of ['withMeteor', 'withoutMeteor']) {
    const path = info.outputPath(`${label}-${key}.png`); await writeFile(path, Buffer.from(pair[key].split(',')[1], 'base64'));
    await info.attach(`${label}-${key}`, { path, contentType: 'image/png' });
  }
  await info.attach(`${label}-pixels`, { body: JSON.stringify(pair.stats), contentType: 'application/json' });
  return pair;
}

for (const viewport of [{ width: 1000, height: 700 }, { width: 390, height: 844, touch: true },
  { width: 844, height: 390, touch: true }, { width: 568, height: 320, touch: true }]) {
  test(`meteor native TPS 1.1s and cold GPU: ${viewport.width}x${viewport.height}`, async ({ createContext }, info) => {
    const context = await createContext({ viewport: { width: viewport.width, height: viewport.height },
      hasTouch: Boolean(viewport.touch), isMobile: Boolean(viewport.touch), deviceScaleFactor: 1 });
    const page = await context.newPage(); await setup(page, event.start - .5);
    const before = await readMeteor(page); assertResourceCatalog(before);
    expect(before.snapshot.visible).toBe(false); expect(before.catalog.meteor.initialized).toBe(false); expect(before.calls).toBe(0);
    expect((await savePair(page, info, 'before')).stats.changed).toBe(0);
    await tick(page); expect((await readMeteor(page)).snapshot.visible).toBe(false);
    const frames = [], samples = [];
    for (let i = 1; i <= 11; i++) {
      await page.clock.fastForward(100);
      const current = await readMeteor(page); assertResourceCatalog(current);
      const expected = sampleMeteor(createGameClock(undefined, { elapsedSeconds: event.start + i / 10 }).state, 'CLEAR');
      expect(current.snapshot.visible).toBe(expected.visible);
      expect(current.snapshot.uniforms.meteorProgress).toBeCloseTo(expected.progress, 7);
      expect(current.snapshot.geometryId).toBe(before.snapshot.geometryId); expect(current.snapshot.materialId).toBe(before.snapshot.materialId);
      expect(current.snapshot.attributes).toEqual(before.snapshot.attributes); expect(current.calls).toBeLessThanOrEqual(1);
      expect(current.counts.calls).toBe(before.counts.calls + current.calls);
      expect(current.counts.triangles).toBe(before.counts.triangles + current.calls * 2);
      samples.push({ time: i / 10, ...current });
      if (i === 6) {
        const middle = await savePair(page, info, 'middle');
        expect(middle.stats.distinct).toBeGreaterThan(0); expect(middle.stats.lower).toBe(0); expect(middle.stats.clipped).toBe(0);
      }
      frames.push((await page.evaluate(() => window.lightingProbe.captureMeteorPair())).withMeteor);
    }
    const after = await readMeteor(page); expect(after.snapshot.visible).toBe(false); expect(after.calls).toBe(0);
    expect(after.counts.geometries - before.counts.geometries).toBe(1);
    expect(after.counts.programs - before.counts.programs).toBe(1); expect(after.counts.textures).toBe(before.counts.textures);
    expect((await savePair(page, info, 'after')).stats.changed).toBe(0);
    const path = info.outputPath('meteor-motion.html');
    await writeFile(path, `<!doctype html><meta charset="utf-8"><title>Meteor actual 100ms frames</title><p>Ordinary winner ${JSON.stringify(event)}; 11 actual frames at 100ms game-clock intervals.</p><img id="frame" style="max-width:100%"><script>const frames=${JSON.stringify(frames)};let i=0;setInterval(()=>document.getElementById('frame').src=frames[i++%frames.length],100);</script>`);
    await info.attach('meteor-motion', { path, contentType: 'text/html' });
    await info.attach('meteor-samples', { body: JSON.stringify(samples), contentType: 'application/json' });
    await context.close();
  });
}

test('meteor tail stays behind the actual moon and below foreground depth, with no saturated or lower-frame pixels', async ({ page }, info) => {
  const overlap = findMeteorEvent({ moon: true });
  await page.setViewportSize({ width: 1000, height: 700 }); await setup(page, overlap.start - 6.5);
  await page.locator('#fish-button').click(); for (let i = 0; i < 12; i++) await tick(page);
  // Native READY look toward the ordinary moon/meteor intersection, without
  // camera injection. Finish settling before this event's midpoint.
  const heading = Math.atan2(overlap.direction[0], -overlap.direction[2]);
  await page.mouse.move(400, 400); await page.mouse.down();
  await page.mouse.move(400 + heading / .004, 385); await tick(page); await page.mouse.up();
  for (let i = 0; i < 12; i++) await tick(page);
  await page.clock.fastForward(550);
  const pair = await savePair(page, info, 'moon-overlap');
  expect(pair.stats.distinct).toBeGreaterThan(0); expect(pair.stats.moonPixels).toBeGreaterThan(0);
  expect(pair.stats.moonChanged).toBe(0); expect(pair.stats.clipped).toBe(0); expect(pair.stats.lower).toBe(0);
});

test('meteor native FPS, halfway restore, menu/blur/hidden/resize freeze and long-frame termination', async ({ page }, info) => {
  await page.setViewportSize({ width: 1000, height: 700 }); await setup(page, event.start - 3.25);
  await page.locator('#fish-button').click(); for (let i = 0; i < 12; i++) await tick(page);
  await page.clock.fastForward(550);
  const first = await readMeteor(page); expect(first.snapshot.visible).toBe(true);
  const fps = await savePair(page, info, 'fps'); expect(fps.stats.distinct).toBeGreaterThan(0); expect(fps.stats.lower).toBe(0);
  for (const reason of ['menu', 'blur', 'hidden']) {
    if (reason === 'menu') await page.locator('#menu-button').click();
    else await page.evaluate(reason => {
      if (reason === 'blur') window.dispatchEvent(new Event('blur'));
      else { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
    }, reason);
    const before = await readMeteor(page); await page.clock.fastForward(600000);
    expect((await readMeteor(page)).snapshot).toEqual(before.snapshot);
    await page.setViewportSize(reason === 'blur' ? { width: 1000, height: 700 } : { width: 700, height: 1000 });
    expect((await readMeteor(page)).snapshot).toEqual(before.snapshot);
    if (reason === 'menu') await page.locator('#collection-close').click();
    else await page.evaluate(reason => {
      if (reason === 'blur') window.dispatchEvent(new Event('focus'));
      else { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }
    }, reason);
  }
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const saved = await page.evaluate(() => ['barb.save.v1.slotA', 'barb.save.v1.slotB'].map(key => JSON.parse(localStorage.getItem(key)))
    .filter(Boolean).sort((a, b) => b.generation - a.generation)[0].data.clock.elapsedSeconds);
  await page.reload();
  const restored = await page.evaluate(() => window.lightingProbe.firstMeteorEvidence);
  const expected = sampleMeteor(createGameClock(undefined, { elapsedSeconds: saved }).state, 'CLEAR');
  expect(restored.uniforms.meteorProgress).toBeCloseTo(expected.progress, 7);
  expect(restored.uniforms.meteorProgress).toBeGreaterThan(.4);
  await page.clock.fastForward(2000); expect((await readMeteor(page)).snapshot.visible).toBe(false);
  // The real input still reaches READY/AIM; meteor introduces no HUD/input.
  await page.locator('#fish-button').click(); for (let i = 0; i < 12; i++) await tick(page);
  await page.locator('#cast-button').click(); await tick(page);
  await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'aim');
});

test('meteor 30 nights retain GPU identities; day/fog/nonwinning clocks submit zero; WebGL failure uses existing recovery', async ({ page }, info) => {
  await page.setViewportSize({ width: 640, height: 400 }); await setup(page, event.start + .3);
  const initial = await readMeteor(page), history = [];
  for (let n = 0; n < 31; n++) {
    await page.clock.fastForward(360000); const current = await readMeteor(page); assertResourceCatalog(current);
    expect(current.snapshot.geometryId).toBe(initial.snapshot.geometryId); expect(current.snapshot.materialId).toBe(initial.snapshot.materialId);
    expect(current.snapshot.attributes).toEqual(initial.snapshot.attributes);
    assertMeteorNightResources(history.at(-1) ?? initial, current, n > 5 ? history[5] : undefined);
    history.push(current); await page.setViewportSize(n % 2 ? { width: 640, height: 400 } : { width: 400, height: 640 });
  }
  const path = info.outputPath('31-night-resources.json'); await writeFile(path, JSON.stringify(history, null, 2));
  await info.attach('31-night-resources', { path, contentType: 'application/json' });
  await page.locator('#scene').evaluate(canvas => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  await expect(page.locator('#error')).toContainText('ページを再読み込み');
});

for (const seconds of [90, 1710, 3971 * 360 + 305.55, 665.55]) {
  test(`meteor inactive cold clock ${seconds}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 640, height: 400 }); await setup(page, seconds);
    const state = await readMeteor(page); expect(state.snapshot.visible).toBe(false); expect(state.calls).toBe(0);
    expect(state.catalog.meteor.initialized).toBe(false); assertResourceCatalog(state);
    expect((await savePair(page, info, 'inactive')).stats.changed).toBe(0);
  });
}
