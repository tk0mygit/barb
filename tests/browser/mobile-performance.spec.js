import { test, expect } from './diagnostics-fixture.js';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { capturePullRequestBase, prepareSceneryReference } from './lake-scenery-reference.js';
import { enterFishing, fishingInput, layout, assertLayout, tick } from './mobile-capture.js';
import { assertEnvironment, setup } from './day-night-fixture.js';
import { MOBILE_COMPARISON_MODES, MOBILE_CAPTURE_IDS, writeMobileComparison } from '../../scripts/compare-mobile-performance.mjs';
import { mobileGit, readMobileImplementation, mobileSourceMetadata, assertMobileWorkingSource,
  expectedMobileResolution, replayMobileCamera, HISTORICAL_MOBILE_BASE } from '../../scripts/lib/mobile-comparison-source.js';

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
let comparison;
const implementations = {};
const mode = process.env.BARB_MOBILE_COMPARISON_MODE ?? 'regression';
const destination = resolve(process.env.BARB_MOBILE_OUTPUT ?? 'test-results/mobile-comparison');
const metric = (s, name) => s.metrics.find(m => m.name === name).value;

async function startCapture(page, seconds = 90) {
  // Keep this observer local: ordinary screenshots retain the real camera.
  // A separate fixed camera aligns culling when comparing rendering cost.
  await page.addInitScript(() => {
    let devtools;
    Object.defineProperty(window, '__THREE_DEVTOOLS__', { configurable: true,
      get: () => devtools,
      set(value) {
        devtools = value;
        value.addEventListener('observe', ({ detail: renderer }) => {
          if (!renderer.isWebGLRenderer) return;
          let frame = null, diagnosticCamera;
          window.mobileCameraFrames = [];
          const setAnimationLoop = renderer.setAnimationLoop;
          renderer.setAnimationLoop = function(callback) {
            let previous = performance.now();
            return setAnimationLoop.call(this, callback && (now => {
              frame = { dt: Math.min(0.25, Math.max(0, (now - previous) / 1000)) };
              previous = now;
              try { callback(now); } finally { frame = null; }
            }));
          };
          const render = renderer.render;
          const resources = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
            geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs.length });
          renderer.render = function(scene, camera) {
            diagnosticCamera ??= camera.clone();
            diagnosticCamera.aspect = camera.aspect;
            diagnosticCamera.fov = 55;
            diagnosticCamera.position.set(10, 8.5, 38);
            diagnosticCamera.lookAt(10, 2.5, 2);
            diagnosticCamera.updateProjectionMatrix();
            render.call(this, scene, diagnosticCamera);
            const fixedResources = resources();
            const result = render.call(this, scene, camera), actualResources = resources();
            const gl = this.getContext(), panel = document.querySelector('#fishing-panel');
            const phase = panel.dataset.phase;
            const ring = scene.children.find(o => o.isGroup && o.children.some(c => c.isLine)
              && o.children.some(c => c.geometry?.type === 'RingGeometry'))
              ?.children.find(o => o.geometry?.type === 'RingGeometry');
            window.mobileCameraFrames.push({ update: Boolean(frame), dt: frame?.dt ?? 0, aspect: camera.aspect,
              mode: document.body.classList.contains('fishing') ? 'fishing' : 'sailing',
              phase, preparing: document.querySelector('#app').dataset.castPreparing === 'true',
              tracking: ['fight', 'landing'].includes(phase) ? { x: ring.position.x, z: ring.position.z } : null });
            window.mobileProbe = { viewport: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio,
              pixelRatio: this.getPixelRatio(), buffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
              pixels: gl.drawingBufferWidth * gl.drawingBufferHeight,
              resources: fixedResources, actualResources,
              resourceCamera: { position: diagnosticCamera.position.toArray(), quaternion: diagnosticCamera.quaternion.toArray(),
                aspect: diagnosticCamera.aspect, fov: diagnosticCamera.fov },
              camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), aspect: camera.aspect } };
            return result;
          };
        });
      },
    });
  });
  await setup(page, seconds);
}
test.beforeAll(async ({}, info) => {
  expect(MOBILE_COMPARISON_MODES).toContain(mode);
  await mkdir(destination, { recursive: true });
  if (targets.includes('main')) reference = await prepareSceneryReference(info, process.env.BARB_MOBILE_BASE_SHA);
  const event = capturePullRequestBase ? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')) : null;
  const validationSha = await mobileGit('rev-parse', 'HEAD');
  const baseSha = reference?.sha ?? process.env.BARB_MOBILE_BASE_SHA ?? event?.pull_request?.base?.sha ?? null;
  implementations.pr = await readMobileImplementation(validationSha);
  await assertMobileWorkingSource(implementations.pr);
  if (baseSha) implementations.main = await readMobileImplementation(baseSha);
  if (mode === 'historical-improvement') expect(baseSha).toBe(HISTORICAL_MOBILE_BASE);
  comparison = { mode, baseSha, headSha: event?.pull_request?.head?.sha ?? validationSha, validationSha,
    implementations: Object.fromEntries(Object.entries(implementations).map(([target, source]) => [target, mobileSourceMetadata(source)])),
    conditions: { profiles, scenes, renderer: 'production WebGL2; headless Chromium/SwiftShader',
      resourceCamera: 'fixed boat-relative TPS pose (10,8.5,38), lookAt (10,2.5,2), FOV55; paired diagnostic pass then actual production view',
      timing: 'Node monotonic wall clock + CDP TaskDuration; six frames / 96 virtual ms; includes paired diagnostic passes, not device FPS or GPU time' } };
  const path = resolve(destination, 'comparison-metadata.json');
  await writeFile(path, JSON.stringify(comparison, null, 2));
  await info.attach('mobile-comparison-metadata', { path, contentType: 'application/json' });
});
test.afterAll(async ({}, info) => {
  await reference?.dispose(info);
  for (const target of targets) {
    const path = resolve(destination, `${target}.json`);
    await writeFile(path, JSON.stringify(captures.filter(c => c.target === target), null, 2));
    await info.attach(`mobile-${target}`, { path, contentType: 'application/json' });
  }
  const before = captures.filter(c => c.target === 'main'), after = captures.filter(c => c.target === 'pr');
  if (before.length === MOBILE_CAPTURE_IDS.length && after.length === MOBILE_CAPTURE_IDS.length) {
    const path = resolve(destination, 'comparison.html');
    await writeMobileComparison(before, after, path, comparison);
    await info.attach('mobile-comparison', { path, contentType: 'text/html' });
    await info.attach('mobile-comparison-metrics', { path: path.replace(/\.html$/, '.json'), contentType: 'application/json' });
  } else if (before.length || after.length) {
    const path = resolve(destination, 'comparison-incomplete.json');
    await writeFile(path, JSON.stringify({ status: 'incomplete; full 34-pair comparison not executed', expectedPairs: MOBILE_CAPTURE_IDS.length,
      captured: { main: before.map(entry => entry.id), pr: after.map(entry => entry.id) },
      missing: Object.fromEntries([['main', before], ['pr', after]].map(([target, entries]) =>
        [target, MOBILE_CAPTURE_IDS.filter(id => !entries.some(entry => entry.id === id))])) }, null, 2));
    await info.attach('mobile-comparison-incomplete', { path, contentType: 'application/json' });
  }
  if (capturePullRequestBase) {
    expect(before, 'PR CI requires every main capture').toHaveLength(MOBILE_CAPTURE_IDS.length);
    expect(after, 'PR CI requires every PR capture').toHaveLength(MOBILE_CAPTURE_IDS.length);
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
  const cameraFrames = await page.evaluate(() => window.mobileCameraFrames);
  const cameraExpected = replayMobileCamera(implementations[target], cameraFrames);
  for (const key of ['position', 'quaternion']) for (let i = 0; i < cameraExpected[key].length; i++) {
    expect(metrics.camera[key][i], `${id}: source camera ${key}[${i}]`).toBeCloseTo(cameraExpected[key][i], 10);
  }
  expect(metrics.camera.aspect).toBe(cameraExpected.aspect);
  const image = resolve(destination, `${target}-${id}.png`);
  await page.screenshot({ path: image });
  await info.attach(`${target}-${id}`, { path: image, contentType: 'image/png' });
  const entry = { target, id, comparison, metrics: { ...metrics, cameraExpected, cameraFrames }, image,
    ...(withLayout ? { layout: await layout(page) } : {}) };
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
      expect(after.actualResources).toEqual(before.actualResources);
      expect(before.resources.calls).toBeLessThan(40);
      expect(before.actualResources.calls).toBeLessThan(40);
      expect(before.dpr).toBe(profile.dpr);
      const expected = expectedMobileResolution(implementations[target], profile);
      expect(before.pixelRatio).toBe(expected.pixelRatio);
      expect(before.buffer).toEqual(expected.buffer);
      expect(before.camera.aspect).toBeCloseTo(expected.aspect, 8);
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
      entry.metrics = { ...entry.metrics, ...metrics };
      await writeFile(resolve(destination, `${target}-${entry.id}.json`), JSON.stringify(entry, null, 2));
      expect(errors).toEqual([]);
      await context.close();
    });
  }
  for (const profile of profiles.filter(p => p.id !== 'pc-hidpi')) {
    test(`mobile HUD: ${target} ${profile.id} native fight and rotation`, async ({ createContext }, info) => {
      test.setTimeout(240000);
      const { context, page, errors } = await contextFor(createContext, target, profile);
      const currentHUD = implementations[target].resolutionModel === 'mobile-budget';
      await startCapture(page); await enterFishing(page, profile.touch);
      if (currentHUD) assertLayout(await layout(page), { fight: false });
      const input = await fishingInput(page, profile.touch);
      await input.bite();
      await saveCapture(target, `${profile.id}-bite`, page, await page.evaluate(() => window.mobileProbe), info, true);
      if (currentHUD) {
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
        if (currentHUD) assertLayout(await layout(page));
        // Native down within HUD bounds must reach the canvas and change tension.
        const s = await layout(page), value = s.tension;
        await input.down({ x: s.panel.x + s.panel.width / 2, y: s.panel.y + s.panel.height / 2 });
        for (let i = 0; i < 12 && (await layout(page)).tension <= 0.78; i++) await tick(page);
        const high = await layout(page); expect(high.tension).toBeGreaterThan(value); expect(high.tension).toBeGreaterThan(0.78);
        if (currentHUD) assertLayout(high); await input.up();
        for (let i = 0; i < 16 && (await layout(page)).tension >= 0.18; i++) await tick(page);
        const low = await layout(page); expect(low.tension).toBeLessThan(0.18); if (currentHUD) assertLayout(low);
        await expect(page.locator('#tension-value')).toHaveText(`${Math.round(low.tension * 100)}%`);
      }
      if (profile.id === 'portrait') {
        await page.setViewportSize({ width: 844, height: 390 });
        // Resize renders synchronously, even without advancing the fight clock.
        await expect.poll(() => page.evaluate(() => window.mobileProbe.viewport.width)).toBe(844);
        const metrics = await page.evaluate(() => window.mobileProbe);
        const expected = expectedMobileResolution(implementations[target], { ...profile, width: 844, height: 390 });
        expect(metrics.camera.aspect).toBeCloseTo(expected.aspect, 8);
        expect(metrics.pixelRatio).toBe(expected.pixelRatio);
        expect(metrics.buffer).toEqual(expected.buffer);
        for (const field of ['geometries', 'textures', 'programs']) expect(metrics.resources[field]).toBe(fightResources[field]);
        expect(metrics.resources.calls).toBeLessThan(40);
        await saveCapture(target, 'rotated-fight', page, metrics, info, true);
        if (currentHUD) assertLayout(await layout(page));
      }
      expect(errors).toEqual([]); await context.close();
    });
  }
}
