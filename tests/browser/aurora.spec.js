import { test, expect } from './diagnostics-fixture.js';
import { writeFile } from 'node:fs/promises';
import { setup, tick } from './day-night-fixture.js';
import { assertResourceCatalog } from './lighting-resource-contract.js';
import { findAuroraNight } from '../helpers/aurora-event.js';
import { createGameClock } from '../../src/game/game-clock.js';
import { sampleAurora } from '../../src/world/aurora.js';
import { meteorRoll } from '../../src/world/meteor.js';
import { mobileGit, readMobileImplementation, assertMobileWorkingSource, mobileSourceMetadata } from '../../scripts/lib/mobile-comparison-source.js';

const night = findAuroraNight({ forward: true }), midnight = night * 360 + 270;
let source;
test.beforeAll(async () => {
  source = await readMobileImplementation(await mobileGit('rev-parse', 'HEAD'));
  await assertMobileWorkingSource(source);
});
test.afterAll(async () => { if (source) await assertMobileWorkingSource(source); });
const read = page => page.evaluate(() => ({ snapshot: window.lightingProbe.auroraEvidence,
  gpu: window.lightingProbe.auroraGPU, draws: window.lightingProbe.auroraDraws,
  counts: window.lightingProbe.performance, catalog: window.lightingProbe.resourceCatalog,
  stars: window.lightingProbe.starCalls, meteor: window.lightingProbe.meteorCalls, camera: window.lightingProbe.camera }));
async function attachJSON(info, name, value) {
  const path = info.outputPath(`${name}.json`);
  await writeFile(path, JSON.stringify({ source: mobileSourceMetadata(source), evidence: value }, null, 2));
  await info.attach(name, { path, contentType: 'application/json' });
}
async function pair(page, info, label) {
  const result = await page.evaluate(async () => {
    const pair = window.lightingProbe.captureAuroraPair();
    const pixels = async url => {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
    };
    const base = await pixels(pair.withoutAurora);
    const stats = async url => {
      const a = await pixels(url), [mx, my, mz] = pair.moonScreen;
      const moonX = (mx + 1) * a.width / 2, moonY = (1 - my) * a.height / 2;
      let changed = 0, distinct = 0, lower = 0, clipped = 0, maximum = 0, moonPixels = 0, moonChanged = 0;
      let minX = a.width, maxX = -1, minY = a.height, maxY = -1;
      for (let p = 0; p < a.width * a.height; p++) {
        const i = p * 4, x = p % a.width, y = Math.floor(p / a.width);
        const delta = Math.max(Math.abs(a.data[i] - base.data[i]), Math.abs(a.data[i + 1] - base.data[i + 1]), Math.abs(a.data[i + 2] - base.data[i + 2]));
        if (delta) {
          changed++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          if (y >= a.height * .60) lower++;
          if (Math.max(a.data[i], a.data[i + 1], a.data[i + 2]) >= 250) clipped++;
        }
        if (delta >= 4) distinct++; maximum = Math.max(maximum, delta);
        if (mz > -1 && mz < 1 && Math.hypot(x - moonX, y - moonY) < a.height * .004
          && base.data[i] > 170 && base.data[i + 1] > 170) { moonPixels++; if (delta) moonChanged++; }
      }
      return { width: a.width, height: a.height, changed, distinct, lower, clipped, maximum, moonPixels, moonChanged, minX, maxX, minY, maxY };
    };
    return { ...pair, stats: await stats(pair.withAurora), layerStats: await Promise.all(pair.layers.map(stats)) };
  });
  for (const [key, data] of [['on', result.withAurora], ['off', result.withoutAurora], ...result.layers.map((data, i) => [`layer-${i}`, data])]) {
    const path = info.outputPath(`${label}-${key}.png`); await writeFile(path, Buffer.from(data.split(',')[1], 'base64'));
    await info.attach(`${label}-${key}`, { path, contentType: 'image/png' });
  }
  await attachJSON(info, `${label}-pixels`, { stats: result.stats, layers: result.layerStats });
  return result;
}
async function look(page, context, viewport, dx, dy = 0) {
  const x = Math.min(100, viewport.width * .2), y = viewport.height * .55;
  if (viewport.touch) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy }] });
    await tick(page); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy); await tick(page); await page.mouse.up();
  }
  for (let i = 0; i < 12; i++) await tick(page);
}

for (const viewport of [{ width: 1000, height: 700 }, { width: 390, height: 844, touch: true },
  { width: 844, height: 390, touch: true }, { width: 568, height: 320, touch: true }]) {
  test(`aurora ordinary winner native TPS/FPS two real layers and 200ms motion ${viewport.width}x${viewport.height}`, async ({ createContext }, info) => {
    const context = await createContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1,
      hasTouch: Boolean(viewport.touch), isMobile: Boolean(viewport.touch) });
    const page = await context.newPage(); await setup(page, midnight);
    const initial = await read(page); assertResourceCatalog(initial);
    expect(initial.draws).toEqual([{ calls: 1, triangles: 1600 }, { calls: 1, triangles: 1600 }]);
    expect(initial.stars).toBe(1); expect(initial.gpu.programInstances).toBe(1);
    const tps = await pair(page, info, 'tps');
    expect(tps.stats.distinct).toBeGreaterThan(100); expect(tps.stats.lower).toBe(0); expect(tps.stats.clipped).toBe(0);
    for (const layer of tps.layerStats) expect(layer.distinct).toBeGreaterThan(50);
    if (viewport.touch) await page.locator('#fish-button').tap(); else await page.locator('#fish-button').click();
    for (let i = 0; i < 12; i++) await tick(page);
    await look(page, context, viewport, 0, -80);
    await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'ready');
    const fps = await pair(page, info, 'fps-up');
    expect(fps.stats.distinct).toBeGreaterThan(100); expect(fps.stats.moonChanged).toBe(0);
    expect(fps.stats.clipped).toBe(0); expect(fps.stats.lower).toBe(0);
    for (const layer of fps.layerStats) expect(layer.distinct).toBeGreaterThan(50);
    const frames = [], samples = [];
    for (let i = 0; i < 8; i++) {
      await page.clock.fastForward(200);
      const current = await read(page); assertResourceCatalog(current);
      expect(current.snapshot.geometryId).toBe(initial.snapshot.geometryId);
      expect(current.snapshot.attributes).toEqual(initial.snapshot.attributes); expect(current.snapshot.indices).toEqual(initial.snapshot.indices);
      expect(current.gpu).toEqual(initial.gpu);
      expect(current.draws).toEqual(initial.draws);
      if (samples.length) expect(current.snapshot.layers[0].uniforms.auroraTime).toBeGreaterThan(samples.at(-1).time);
      frames.push((await page.evaluate(() => window.lightingProbe.captureAuroraPair())).withAurora);
      samples.push({ time: current.snapshot.layers[0].uniforms.auroraTime, draws: current.draws, counts: current.counts, gpu: current.gpu });
    }
    expect(new Set(frames).size).toBeGreaterThan(1);
    const gallery = info.outputPath('aurora-review.html');
    await writeFile(gallery, `<!doctype html><meta charset="utf-8"><title>Sky-4 aurora review</title><style>body{background:#12212a;color:#eee;font:16px system-ui}img{max-width:100%}figure{display:inline-block;max-width:48%;margin:1%}</style><h1>Sky-4: ordinary CLEAR night ${night}</h1><p>Same clock/camera/viewport ON/OFF and individual layers; native TPS/FPS. Actual 200ms rendered sequence below. No device FPS claim.</p>${[['TPS ON',tps.withAurora],['TPS OFF',tps.withoutAurora],['FPS ON',fps.withAurora],['FPS OFF',fps.withoutAurora],...fps.layers.map((data,i)=>['Layer '+i,data])].map(([label,data])=>`<figure><figcaption>${label}</figcaption><img src="${data}"></figure>`).join('')}<h2>200ms actual frames</h2><img id="motion"><script>const frames=${JSON.stringify(frames)};let i=0;setInterval(()=>document.getElementById('motion').src=frames[i++%frames.length],200);</script>`);
    await info.attach('aurora-review', { path: gallery, contentType: 'text/html' });
    await attachJSON(info, 'aurora-motion-resources', { savedClockSeconds: midnight, viewport, initial, samples });
    await context.close();
  });
}

for (const [offset, opacity] of [[0, 0], [7.5, .5], [15, 1], [90, 1], [165, 1], [172.5, .5], [180, 0]]) {
  test(`aurora first restored render fade ${offset}s`, async ({ page }, info) => {
    const seconds = night * 360 + 180 + offset; await page.setViewportSize({ width: 1000, height: 700 }); await setup(page, seconds);
    const first = await page.evaluate(() => ({ snapshot: window.lightingProbe.firstAuroraEvidence, catalog: window.lightingProbe.firstResourceCatalog,
      counts: window.lightingProbe.firstPerformance }));
    assertResourceCatalog(first);
    for (const layer of first.snapshot.layers) { expect(layer.uniforms.auroraOpacity).toBe(opacity); expect(layer.visible).toBe(opacity > 0); }
    const expected = sampleAurora(createGameClock(undefined, { elapsedSeconds: seconds }).state, 'CLEAR');
    expect(first.snapshot.layers[0].uniforms.auroraTime).toBe(expected.time);
    expect(first.gpu?.programInstances ?? first.catalog.aurora.programInstances).toBe(opacity > 0 ? 1 : 0);
    await pair(page, info, `fade-${offset}`);
  });
}

for (const seconds of [90, findAuroraNight({ selected: false }) * 360 + 270,
  findAuroraNight({ fogType: 'FOG' }) * 360 + 270, findAuroraNight({ fogType: 'DENSE_FOG' }) * 360 + 270, 4 * 360 + 270]) {
  test(`aurora inactive or offscreen cold GPU ${seconds}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 640, height: 400 }); await setup(page, seconds);
    const current = await read(page); assertResourceCatalog(current);
    expect(current.draws.every(layer => layer.calls === 0)).toBe(true); expect(current.gpu.programInstances).toBe(0);
    expect(current.catalog.aurora.initialized).toBe(false);
    expect(Object.values(current.gpu.buffers)).toEqual([null, null, null]);
    expect((await pair(page, info, 'inactive')).stats.changed).toBe(0);
  });
}

test('aurora world direction, opposite view and short landscape cannot supply Sky-5 observation evidence', async ({ page, context }, info) => {
  const viewport = { width: 1000, height: 700 }; await page.setViewportSize(viewport); await setup(page, midnight);
  await page.locator('#fish-button').click(); for (let i = 0; i < 12; i++) await tick(page);
  await look(page, context, viewport, 0, -80);
  const front = await read(page), frontPixels = await pair(page, info, 'front'); expect(frontPixels.stats.distinct).toBeGreaterThan(100);
  await look(page, context, viewport, Math.PI / .004);
  const back = await read(page); expect(back.snapshot.layers.every(layer => layer.visible)).toBe(true);
  expect(back.draws.every(layer => layer.calls === 0)).toBe(true); expect((await pair(page, info, 'back')).stats.changed).toBe(0);
  for (let i = 0; i < 2; i++) {
    expect(back.snapshot.layers[i].quaternion).toEqual(front.snapshot.layers[i].quaternion);
    expect(back.snapshot.layers[i].position).toEqual(front.snapshot.layers[i].position);
  }
  await page.setViewportSize({ width: 568, height: 320 });
  expect((await pair(page, info, 'back-short-landscape')).stats.changed).toBe(0);
});

test('aurora menu/blur/hidden/resize, halfway save restore, 30-night reuse and existing context-loss recovery', async ({ page }, info) => {
  await page.setViewportSize({ width: 640, height: 400 }); await setup(page, midnight);
  const initial = await read(page);
  for (const reason of ['menu', 'blur', 'hidden']) {
    if (reason === 'menu') await page.locator('#menu-button').click();
    else await page.evaluate(reason => {
      if (reason === 'blur') window.dispatchEvent(new Event('blur'));
      else { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
    }, reason);
    const before = await read(page); await page.clock.fastForward(600000); expect((await read(page)).snapshot).toEqual(before.snapshot);
    await page.setViewportSize({ width: 568, height: 320 }); expect((await read(page)).snapshot).toEqual(before.snapshot);
    if (reason === 'menu') await page.locator('#collection-close').click();
    else await page.evaluate(reason => {
      if (reason === 'blur') window.dispatchEvent(new Event('focus'));
      else { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }
    }, reason);
  }
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const saved = await page.evaluate(() => ['barb.save.v1.slotA', 'barb.save.v1.slotB'].map(key => JSON.parse(localStorage.getItem(key)))
    .filter(Boolean).sort((a,b) => b.generation-a.generation)[0].data);
  expect(Object.keys(saved.clock)).toEqual(['elapsedSeconds']); expect(saved.saveVersion).toBe(3);
  await page.reload();
  const first = await page.evaluate(() => window.lightingProbe.firstAuroraEvidence);
  const expected = sampleAurora(createGameClock(undefined, { elapsedSeconds: saved.clock.elapsedSeconds }).state, 'CLEAR');
  expect(first.layers[0].uniforms.auroraTime).toBe(expected.time); expect(first.layers[0].uniforms.auroraOpacity).toBe(expected.opacity);
  const restored = await read(page), history = [];
  for (let n = 0; n < 31; n++) {
    await page.clock.fastForward(360000); const current = await read(page); assertResourceCatalog(current);
    expect(current.snapshot.geometryId).toBe(restored.snapshot.geometryId);
    expect(current.snapshot.layers.map(layer => layer.materialId)).toEqual(restored.snapshot.layers.map(layer => layer.materialId));
    expect(current.snapshot.attributes).toEqual(initial.snapshot.attributes); expect(current.gpu.buffers).toEqual(restored.gpu.buffers);
    history.push({ night: n, counts: current.counts, gpu: current.gpu, draws: current.draws });
  }
  await attachJSON(info, 'aurora-31-night-GPU', history);
  await page.locator('#scene').evaluate(canvas => {
    const extension = canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('Actual context-loss extension unavailable');
    extension.loseContext();
  });
  await expect(page.locator('#error')).toContainText('ページを再読み込み');
});

test('ordinary simultaneous stars/meteor/aurora submit at most four Sky batches and zero new textures', async ({ page }, info) => {
  const n = findAuroraNight({ forward: true, meteor: true });
  const slot = Array.from({ length: 18 }, (_, slot) => slot).find(slot => meteorRoll(n, slot) < .005);
  await page.setViewportSize({ width: 1000, height: 700 }); await setup(page, n * 360 + 180 + slot * 10 + 5.55);
  const current = await read(page); assertResourceCatalog(current);
  expect(current.snapshot.layers.every(layer => layer.visible)).toBe(true);
  expect(current.stars).toBe(1); expect(current.meteor).toBe(1);
  expect(current.draws).toEqual([{ calls: 1, triangles: 1600 }, { calls: 1, triangles: 1600 }]);
  expect(current.stars + current.meteor + current.draws.reduce((n, row) => n + row.calls, 0)).toBe(4);
  expect(current.counts.textures).toBe(4);
  await attachJSON(info, 'simultaneous-sky-resources', { savedClockSeconds: n * 360 + 180 + slot * 10 + 5.55, ...current });
  await pair(page, info, 'simultaneous');
});
