import { test, expect } from './diagnostics-fixture.js';
import { readFile, writeFile } from 'node:fs/promises';
import { performance as wallClock } from 'node:perf_hooks';
import { setup, read, assertEnvironment } from './day-night-fixture.js';
import { capturePullRequestBase, prepareSceneryReference } from './lake-scenery-reference.js';
import { writeComparison } from '../../scripts/compare-lake-scenery.mjs';

// Capture the real production build. Saved coordinates, native UI input and
// the existing paused shared clock make the main/PR views reproducible.
const views = [
  { id: 'day-tps', label: '昼・TPS', seconds: 90 },
  { id: 'day-fps', label: '昼・FPS', seconds: 90, fishing: true },
  { id: 'twilight', label: '夕暮れ', seconds: 176 },
  { id: 'clear-night', label: '霧のない夜', seconds: 270 },
  { id: 'fog-night', label: '通常霧の夜', seconds: 3971 * 360 + 270 },
  { id: 'dense-night', label: '濃霧の夜', seconds: 630 },
  { id: 'portrait', label: 'スマートフォン縦', seconds: 90, width: 390, height: 844, touch: true },
  { id: 'landscape', label: 'スマートフォン横', seconds: 90, width: 844, height: 390, touch: true },
];
const captures = [];
let reference;
test.beforeAll(async ({}, testInfo) => { if (capturePullRequestBase) reference = await prepareSceneryReference(testInfo); });
const metric = (snapshot, name) => snapshot.metrics.find(entry => entry.name === name).value;

test.afterAll(async ({}, testInfo) => {
  await reference?.dispose(testInfo);
  if (!captures.length) return;
  const path = testInfo.outputPath('lake-scenery-gallery.html');
  const figures = await Promise.all(captures.map(async ({ target, view, image, metrics }) =>
    `<figure><figcaption>${target} · ${view.label} · ${metrics.viewport.width}×${metrics.viewport.height} · saved clock ${view.seconds}s · ${JSON.stringify(metrics.resources)}</figcaption><img src="data:image/png;base64,${(await readFile(image)).toString('base64')}"></figure>`));
  await writeFile(path, `<!doctype html><html lang="ja"><meta charset="utf-8"><title>BARB lake scenery</title><style>body{background:#142329;color:#e4e8e0;font:16px system-ui;margin:24px}figure{margin:32px 0}img{max-width:100%;height:auto}figcaption{margin-bottom:10px}</style><h1>BARB Phase 4C-1A</h1><p>Boat (10,20), heading 0; deviceScaleFactor 1; production build, unchanged scene renderer and clock. Node monotonic wall time measures fixture setup-to-ready and a fixed 25-frame sampling window. CDP TaskDuration measures renderer main-thread task duration, including waits. Sampling includes automation overhead; these are not device FPS or GPU timings.</p>${figures.join('')}</html>`);
  await testInfo.attach('lake-scenery-gallery', { path, contentType: 'text/html' });
  const json = testInfo.outputPath('lake-scenery-metrics.json');
  await writeFile(json, JSON.stringify(captures.map(({ target, view, metrics }) => ({ target, id: view.id, ...metrics })), null, 2));
  await testInfo.attach('lake-scenery-metrics', { path: json, contentType: 'application/json' });
  if (reference && captures.filter(capture => capture.target === 'main').length === 8 && captures.filter(capture => capture.target === 'pr').length === 8) {
    const series = async target => new Map(await Promise.all(captures.filter(capture => capture.target === target).map(async ({ view, metrics, image }) =>
      [view.id, { metrics, image: (await readFile(image)).toString('base64') }])));
    const comparison = testInfo.outputPath('lake-scenery-comparison.html');
    await writeComparison(await series('main'), await series('pr'), comparison, `PR base ${reference.sha.slice(0, 7)}`);
    await testInfo.attach('lake-scenery-comparison', { path: comparison, contentType: 'text/html' });
    await testInfo.attach('lake-scenery-comparison-metrics', { path: comparison.replace(/\.html$/, '.json'), contentType: 'application/json' });
  }
});

for (const target of capturePullRequestBase ? ['pr', 'main'] : ['pr']) for (const view of views) {
  test(`lake scenery: ${target === 'main' ? 'main ' : ''}${view.id}`, async ({ createContext }, testInfo) => {
    const viewport = { width: view.width ?? 1000, height: view.height ?? 700 };
    const context = await createContext({ ...(target === 'main' ? { baseURL: reference.baseURL } : {}), viewport, deviceScaleFactor: 1, hasTouch: Boolean(view.touch), isMobile: Boolean(view.touch) });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    await page.addInitScript(() => {
      const install = () => {
        window.__THREE_DEVTOOLS__.addEventListener('observe', ({ detail: renderer }) => {
          if (!renderer.isWebGLRenderer) return;
          const original = renderer.render;
          renderer.render = function(scene, camera) {
            const result = original.call(this, scene, camera);
            window.sceneryCamera = { position: camera.position.toArray(), quaternion: camera.quaternion.toArray() };
            return result;
          };
        });
      };
      Object.defineProperty(window, '__THREE_DEVTOOLS__', { configurable: true,
        get() { return this.sceneryDevtools; }, set(value) { this.sceneryDevtools = value; install(); } });
    });
    const initialCpu = await cdp.send('Performance.getMetrics');
    const loadStart = wallClock.now();
    await setup(page, view.seconds);
    const navigationToReadyMs = wallClock.now() - loadStart;
    const readyCpu = await cdp.send('Performance.getMetrics');
    assertEnvironment(await page.evaluate(() => window.lightingProbe.first), view.seconds);
    if (view.fishing) {
      const button = page.locator('#fish-button');
      await expect(button).toBeVisible(); await expect(button).toBeEnabled();
      const point = await button.evaluate(button => {
        const box = button.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2;
        return { x, y, hit: document.elementFromPoint(x, y)?.closest('button')?.id };
      });
      expect(point.hit).toBe('fish-button');
      await page.mouse.click(point.x, point.y);
      // Advance the existing smooth camera transition, without setting scene
      // transforms or bypassing the production mode transition.
      for (let frame = 0; frame < 12; frame++) await page.clock.fastForward(250);
      await expect(page.locator('#reticle')).toBeVisible();
      await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'ready');
      expect(await page.evaluate(() => window.lightingProbe.cameraHeight)).toBeCloseTo(2.15, 2);
    }
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    const image = testInfo.outputPath(`${view.id}.png`);
    await page.screenshot({ path: image });
    await testInfo.attach(view.id, { path: image, contentType: 'image/png' });
    const before = await page.evaluate(() => ({ resources: window.lightingProbe.performance, lighting: window.lightingProbe.last, camera: window.sceneryCamera, renders: window.lightingProbe.renders }));
    // 25 ordinary rendered animation frames verify stable GPU allocations.
    // This is a bounded sampling window, not a sleep or retry of failed input.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const sampleCpuStart = await cdp.send('Performance.getMetrics');
    const sampleWallStart = wallClock.now();
    await page.clock.runFor(400);
    const sampleWallMs = wallClock.now() - sampleWallStart;
    const sampleCpuEnd = await cdp.send('Performance.getMetrics');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    const after = await page.evaluate(() => ({ resources: window.lightingProbe.performance, camera: window.sceneryCamera, renders: window.lightingProbe.renders }));
    for (const field of ['geometries', 'textures', 'programs']) expect(after.resources[field]).toBe(before.resources[field]);
    expect(before.resources.calls).toBeLessThan(40);
    const sampledFrames = after.renders - before.renders;
    expect(sampledFrames).toBe(25);
    const taskDurationMs = (metric(sampleCpuEnd, 'TaskDuration') - metric(sampleCpuStart, 'TaskDuration')) * 1000;
    const metrics = { viewport, deviceScaleFactor: 1, savedClockSeconds: view.seconds, boat: before.lighting.boat, heading: 0,
      camera: before.camera, waterTime: before.lighting.waterTime, fogStrength: before.lighting.fogStrength,
      resources: before.resources, afterResources: after.resources,
      initialLoad: { navigationToReadyMs, rendererTaskMs: (metric(readyCpu, 'TaskDuration') - metric(initialCpu, 'TaskDuration')) * 1000,
        jsHeapUsedBytes: metric(readyCpu, 'JSHeapUsedSize') },
      continuingFrames: { sampledFrames, simulatedMilliseconds: 400, sampleWallMs,
        wallMillisecondsPerFrame: sampleWallMs / sampledFrames, rendererTaskMs: taskDurationMs,
        rendererTaskMillisecondsPerFrame: taskDurationMs / sampledFrames }, errors };
    const json = testInfo.outputPath(`${view.id}-metrics.json`);
    await writeFile(json, JSON.stringify(metrics, null, 2));
    await testInfo.attach(`${view.id}-metrics`, { path: json, contentType: 'application/json' });
    captures.push({ target, view, image, metrics });
    const selectors = view.fishing ? '#menu-button, #cast-button, #return-button' : '#menu-button, #fish-button';
    for (const box of await page.locator(selectors).evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().toJSON()))) {
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await read(page)).boatSpeed).toBe(0);
    expect(errors).toEqual([]);
    await context.close();
  });
}
