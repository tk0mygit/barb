import { test, expect } from './diagnostics-fixture.js';
import { installPausedClock } from './clock-fixture.js';
import { armEncounter, verifyEncounterBite } from './encounter-fixture.js';
import { succeedMousePublicQte } from './input-fixture.js';
import { installAudioProbe } from './audio-fixture.js';

// Real built application, native inputs and the production probability interval.
// No fixture exposes or assigns a game state, encounter, catch or encyclopedia.
test.use({ viewport: { width: 800, height: 600 }, deviceScaleFactor: .5 });
const phase = page => page.locator('#fishing-panel').getAttribute('data-phase');
const metricDelta = (before, after) => Object.fromEntries(
  ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount']
    .map(name => [name, (after[name] ?? 0) - (before[name] ?? 0)]));

for (const speciesId of ['black-bass', 'northern-pike']) {
  test(`built ${speciesId}: native cast → draw → hook → FIGHT/QTE → LANDING → RESULT, discovery and shared audio`, async ({ page }, info) => {
    const requests = [], errors = [];
    page.on('request', request => requests.push(request.url()));
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(installAudioProbe, { native: true });
    await page.addInitScript(() => {
      Math.random = () => window.testRandomDraws?.length ? window.testRandomDraws.shift() : window.testRandomValue ?? .1;
      window.discoveryRendering = { frames: 0, losses: 0, starts: [], last: null };
      document.addEventListener('webglcontextlost', () => window.discoveryRendering.losses++, true);
      window.__THREE_DEVTOOLS__ = new EventTarget();
      window.__THREE_DEVTOOLS__.addEventListener('observe', ({ detail: renderer }) => {
        if (!renderer.isWebGLRenderer) return;
        const render = renderer.render;
        renderer.render = function(scene, camera) {
          const value = render.call(this, scene, camera);
          const gl = this.getContext(), extension = gl.getExtension('WEBGL_debug_renderer_info');
          window.discoveryRendering.frames++;
          window.discoveryRendering.last = { calls: this.info.render.calls, triangles: this.info.render.triangles,
            geometries: this.info.memory.geometries, textures: this.info.memory.textures,
            programs: this.info.programs.length, renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
          return value;
        };
      });
      document.addEventListener('DOMContentLoaded', () => {
        new MutationObserver(records => {
          for (const record of records) for (const node of record.addedNodes) if (node.classList?.contains('species-discovery')) {
            window.discoveryRendering.starts.push({ at: performance.now(), catchId: node.dataset.catchId,
              awardHidden: document.querySelector('#achievement-notice').hidden,
              phase: document.querySelector('#fishing-panel').dataset.phase });
          }
        }).observe(document.querySelector('#catch-dialog'), { subtree: true, childList: true });
      });
    });
    await installPausedClock(page); await page.goto('./'); await page.clock.fastForward(250);
    await expect(page.locator('#status')).toBeHidden(); await expect(page.locator('#error')).toBeHidden();
    await expect(page.locator('.species-discovery')).toHaveCount(0);
    await page.locator('#fish-button').click(); await page.clock.fastForward(250);
    await page.locator('#cast-button').click(); await page.clock.fastForward(250);
    expect(await phase(page)).toBe('aim');
    await page.mouse.move(400, 360); await page.mouse.down(); await page.mouse.move(400, 210);
    await page.clock.fastForward(250); // Present the real AIM preview before release.
    await page.mouse.up(); await page.clock.fastForward(250);
    for (let n = 0; n < 8 && await phase(page) === 'cast'; n++) await page.clock.fastForward(250);
    expect(await phase(page)).toBe('lure');
    const plan = await armEncounter(page, { speciesId, lengthRoll: .5, rodLevel: 1 });
    for (let n = 0; n < 24 && await phase(page) === 'lure'; n++) await page.clock.fastForward(250);
    await verifyEncounterBite(page, plan);
    await page.mouse.click(400, 360); await page.clock.fastForward(16); expect(await phase(page)).toBe('fight');
    let held = false, successes = 0;
    for (let n = 0; n < 140 && await phase(page) === 'fight'; n++) {
      if (await succeedMousePublicQte(page)) { held = false; successes++; continue; }
      const tension = await page.locator('#line-tension').evaluate(meter => meter.value);
      if (!held && tension < .35) { await page.mouse.move(400, 360); await page.mouse.down(); held = true; }
      else if (held && tension > .65) { await page.mouse.up(); held = false; }
      await page.clock.fastForward(250);
    }
    if (held) await page.mouse.up();
    expect(await phase(page)).toBe('landing'); expect(successes).toBeGreaterThan(0);
    for (let n = 0; n < 12 && await phase(page) === 'landing'; n++) await page.clock.fastForward(100);
    expect(await phase(page)).toBe('result');
    const root = page.locator('.species-discovery'), rare = speciesId === 'northern-pike';
    await expect(root).toBeVisible(); await expect(root.locator('.discovery-label')).toHaveText(rare ? '希少種発見' : '新種発見');
    await expect(page.locator('#catch-species')).toHaveText(plan.name);
    await expect(page.locator('#catch-qte-bonus')).toContainText(`QTE成功${successes}回`);
    await expect(page.locator('#achievement-notice')).toBeHidden();
    const audio = await page.evaluate(() => ({ contexts: audioProbe.contexts.length,
      ready: audioProbe.contexts[0]?.state,
      oscillators: audioProbe.nodes.filter(node => node.audioProbeType === 'oscillator').map(source => ({
        type: source.type, started: source.started, start: source.startWhen,
      })),
      ambientLoops: audioProbe.nodes.filter(node => node.audioProbeType === 'source' && node.loop && node.started).length }));
    expect(audio.contexts).toBe(1); expect(audio.ready).toBe('running');
    expect(audio.oscillators.length).toBe(rare ? 1 : 0);
    expect(audio.ambientLoops).toBe(0);
    if (rare) {
      expect(audio.oscillators[0].type).toBe('sine'); expect(audio.oscillators[0].started).toBe(true);
    }
    const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
    const snapshot = () => page.evaluate(() => ({ ...window.discoveryRendering,
      dom: document.querySelectorAll('*').length,
      overlayDOM: document.querySelector('.species-discovery')?.querySelectorAll('*').length + 1 || 0,
      animations: document.getAnimations().length }));
    const during = await snapshot(), duringRequests = requests.length, beforeMetrics = await metrics();
    expect(during.starts).toHaveLength(1); expect(during.starts[0].awardHidden).toBe(true);
    expect(during.starts[0].phase).toBe('result');
    const age = await page.evaluate(() => performance.now() - window.discoveryRendering.starts[0].at);
    let elapsed = age;
    for (const time of [600, 1500, 2500]) {
      await page.clock.fastForward(Math.max(0, time - elapsed)); elapsed = time;
      await root.evaluate((node, time) => {
        for (const animation of node.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = time; }
      }, time);
      await page.screenshot({ path: info.outputPath(`discovery-${time}ms.png`) });
      await expect(page.locator('#achievement-notice')).toBeHidden();
    }
    await page.clock.fastForward(500); await expect(root).toHaveCount(0);
    const afterMetrics = await metrics(), after = await snapshot();
    expect(after.last).toEqual(during.last); expect(after.losses).toBe(0);
    expect(requests.slice(duringRequests)).toEqual([]);
    expect(during.overlayDOM).toBeLessThanOrEqual(18); expect(after.overlayDOM).toBe(0);
    // The achievement region adds its two existing child elements on release.
    expect(during.dom - after.dom).toBe(during.overlayDOM - 2);
    const normalBefore = await metrics(); await page.clock.runFor(600); const normalAfter = await metrics();
    const normal = await snapshot(); expect(normal.last).toEqual(after.last);
    await info.attach('discovery-performance', { body: JSON.stringify({ plan, successes, audio, during, after, normal,
      overlayInterval: metricDelta(beforeMetrics, afterMetrics), normalResult600ms: metricDelta(normalBefore, normalAfter),
      extraRequests: requests.slice(duringRequests), limits: 'SwiftShader desktop at DPR .5; CDP browser task/layout time, not GPU memory or physical Android timing. Intervals differ; no FPS equivalence claimed.' }, null, 2), contentType: 'application/json' });
    await page.locator('#close-catch').click();
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    const saved = await page.evaluate(() => ['barb.save.v1.slotA', 'barb.save.v1.slotB'].map(key => localStorage.getItem(key))
      .filter(Boolean).map(JSON.parse).sort((a, b) => b.generation - a.generation)[0].data);
    expect(saved.collection.catches).toHaveLength(1);
    expect(saved.collection.catches[0]).toMatchObject({ speciesId, disposition: 'stored', qteSuccessCount: successes });
    expect(saved).not.toHaveProperty('discoveries');
    await page.reload(); await page.clock.fastForward(250);
    await expect(page.locator('.species-discovery')).toHaveCount(0); await expect(page.locator('#achievement-notice')).toBeHidden();
    await page.locator('#menu-button').click(); await page.locator('[data-view="encyclopedia"]').click();
    await expect(page.locator('.collection-summary')).toHaveText('発見 1 / 36 種');
    expect(errors).toEqual([]);
  });
}
