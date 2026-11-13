import { test, expect } from './diagnostics-fixture.js';
import { writeFile } from 'node:fs/promises';
import { setup, tick, assertEnvironment } from './day-night-fixture.js';
import { prepareSceneryReference } from './lake-scenery-reference.js';
import { findAuroraNight } from '../helpers/aurora-event.js';
import { measureAuroraWorldLight } from '../helpers/aurora-world-light-pixels.js';
import { readMobileImplementation, mobileGit, assertMobileWorkingSource, mobileSourceMetadata } from '../../scripts/lib/mobile-comparison-source.js';
import { sampleDayNight } from '../../src/world/day-night.js';
import { createGameClock } from '../../src/game/game-clock.js';

const baseSha = '50bc6ebcca09e50b90c3a30c5dc8613255d85c6a', night = findAuroraNight({ forward: true }), seconds = night * 360 + 270;
let sources, reference;
test.beforeAll(async ({}, info) => {
  sources = { main: await readMobileImplementation(baseSha), pr: await readMobileImplementation(await mobileGit('rev-parse', 'HEAD')) };
  await assertMobileWorkingSource(sources.pr); reference = await prepareSceneryReference(info, baseSha);
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
