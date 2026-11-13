import { test, expect } from './diagnostics-fixture.js';
import { writeFile } from 'node:fs/promises';
import { setup, tick, assertEnvironment } from './day-night-fixture.js';
import { prepareSceneryReference } from './lake-scenery-reference.js';
import { findAuroraNight } from '../helpers/aurora-event.js';
import { measureAuroraWorldLight } from '../helpers/aurora-world-light-pixels.js';
import { readMobileImplementation, mobileGit, assertMobileWorkingSource, mobileSourceMetadata } from '../../scripts/lib/mobile-comparison-source.js';
import { readSky4R2Transition, readWorldLightSource } from '../../scripts/lib/sky4r2-source.js';
import { sampleDayNight } from '../../src/world/day-night.js';
import { createGameClock } from '../../src/game/game-clock.js';

const baseSha = '50bc6ebcca09e50b90c3a30c5dc8613255d85c6a', night = findAuroraNight({ forward: true }), seconds = night * 360 + 270;
let sources, reference;
test.beforeAll(async ({}, info) => {
  sources = { main: await readMobileImplementation(baseSha), pr: await readMobileImplementation(await mobileGit('rev-parse', 'HEAD')) };
  await assertMobileWorkingSource(sources.pr); await readSky4R2Transition(sources.main, sources.pr); reference = await prepareSceneryReference(info, baseSha);
});
test.afterAll(async ({}, info) => { await reference?.dispose(info); if (sources) await assertMobileWorkingSource(sources.pr); });

for (const viewport of [{ width: 1000, height: 700 }, { width: 390, height: 844, touch: true }, { width: 844, height: 390, touch: true }]) for (const mode of ['TPS', 'FPS']) {
  test(`Sky-4R2 real color/world/water A/B ${mode} ${viewport.width}x${viewport.height}`, async ({ createContext }, info) => {
    const captures = {}, evidence = {}, files = [];
    let lastPage, moonScreen;
    for (const target of ['main', 'pr']) {
      const context = await createContext({ ...(target === 'main' ? { baseURL: reference.baseURL } : {}), viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1, hasTouch: Boolean(viewport.touch), isMobile: Boolean(viewport.touch) });
      const page = await context.newPage(); await setup(page, seconds);
      if (mode === 'FPS') {
        if (viewport.touch) await page.locator('#fish-button').tap(); else await page.locator('#fish-button').click();
        for (let i = 0; i < 12; i++) await tick(page);
        const x = Math.min(100, viewport.width * .2), y = viewport.height * .55;
        if (viewport.touch) {
          const cdp = await context.newCDPSession(page);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 80 }] });
          await tick(page); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y - 80); await tick(page); await page.mouse.up(); }
        for (let i = 0; i < 12; i++) await tick(page);
      }
      const before = await page.evaluate(() => ({ lighting: window.lightingProbe.last, counts: window.lightingProbe.performance,
        snapshot: window.lightingProbe.auroraEvidence, gpu: window.lightingProbe.auroraGPU,
        draws: window.lightingProbe.auroraDraws, world: window.lightingProbe.readWorldLight(), camera: window.lightingProbe.camera,
        moon: window.lightingProbe.moonScreen }));
      const absolute = seconds + ((before.lighting.mistTime - seconds % 3600 + 3600) % 3600);
      assertEnvironment(before.lighting, absolute);
      const base = sampleDayNight(createGameClock(undefined, { elapsedSeconds: absolute }).state);
      const parts = await page.evaluate(base => window.lightingProbe.captureWorldLightParts(base), base);
      const after = await page.evaluate(() => ({ counts: window.lightingProbe.performance, world: window.lightingProbe.readWorldLight() }));
      expect(after.counts).toEqual(before.counts); expect(after.world).toEqual(before.world);
      for (const [name, part] of Object.entries(parts)) {
        const named = name === 'masks' ? Object.entries(part) : name === 'layers' ? part.map((p, i) => [`layer-${i}`, p.image]) : [[name, part.image]];
        for (const [label, url] of named) {
          const filename = `${target}-${name === 'masks' ? 'mask-' : ''}${label}.png`;
          await writeFile(info.outputPath(filename), Buffer.from(url.split(',')[1], 'base64')); files.push({ target, label, filename });
        }
      }
      captures[target] = parts; evidence[target] = { absolute, before, after }; lastPage = page; moonScreen = before.moon;
    }
    expect(evidence.pr.absolute).toBe(evidence.main.absolute); expect(evidence.pr.before.camera).toEqual(evidence.main.before.camera);
    expect(evidence.pr.before.counts).toEqual(evidence.main.before.counts);
    const pixels = await lastPage.evaluate(async ({ source, before, after, moon }) => (0, eval)(`(${source})`)(before, after, moon),
      { source: measureAuroraWorldLight.toString(), before: captures.main, after: captures.pr, moon: moonScreen });
    const json = info.outputPath('color-world-light.json');
    await writeFile(json, JSON.stringify({ baseSha, headSha: sources.pr.sha, sources: Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, mobileSourceMetadata(value)])),
      viewport, mode, pixels, evidence, parts: Object.fromEntries(Object.entries(captures).map(([target, parts]) => [target,
        Object.fromEntries(Object.entries(parts).filter(([key]) => !['masks', 'layers'].includes(key)).map(([key, value]) => [key, value.world]))])) }, null, 2));
    await info.attach('color-world-light', { path: json, contentType: 'application/json' });
    const html = info.outputPath('review.html');
    await writeFile(html, `<!doctype html><meta charset="utf-8"><title>Sky-4R2 color and world light</title><style>body{background:#12212a;color:#eee;font:15px system-ui}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}img{width:100%}figure{margin:8px}pre{white-space:pre-wrap}</style><h1>${mode} ${viewport.width}×${viewport.height}</h1><p>同一保存時計・native camera・DPR。本体、既存Hemi、水面の寄与を同一frameで分離。semantic maskは既存材質uniformと実geometry/depthを使用し、別material/shaderを作成しません。</p>${['full','lightOff','bothOff','ambientOff','waterOff','mask-aurora','mask-boat','mask-terrain','mask-water'].map(label=>`<h2>${label}</h2><div class="pair">${['main','pr'].map(target=>`<figure><figcaption>${target}</figcaption><img src="${target}-${label}.png"></figure>`).join('')}</div>`).join('')}<pre>${JSON.stringify(pixels, null, 2)}</pre>`);
    await info.attach('review', { path: html, contentType: 'text/html' });
    expect(pixels.off.maximum).toBe(0); expect(pixels.brightness.clipped).toBe(0); expect(pixels.brightness.lowerMesh).toBe(0); expect(pixels.brightness.moonChanged).toBe(0);
    expect(pixels.brightness.afterContribution).toBeGreaterThan(pixels.brightness.beforeContribution * 1.3);
    expect(pixels.brightness.afterMean).toBeGreaterThan(pixels.brightness.beforeMean * 1.05);
    expect(Object.entries(pixels.colorAfter.counts).filter(([key, count]) => count >= 50 && pixels.colorAfter.fractions[key] >= .03).length).toBeGreaterThanOrEqual(2);
    if (mode === 'TPS') { expect(pixels.boatAmbient.distinct).toBeGreaterThan(50); expect(pixels.boatAmbient.meanLuminanceDelta).toBeGreaterThan(0); }
    expect(pixels.terrainAmbient.distinct).toBeGreaterThan(100); expect(pixels.waterReflection.distinct).toBeGreaterThan(100);
    expect(pixels.waterReflection.meanLuminanceDelta).toBeGreaterThan(0);
  });
}

for (const [name, at] of [['day', 90], ['nonwinner', findAuroraNight({ selected: false }) * 360 + 270],
  ['FOG', findAuroraNight({ fogType: 'FOG' }) * 360 + 270], ['DENSE_FOG', findAuroraNight({ fogType: 'DENSE_FOG' }) * 360 + 270]]) {
  test(`Sky-4R2 inactive whole-frame exact A/B ${name}`, async ({ createContext }, info) => {
    const results = [];
    for (const target of ['main', 'pr']) {
      const context = await createContext({ ...(target === 'main' ? { baseURL: reference.baseURL } : {}),
        viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
      const page = await context.newPage(); await setup(page, at);
      const result = await page.evaluate(() => ({ image: window.lightingProbe.captureAuroraPair().withAurora,
        light: window.lightingProbe.readWorldLight(), counts: window.lightingProbe.performance,
        catalog: window.lightingProbe.resourceCatalog, gpu: window.lightingProbe.auroraGPU }));
      await writeFile(info.outputPath(`${target}.png`), Buffer.from(result.image.split(',')[1], 'base64'));
      results.push(result);
    }
    expect(results[1].image).toBe(results[0].image); expect(results[1].counts).toEqual(results[0].counts);
    expect(results[1].light.ambient.color).toEqual(results[0].light.ambient.color);
    expect(results[1].light.ambient.ground).toEqual(results[0].light.ambient.ground);
    expect(results[1].light.ambient.intensity).toBe(results[0].light.ambient.intensity);
    expect(results[1].light.water.light).toEqual({ color: [0, 0, 0], strength: 0, direction: [0, 0] });
    expect(results[1].gpu.programInstances).toBe(0); expect(Object.values(results[1].gpu.buffers)).toEqual([null, null, null]);
    await writeFile(info.outputPath('inactive.json'), JSON.stringify({ at, headSha: sources.pr.sha, results: results.map(({ image, ...rest }) => rest) }, null, 2));
  });
}

test('Sky-4R2 real SkyCheck 18x couples both fades and restores the original environment at day boundary', async ({ page }, info) => {
  const start = night * 360 + 180;
  await page.setViewportSize({ width: 640, height: 400 });
  await page.addInitScript(() => localStorage.setItem('barb.play.preferences.v1', JSON.stringify({ version: 1, dayNightSkip: true })));
  await setup(page, start); await page.locator('#day-night-skip').click();
  const frames = [];
  for (let i = 0; i <= 40; i++) {
    if (i) await tick(page);
    const state = await page.evaluate(() => ({ lighting: window.lightingProbe.last, world: window.lightingProbe.readWorldLight(),
      snapshot: window.lightingProbe.auroraEvidence, gpu: window.lightingProbe.auroraGPU,
      skipping: document.querySelector('#app').dataset.timeSkipping }));
    const absolute = start + ((state.lighting.mistTime - start % 3600 + 3600) % 3600);
    assertEnvironment(state.lighting, absolute); frames.push({ i, absolute, ...state });
    expect(state.world.water.gpuLight.strength).toBe(Math.fround(state.world.water.light.strength));
    expect(state.world.water.gpu.buffers).toEqual(frames[0].world.water.gpu.buffers);
    if ([0, 2, 20, 38, 40].includes(i)) await page.screenshot({ path: info.outputPath(`skip-${i}.png`) });
  }
  expect(frames.some(f => f.world.water.light.strength > 0 && f.world.water.light.strength < .14)).toBe(true);
  expect(frames.some(f => f.world.water.light.strength === .14)).toBe(true);
  const last = frames.at(-1); expect(last.skipping).toBe('false'); expect(last.world.water.light.strength).toBe(0);
  expect(last.snapshot.layers.every(layer => !layer.visible)).toBe(true);
  await writeFile(info.outputPath('skip-light.json'), JSON.stringify({ headSha: sources.pr.sha, frames }, null, 2));
});

test('Sky-4R2 31 nights keep water/light/GPU identities and reset after a selected night', async ({ page }, info) => {
  await page.setViewportSize({ width: 640, height: 400 }); await setup(page, seconds);
  const history = [];
  const first = await page.evaluate(() => ({ lighting: window.lightingProbe.last, world: window.lightingProbe.readWorldLight() }));
  const absolute = seconds + ((first.lighting.mistTime - seconds % 3600 + 3600) % 3600);
  for (let n = 0; n <= 30; n++) {
    if (n) await page.clock.fastForward(360000);
    const current = await page.evaluate(() => ({ lighting: window.lightingProbe.last, world: window.lightingProbe.readWorldLight() }));
    assertEnvironment(current.lighting, absolute + n * 360);
    expect(current.world.lights.map(light => light.id)).toEqual(first.world.lights.map(light => light.id));
    for (const key of ['geometryId', 'materialId', 'attributes', 'index', 'gpu']) expect(current.world.water[key]).toEqual(first.world.water[key]);
    history.push(current);
  }
  expect(history.some(s => s.world.water.light.strength === 0)).toBe(true);
  await writeFile(info.outputPath('world-31-night.json'), JSON.stringify({ headSha: sources.pr.sha, history }, null, 2));
});

test('Sky-4R2 opposite native FPS culls both curtains and contributes zero directional water pixels', async ({ page, context }, info) => {
  await page.setViewportSize({ width: 1000, height: 700 }); await setup(page, seconds);
  await page.locator('#fish-button').click(); for (let i = 0; i < 12; i++) await tick(page);
  const look = async (dx, dy) => {
    await page.mouse.move(100, 385); await page.mouse.down(); await page.mouse.move(100 + dx, 385 + dy); await tick(page); await page.mouse.up();
    for (let i = 0; i < 12; i++) await tick(page);
  };
  await look(0, -80); const front = await page.evaluate(() => window.lightingProbe.readWorldLight());
  await look(Math.PI / .004, 0);
  const state = await page.evaluate(() => ({ lighting: window.lightingProbe.last, world: window.lightingProbe.readWorldLight(),
    draws: window.lightingProbe.auroraDraws }));
  expect(state.draws.every(layer => layer.calls === 0)).toBe(true); expect(state.world.water.light.strength).toBe(.14);
  expect(state.world.water.gpu).toEqual(front.water.gpu);
  const at = seconds + ((state.lighting.mistTime - seconds % 3600 + 3600) % 3600);
  const base = sampleDayNight(createGameClock(undefined, { elapsedSeconds: at }).state);
  const parts = await page.evaluate(base => window.lightingProbe.captureWorldLightParts(base), base);
  // Keep the global existing Hemi enabled on both sides; only directionally
  // reflected water light is excluded, so this cannot hide ambient changes.
  expect(parts.full.image).toBe(parts.waterOff.image);
  for (const name of ['full', 'waterOff']) await writeFile(info.outputPath(`back-${name}.png`), Buffer.from(parts[name].image.split(',')[1], 'base64'));
  await writeFile(info.outputPath('back.json'), JSON.stringify({ headSha: sources.pr.sha, at, state }, null, 2));
});


for (const phase of [180, 360]) test(`Sky-4R2 exact first rendered fade=0 whole-frame A/B at ${phase}s`, async ({ createContext }, info) => {
  const results = [];
  for (const target of ['main', 'pr']) {
    const context = await createContext({ ...(target === 'main' ? { baseURL: reference.baseURL } : {}),
      viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.addInitScript(() => {
      let events;
      Object.defineProperty(window, '__THREE_DEVTOOLS__', { configurable: true, get: () => events, set(value) {
        events = value; value.addEventListener('observe', ({ detail: renderer }) => {
          if (!renderer.isWebGLRenderer) return;
          const render = renderer.render; let first = true;
          renderer.render = function(scene, camera) {
            const result = render.apply(this, arguments);
            if (first) {
              first = false; const ambient = scene.children.find(o => o.isHemisphereLight), u = scene.getObjectByName('lake-water').material.uniforms;
              window.r2FirstFrame = { image: renderer.domElement.toDataURL('image/png'),
                ambient: { color: ambient.color.toArray(), ground: ambient.groundColor.toArray(), intensity: ambient.intensity },
                light: u.auroraStrength ? { color: u.auroraColor.value.toArray(), strength: u.auroraStrength.value, direction: u.auroraDirection.value.toArray() } : null,
                counts: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs.length,
                  calls: renderer.info.render.calls, triangles: renderer.info.render.triangles } };
            }
            return result;
          };
        });
      } });
    });
    await setup(page, night * 360 + phase);
    const result = await page.evaluate(() => window.r2FirstFrame); results.push(result);
    await writeFile(info.outputPath(`${target}-first.png`), Buffer.from(result.image.split(',')[1], 'base64'));
  }
  expect(results[1].image).toBe(results[0].image); expect(results[1].counts).toEqual(results[0].counts);
  expect(results[1].ambient).toEqual(results[0].ambient); expect(results[1].light).toEqual({ color: [0, 0, 0], strength: 0, direction: [0, 0] });
  await writeFile(info.outputPath('first-frame.json'), JSON.stringify({ headSha: sources.pr.sha, phase, results: results.map(({ image, ...r }) => r) }, null, 2));
});

test('Sky-4R2 observed night4 direction matches every actual GPU bit after Float64 engine roundoff', async ({ page }, info) => {
  await page.setViewportSize({ width: 640, height: 400 }); const at = 4 * 360 + 225; await setup(page, at);
  const source = await readWorldLightSource(sources.pr.sha), state = source.createGameClock(undefined, { elapsedSeconds: at }).state;
  const sample = source.sampleAurora(state, 'CLEAR'), light = source.sampleAuroraLight(sample);
  const actual = await page.evaluate(() => window.lightingProbe.readWorldLight());
  expect(actual.water.light.strength).toBe(.14);
  expect(actual.water.light.direction.map(Math.fround)).toEqual(light.lightDirection.map(Math.fround));
  expect(actual.water.gpuLight.direction).toEqual(light.lightDirection.map(Math.fround));
  await writeFile(info.outputPath('direction-bits.json'), JSON.stringify({ headSha: sources.pr.sha, angle: sample.azimuth + .11,
    node: light.lightDirection, chromium: actual.water.light.direction, gpu: actual.water.gpuLight.direction, world: actual }, null, 2));
});
