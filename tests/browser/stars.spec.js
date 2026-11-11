import { test, expect } from './diagnostics-fixture.js';
import { writeFile } from 'node:fs/promises';
import { setup, tick, read, assertEnvironment } from './day-night-fixture.js';
import { assertResourceCatalog } from './lighting-resource-contract.js';

const clearStart = 4 * 360 + 180;
for (const [offset, opacity] of [[0, 0], [6, .5], [12, 1], [90, 1], [168, 1], [174, .5], [180, 0]]) {
  test(`star first render: CLEAR night offset ${offset}s`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await setup(page, clearStart + offset);
    const first = await page.evaluate(() => window.lightingProbe.first);
    assertEnvironment(first, clearStart + offset);
    expect(first.stars.opacity).toBeCloseTo(opacity, 9);
    expect(first.stars.visible).toBe(opacity > 0);
    const catalog = await page.evaluate(() => ({ counts: window.lightingProbe.firstPerformance, catalog: window.lightingProbe.firstResourceCatalog }));
    assertResourceCatalog(catalog);
    expect(catalog.catalog.stars.initialized).toBe(opacity > 0);
    const image = info.outputPath(`fade-${offset}.png`); await page.screenshot({ path: image });
    await info.attach(`fade-${offset}`, { path: image, contentType: 'image/png' });
  });
}

async function pixelPair(page) {
  return page.evaluate(async () => {
    const pair = window.lightingProbe.captureStarPair();
    const pixels = async url => {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
    };
    const a = await pixels(pair.withStars), b = await pixels(pair.withoutStars);
    let changed = 0, distinguishable = 0, maximum = 0, lowerChanged = 0, clipped = 0, moonChanged = 0;
    const [mx, my, mz] = window.lightingProbe.moonScreen;
    const moonX = (mx + 1) * a.width / 2, moonY = (1 - my) * a.height / 2;
    for (let i = 0; i < a.data.length; i += 4) {
      const delta = Math.max(...[0, 1, 2].map(c => Math.abs(a.data[i + c] - b.data[i + c]))), p = i / 4;
      const x = p % a.width, y = Math.floor(p / a.width);
      if (delta) { changed++; if (y > a.height * .25) lowerChanged++; }
      if (delta >= 6) distinguishable++;
      maximum = Math.max(maximum, delta);
      if (delta && Math.max(...a.data.slice(i, i + 3)) >= 250) clipped++;
      if (mz > -1 && mz < 1 && Math.hypot(x - moonX, y - moonY) < a.height * .003) moonChanged += Number(delta > 0);
    }
    return { ...pair, stats: { width: a.width, height: a.height, changed, distinguishable, maximum, lowerChanged, clipped, moonChanged } };
  });
}
async function savePair(page, info, label) {
  const pair = await pixelPair(page);
  for (const key of ['withStars', 'withoutStars']) {
    const path = info.outputPath(`${label}-${key}.png`);
    await writeFile(path, Buffer.from(pair[key].split(',')[1], 'base64'));
    await info.attach(`${label}-${key}`, { path, contentType: 'image/png' });
  }
  await info.attach(`${label}-pixels`, { body: JSON.stringify(pair.stats), contentType: 'application/json' });
  return pair.stats;
}

for (const viewport of [{ width: 1000, height: 700 }, { width: 390, height: 844, touch: true },
  { width: 844, height: 390, touch: true }, { width: 568, height: 320, touch: true }]) {
  test(`stars native view and moon/depth: ${viewport.width}x${viewport.height}`, async ({ createContext }, info) => {
    const context = await createContext({ viewport: { width: viewport.width, height: viewport.height },
      hasTouch: Boolean(viewport.touch), isMobile: Boolean(viewport.touch), deviceScaleFactor: 1 });
    const page = await context.newPage(); await setup(page, 1710);
    const tps = await savePair(page, info, 'tps');
    expect(tps.distinguishable).toBeGreaterThan(3); expect(tps.maximum).toBeGreaterThan(10);
    expect(tps.lowerChanged).toBe(0); expect(tps.clipped).toBe(0);
    await page.locator('#fish-button').click();
    for (let i = 0; i < 12; i++) await tick(page);
    // Native READY look at the existing +12-degree pitch limit brings the
    // production moon and open sky into view. No camera/scene transform injection.
    const x = viewport.width * .4, y = viewport.height * .55;
    if (viewport.touch) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 100 }] });
      await tick(page); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y - 100);
      await tick(page); await page.mouse.up();
    }
    for (let i = 0; i < 12; i++) await tick(page);
    const fps = await savePair(page, info, 'fps-up');
    expect(fps.distinguishable).toBeGreaterThan(3); expect(fps.clipped).toBe(0); expect(fps.moonChanged).toBe(0);
    const evidence = await page.evaluate(() => window.lightingProbe.starEvidence);
    expect(evidence.attributes.position.count).toBe(240);
    await context.close();
  });
}

test('30 nights, pause/menu/hidden/blur/resize and save restoration preserve the one star allocation', async ({ page }, info) => {
  await page.setViewportSize({ width: 640, height: 400 }); await setup(page, 1710);
  const initial = await page.evaluate(() => window.lightingProbe.starEvidence);
  const history = [];
  // The game clock accepts an active long frame; simulation retains its .25s
  // safety cap. Jump to each genuine next midnight without weather overrides.
  for (let night = 0; night < 30; night++) {
    await page.clock.fastForward(360000);
    const state = await read(page), evidence = await page.evaluate(() => window.lightingProbe.starEvidence);
    assertEnvironment(state, 1710.25 + (night + 1) * 360);
    expect(evidence.geometryId).toBe(initial.geometryId); expect(evidence.materialId).toBe(initial.materialId);
    expect(evidence.attributes).toEqual(initial.attributes);
    const resources = await page.evaluate(() => ({ counts: window.lightingProbe.performance, catalog: window.lightingProbe.resourceCatalog }));
    assertResourceCatalog(resources); history.push({ night, counts: resources.counts, stars: state.stars });
    if (night >= 4) {
      expect(resources.counts.geometries).toBe(history[4].counts.geometries);
      expect(resources.counts.programs).toBe(history[4].counts.programs); expect(resources.counts.textures).toBe(4);
    }
    await page.setViewportSize(night % 2 ? { width: 640, height: 400 } : { width: 400, height: 640 });
  }
  for (const reason of ['menu', 'blur', 'hidden']) {
    if (reason === 'menu') await page.locator('#menu-button').click();
    else await page.evaluate(reason => {
      if (reason === 'blur') window.dispatchEvent(new Event('blur'));
      else { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
    }, reason);
    const before = await read(page); await page.clock.fastForward(600000); expect(await read(page)).toEqual(before);
    await page.setViewportSize(reason === 'blur' ? { width: 400, height: 640 } : { width: 640, height: 400 });
    expect((await read(page)).stars).toEqual(before.stars);
    if (reason === 'menu') await page.locator('#collection-close').click();
    else await page.evaluate(reason => {
      if (reason === 'blur') window.dispatchEvent(new Event('focus'));
      else { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }
    }, reason);
    await tick(page);
    expect((await page.evaluate(() => window.lightingProbe.starEvidence)).geometryId).toBe(initial.geometryId);
  }
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const saved = await page.evaluate(() => ['barb.save.v1.slotA', 'barb.save.v1.slotB'].map(key => JSON.parse(localStorage.getItem(key)))
    .filter(Boolean).sort((a, b) => b.generation - a.generation)[0].data.clock.elapsedSeconds);
  await page.reload(); await tick(page); assertEnvironment(await page.evaluate(() => window.lightingProbe.first), saved);
  await info.attach('30-night-resources', { body: JSON.stringify(history), contentType: 'application/json' });
  await page.locator('#scene').evaluate(canvas => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#error')).toContainText('ページを再読み込み');
});
