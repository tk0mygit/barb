import { test, expect } from './diagnostics-fixture.js';
import { writeFile } from 'node:fs/promises';
import { setup, tick } from './day-night-fixture.js';
import { prepareSceneryReference } from './lake-scenery-reference.js';
import { findAuroraNight } from '../helpers/aurora-event.js';
import { assertResourceCatalog } from './lighting-resource-contract.js';
import { SKY4_MOTION_BASE, readAuroraTransition } from '../../scripts/lib/sky4-motion-source.js';
import { readMobileImplementation, mobileGit, mobileSourceMetadata, assertMobileWorkingSource } from '../../scripts/lib/mobile-comparison-source.js';
import { readAuroraSource, auroraValues } from '../../scripts/lib/sky4-source.js';
import { auroraSnapshot } from '../helpers/aurora-snapshot.js';

let reference, sources, proof;
const seconds = findAuroraNight({ forward: true }) * 360 + 270;
test.beforeAll(async ({}, info) => {
  sources = { main: await readMobileImplementation(SKY4_MOTION_BASE), pr: await readMobileImplementation(await mobileGit('rev-parse', 'HEAD')) };
  await assertMobileWorkingSource(sources.pr);
  proof = await readAuroraTransition(sources.main, sources.pr);
  reference = await prepareSceneryReference(info, SKY4_MOTION_BASE);
});
test.afterAll(async ({}, info) => { await reference?.dispose(info); if (sources) await assertMobileWorkingSource(sources.pr); });

// Read-only diagnostic camera: clone the native settled pose once, then reuse
// it for all time samples. Production input, clock, visibility and animation
// keep running normally. ON/OFF/layer exclusions use the existing fixture.
async function observeFixedPose(page) {
  await page.addInitScript(() => {
    let devtools;
    Object.defineProperty(window, '__THREE_DEVTOOLS__', { configurable: true, get: () => devtools,
      set(value) {
        devtools = value;
        value.addEventListener('observe', ({ detail: renderer }) => {
          if (!renderer.isWebGLRenderer) return;
          const render = renderer.render;
          let latestScene, latestCamera;
          renderer.render = function(scene, camera) { latestScene = scene; latestCamera = camera; return render.apply(this, arguments); };
          window.freezeMotionPose = () => {
            const camera = latestCamera.clone(), scene = latestScene;
            window.motionPose = { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), aspect: camera.aspect };
            window.renderMotionPose = () => renderer.render(scene, camera);
          };
        });
      } });
  });
}

async function imageSample(page) {
  return page.evaluate(async () => {
    window.renderMotionPose();
    const pair = window.lightingProbe.captureAuroraPair();
    const decode = async url => {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return { pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
    };
    const off = await decode(pair.withoutAurora), on = await decode(pair.withAurora), layers = await Promise.all(pair.layers.map(decode));
    const contribution = a => {
      let distinct = 0, lower = 0, clipped = 0, moonChanged = 0, moonPixels = 0;
      const [mx, my, mz] = pair.moonScreen, moonX = (mx + 1) * off.width / 2, moonY = (1 - my) * off.height / 2;
      const values = new Int16Array(off.width * off.height * 3);
      for (let p = 0; p < off.width * off.height; p++) {
        const i = p * 4, y = Math.floor(p / off.width), x = p % off.width;
        let d = 0;
        for (let c = 0; c < 3; c++) { const v = a.pixels[i + c] - off.pixels[i + c]; values[p * 3 + c] = v; d = Math.max(d, Math.abs(v)); }
        if (d >= 4) distinct++;
        if (d && y >= off.height * .6) lower++;
        if (d && Math.max(...a.pixels.slice(i, i + 3)) >= 250) clipped++;
        if (mz > -1 && mz < 1 && Math.hypot(x - moonX, y - moonY) < off.height * .004 && off.pixels[i] > 170 && off.pixels[i + 1] > 170) {
          moonPixels++; if (d) moonChanged++;
        }
      }
      return { values, distinct, lower, clipped, moonChanged, moonPixels };
    };
    const current = contribution(on), individual = layers.map(contribution);
    window.firstMotionContribution ??= current.values;
    let changed = 0, energy = 0, maximum = 0;
    for (let p = 0; p < off.width * off.height; p++) {
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(current.values[p * 3 + c] - window.firstMotionContribution[p * 3 + c]));
      if (d >= 4) changed++; energy += d; maximum = Math.max(maximum, d);
    }
    const { values, ...stats } = current;
    return { pair, stats, layerStats: individual.map(({ values, ...stats }) => stats), motion: { changed, energy, maximum },
      snapshot: window.lightingProbe.auroraEvidence, gpu: window.lightingProbe.auroraGPU, draws: window.lightingProbe.auroraDraws,
      catalog: window.lightingProbe.resourceCatalog, counts: window.lightingProbe.performance, camera: window.motionPose };
  });
}

for (const viewport of [{ width: 1000, height: 700 }, { width: 390, height: 844, touch: true },
  { width: 844, height: 390, touch: true }, { width: 568, height: 320, touch: true }]) for (const mode of ['TPS', 'FPS']) {
  test(`aurora motion A/B ${mode} ${viewport.width}x${viewport.height} at 0/2/5/10 game seconds`, async ({ createContext }, info) => {
    const evidence = {}, figures = [];
    for (const target of ['main', 'pr']) {
      const context = await createContext({ ...(target === 'main' ? { baseURL: reference.baseURL } : {}), viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1, hasTouch: Boolean(viewport.touch), isMobile: Boolean(viewport.touch) });
      const page = await context.newPage(); await observeFixedPose(page); await setup(page, seconds);
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
        await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'ready');
      }
      await page.evaluate(() => window.freezeMotionPose());
      const samples = [], module = await readAuroraSource(sources[target].sha), factory = module.createAurora();
      try {
        for (const time of [0, 2, 5, 10]) {
          const previous = samples.at(-1)?.offset ?? 0;
          for (let t = previous; t < time; t += .25) await tick(page);
          const sample = await imageSample(page); assertResourceCatalog(sample);
          expect(sample.draws).toEqual([{ calls: 1, triangles: 1600 }, { calls: 1, triangles: 1600 }]);
          expect(sample.stats.distinct).toBeGreaterThan(100); expect(sample.stats.lower).toBe(0); expect(sample.stats.clipped).toBe(0); expect(sample.stats.moonChanged).toBe(0);
          for (const layer of sample.layerStats) expect(layer.distinct).toBeGreaterThan(50);
          expect(sample.gpu.programInstances).toBe(1);
          const absolute = seconds + ((sample.snapshot.layers[0].uniforms.auroraTime - seconds % 720 + 720) % 720);
          factory.update(module.createGameClock(undefined, { elapsedSeconds: absolute }).state, { x: 10, z: 20 }, 'CLEAR');
          expect(auroraValues(sample.snapshot)).toEqual(auroraValues(auroraSnapshot(factory.meshes)));
          sample.clockSeconds = absolute;
          if (samples.length) {
            expect(sample.gpu).toEqual(samples[0].gpu); expect(sample.snapshot.attributes).toEqual(samples[0].snapshot.attributes);
            expect(sample.camera).toEqual(samples[0].camera);
            expect(sample.snapshot.layers[0].uniforms.auroraTime - samples[0].snapshot.layers[0].uniforms.auroraTime).toBeCloseTo(time, 9);
          }
          for (const [name, url] of [['on', sample.pair.withAurora], ['off', sample.pair.withoutAurora], ...sample.pair.layers.map((url, i) => [`layer-${i}`, url])]) {
            const filename = `${target}-${time}s-${name}.png`, path = info.outputPath(filename);
            await writeFile(path, Buffer.from(url.split(',')[1], 'base64'));
            if (name === 'on' || name === 'off') figures.push({ target, time, name, filename });
          }
          delete sample.pair; samples.push({ offset: time, ...sample });
        }
      } finally { factory.dispose(); }
      evidence[target] = samples; await context.close();
    }
    for (let i = 0; i < 4; i++) {
      expect(evidence.pr[i].camera).toEqual(evidence.main[i].camera);
      expect(evidence.pr[i].clockSeconds).toBe(evidence.main[i].clockSeconds);
      expect(evidence.pr[i].counts).toEqual(evidence.main[i].counts);
    }
    // Temporal comparisons use isolated ON-OFF contribution within each build,
    // never a before/after same-clock pixel delta as a proxy for motion.
    expect(evidence.pr[3].motion.changed).toBeGreaterThan(100);
    expect(evidence.pr[3].motion.energy).toBeGreaterThan(evidence.main[3].motion.energy);
    const path = info.outputPath('motion-evidence.json');
    await writeFile(path, JSON.stringify({ proof, savedClockSeconds: seconds, viewport, mode,
      sources: Object.fromEntries(Object.entries(sources).map(([target, source]) => [target, mobileSourceMetadata(source)])), evidence }, null, 2));
    await info.attach('motion-evidence', { path, contentType: 'application/json' });
    const html = info.outputPath('motion-review.html');
    await writeFile(html, `<!doctype html><meta charset="utf-8"><title>Sky-4 motion A/B</title><style>body{background:#12212a;color:#eee;font:15px system-ui}.row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}img{width:100%}figure{margin:0}</style><h1>${mode} ${viewport.width}×${viewport.height}: same native initial pose, fixed diagnostic camera</h1><p>通常当選CLEAR夜・同じ保存時計。各段は各版内の実ゲーム時間0/2/5/10秒の静的連続画像。上下同じ列だけが同時刻A/B。OFF画像と個別レイヤー画像はPNG/JSONに保存。SwiftShader、実機FPSではありません。</p>${['main','pr'].map(target => `<h2>${target}</h2><div class="row">${figures.filter(f=>f.target===target&&f.name==='on').map(f=>`<figure><figcaption>+${f.time}s</figcaption><img src="${f.filename}"></figure>`).join('')}</div>`).join('')}`);
    await info.attach('motion-review', { path: html, contentType: 'text/html' });
  });
}

for (const elapsed of [90, findAuroraNight({ selected: false }) * 360 + 270,
  findAuroraNight({ fogType: 'FOG' }) * 360 + 270, findAuroraNight({ fogType: 'DENSE_FOG' }) * 360 + 270]) {
  test(`aurora motion inactive A/B has identical pixels and cold resources ${elapsed}`, async ({ createContext }, info) => {
    const captures = [];
    for (const target of ['main', 'pr']) {
      const context = await createContext({ ...(target === 'main' ? { baseURL: reference.baseURL } : {}), viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
      const page = await context.newPage(); await setup(page, elapsed);
      const capture = await page.evaluate(() => ({ image: window.lightingProbe.captureAuroraPair().withAurora,
        snapshot: window.lightingProbe.auroraEvidence, gpu: window.lightingProbe.auroraGPU,
        draws: window.lightingProbe.auroraDraws, counts: window.lightingProbe.performance, catalog: window.lightingProbe.resourceCatalog }));
      assertResourceCatalog(capture); expect(capture.gpu.programInstances).toBe(0);
      expect(Object.values(capture.gpu.buffers)).toEqual([null, null, null]);
      expect(capture.draws).toEqual([{ calls: 0, triangles: 0 }, { calls: 0, triangles: 0 }]);
      await writeFile(info.outputPath(`${target}-inactive.png`), Buffer.from(capture.image.split(',')[1], 'base64'));
      captures.push(capture); await context.close();
    }
    expect(captures[1].image).toBe(captures[0].image); expect(captures[1].counts).toEqual(captures[0].counts);
    const path = info.outputPath('inactive-evidence.json');
    await writeFile(path, JSON.stringify({ proof, elapsed, evidence: captures.map(({ image, ...capture }) => capture) }, null, 2));
    await info.attach('inactive-evidence', { path, contentType: 'application/json' });
  });
}
