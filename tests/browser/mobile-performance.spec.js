import { test, expect } from './diagnostics-fixture.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { capturePullRequestBase, prepareSceneryReference } from './lake-scenery-reference.js';
import { startCapture, enterFishing, fishingInput, layout, assertLayout, tick } from './mobile-capture.js';
import { assertEnvironment } from './day-night-fixture.js';
import { writeMobileComparison } from '../../scripts/compare-mobile-performance.mjs';
import { calculateRenderResolution } from '../../src/rendering/resolution.js';

const profiles = [
  { id: 'portrait', width: 390, height: 844, dpr: 2, touch: true },
  { id: 'landscape', width: 844, height: 390, dpr: 2, touch: true },
  { id: 'small', width: 360, height: 740, dpr: 3, touch: true },
  { id: 'pc', width: 1280, height: 800, dpr: 1 },
  { id: 'pc-hidpi', width: 1280, height: 800, dpr: 2 },
];
const scenes = [
  { id: 'day-tps', seconds: 90 }, { id: 'day-fps', seconds: 90, fishing: true },
  { id: 'clear-night', seconds: 270 }, { id: 'fog-night', seconds: 3971 * 360 + 270 },
  { id: 'dense-night', seconds: 630 },
];
const compare = capturePullRequestBase || Boolean(process.env.BARB_MOBILE_BASE_SHA);
const targets = process.env.BARB_MOBILE_TARGET ? [process.env.BARB_MOBILE_TARGET] : compare ? ['main', 'pr'] : ['pr'];
const captures = [];
let reference;
const destination = resolve(process.env.BARB_MOBILE_OUTPUT ?? 'test-results/mobile-comparison');
const metric = (s, name) => s.metrics.find(m => m.name === name).value;
test.beforeAll(async ({}, info) => {
  await mkdir(destination, { recursive: true });
  if (targets.includes('main')) reference = await prepareSceneryReference(info, process.env.BARB_MOBILE_BASE_SHA);
});
test.afterAll(async ({}, info) => {
  await reference?.dispose(info);
  for (const target of targets) {
    const path = resolve(destination, `${target}.json`);
    await writeFile(path, JSON.stringify(captures.filter(c => c.target === target), null, 2));
    await info.attach(`mobile-${target}`, { path, contentType: 'application/json' });
  }
  const before = captures.filter(c => c.target === 'main'), after = captures.filter(c => c.target === 'pr');
  if (before.length && before.length === after.length) {
    const path = resolve(destination, 'comparison.html');
    await writeMobileComparison(before, after, path);
    await info.attach('mobile-comparison', { path, contentType: 'text/html' });
  }
});
async function contextFor(createContext, target, profile) {
  const context = await createContext({ ...(target === 'main' ? { baseURL: reference.baseURL } : {}),
    viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.dpr,
    hasTouch: Boolean(profile.touch), isMobile: Boolean(profile.touch) });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  return { context, page, errors };
}
async function saveCapture(target, id, page, metrics, info, withLayout = false) {
  const image = resolve(destination, `${target}-${id}.png`);
  await page.screenshot({ path: image });
  await info.attach(`${target}-${id}`, { path: image, contentType: 'image/png' });
  const entry = { target, id, metrics, image, ...(withLayout ? { layout: await layout(page) } : {}) };
  captures.push(entry);
  await writeFile(resolve(destination, `${target}-${id}.json`), JSON.stringify(entry, null, 2));
  return entry;
}
for (const target of targets) {
  for (const profile of profiles) for (const scene of scenes) {
    test(`mobile rendering: ${target} ${profile.id} ${scene.id}`, async ({ createContext }, info) => {
      const { context, page, errors } = await contextFor(createContext, target, profile);
      const cdp = await context.newCDPSession(page); await cdp.send('Performance.enable');
      const initial = await cdp.send('Performance.getMetrics'), begin = performance.now();
      await startCapture(page, scene.seconds);
      const setupToReadyMs = performance.now() - begin, ready = await cdp.send('Performance.getMetrics');
      assertEnvironment(await page.evaluate(() => window.lightingProbe.first), scene.seconds);
      if (scene.fishing) await enterFishing(page, profile.touch);
      const before = await page.evaluate(() => ({ ...window.mobileProbe, renders: window.lightingProbe.renders,
        boat: window.lightingProbe.last.boat, waterTime: window.lightingProbe.last.waterTime, fogStrength: window.lightingProbe.last.fogStrength }));
      const entry = await saveCapture(target, `${profile.id}-${scene.id}`, page, before, info);
      const cpuStart = await cdp.send('Performance.getMetrics'), wallStart = performance.now();
      await page.clock.runFor(96);
      const wallMs = performance.now() - wallStart, cpuEnd = await cdp.send('Performance.getMetrics');
      const after = await page.evaluate(() => ({ ...window.mobileProbe, renders: window.lightingProbe.renders }));
      expect(after.renders - before.renders).toBe(6);
      expect(after.resources).toEqual(before.resources);
      expect(before.resources.calls).toBeLessThan(40);
      expect(before.dpr).toBe(profile.dpr);
      const expectedRatio = target === 'main' ? Math.min(profile.dpr, 1.75) : calculateRenderResolution({ width: profile.width, height: profile.height, devicePixelRatio: profile.dpr, coarsePointer: Boolean(profile.touch) }).pixelRatio;
      expect(before.pixelRatio).toBe(expectedRatio);
      expect(before.buffer).toEqual({ width: Math.floor(profile.width * expectedRatio), height: Math.floor(profile.height * expectedRatio) });
      expect(before.camera.aspect).toBeCloseTo(profile.width / profile.height, 8);
      const metrics = { ...before, savedClockSeconds: scene.seconds,
        initial: { setupToReadyMs, rendererTaskMs: (metric(ready, 'TaskDuration') - metric(initial, 'TaskDuration')) * 1000 },
        continuing: { frames: 6, simulatedMs: 96, wallMs, rendererTaskMs: (metric(cpuEnd, 'TaskDuration') - metric(cpuStart, 'TaskDuration')) * 1000 }, errors };
      if (profile.id === 'pc-hidpi' && scene.id === 'day-tps') {
        // Three fixed windows distinguish the noisy first sample from later
        // frames without retrying a failed assertion or changing scene quality.
        metrics.pcSamples = [metrics.continuing];
        let previousFrame = after.renders;
        for (let sample = 0; sample < 2; sample++) {
          const start = await cdp.send('Performance.getMetrics'), time = performance.now();
          await page.clock.runFor(96);
          const elapsed = performance.now() - time, end = await cdp.send('Performance.getMetrics');
          const state = await page.evaluate(() => ({ resources: window.mobileProbe.resources, renders: window.lightingProbe.renders }));
          expect(state.renders - previousFrame).toBe(6); expect(state.resources).toEqual(before.resources);
          previousFrame = state.renders;
          metrics.pcSamples.push({ frames: 6, simulatedMs: 96, wallMs: elapsed,
            rendererTaskMs: (metric(end, 'TaskDuration') - metric(start, 'TaskDuration')) * 1000 });
        }
      }
      entry.metrics = metrics;
      await writeFile(resolve(destination, `${target}-${entry.id}.json`), JSON.stringify(entry, null, 2));
      expect(errors).toEqual([]);
      await context.close();
    });
  }
  for (const profile of profiles.filter(p => p.id !== 'pc-hidpi')) {
    test(`mobile HUD: ${target} ${profile.id} native fight and rotation`, async ({ createContext }, info) => {
      test.setTimeout(240000);
      const { context, page, errors } = await contextFor(createContext, target, profile);
      await startCapture(page); await enterFishing(page, profile.touch);
      if (target === 'pr') assertLayout(await layout(page), { fight: false });
      const input = await fishingInput(page, profile.touch);
      await input.bite();
      await saveCapture(target, `${profile.id}-bite`, page, await page.evaluate(() => window.mobileProbe), info, true);
      if (target === 'pr') {
        assertLayout(await layout(page), { fight: false });
        await expect(page.locator('#hint')).toContainText('1秒以内');
        await expect(page.locator('#fishing-state')).toContainText('今すぐタップ');
      }
      await input.hook();
      const fightResources = await page.evaluate(() => window.mobileProbe.resources);
      await expect(page.locator('#fishing-state')).toHaveAttribute('role', 'status');
      await expect(page.locator('#line-tension')).toHaveAttribute('low', '0.18');
      await expect(page.locator('#line-tension')).toHaveAttribute('high', '0.78');
      await saveCapture(target, `${profile.id}-fight`, page, await page.evaluate(() => window.mobileProbe), info, true);
      {
        if (target === 'pr') assertLayout(await layout(page));
        // Native down within HUD bounds must reach the canvas and change tension.
        const s = await layout(page), value = s.tension;
        await input.down({ x: s.panel.x + s.panel.width / 2, y: s.panel.y + s.panel.height / 2 });
        for (let i = 0; i < 12 && (await layout(page)).tension <= 0.78; i++) await tick(page);
        const high = await layout(page); expect(high.tension).toBeGreaterThan(value); expect(high.tension).toBeGreaterThan(0.78);
        if (target === 'pr') assertLayout(high); await input.up();
        for (let i = 0; i < 16 && (await layout(page)).tension >= 0.18; i++) await tick(page);
        const low = await layout(page); expect(low.tension).toBeLessThan(0.18); if (target === 'pr') assertLayout(low);
        await expect(page.locator('#tension-value')).toHaveText(`${Math.round(low.tension * 100)}%`);
      }
      if (profile.id === 'portrait') {
        await page.setViewportSize({ width: 844, height: 390 });
        // Resize renders synchronously, even without advancing the fight clock.
        await expect.poll(() => page.evaluate(() => window.mobileProbe.viewport.width)).toBe(844);
        const metrics = await page.evaluate(() => window.mobileProbe);
        expect(metrics.camera.aspect).toBeCloseTo(844 / 390, 8);
        expect(metrics.pixelRatio).toBe(target === 'main' ? 1.75 : 1.5);
        for (const field of ['geometries', 'textures', 'programs']) expect(metrics.resources[field]).toBe(fightResources[field]);
        expect(metrics.resources.calls).toBeLessThan(40);
        await saveCapture(target, 'rotated-fight', page, metrics, info, true);
        if (target === 'pr') assertLayout(await layout(page));
      }
      expect(errors).toEqual([]); await context.close();
    });
  }
}
