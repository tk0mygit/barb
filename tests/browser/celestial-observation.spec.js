import { test, expect } from './diagnostics-fixture.js';
import { installPausedClock } from './clock-fixture.js';
import { createLightingSave } from '../helpers/lighting-save.js';
import { findAuroraNight } from '../helpers/aurora-event.js';
import { findMeteorEvent } from '../helpers/meteor-event.js';
import { writeFile } from 'node:fs/promises';

const night = findAuroraNight({ forward: true }), auroraTime = night * 360 + 270, meteor = findMeteorEvent();
const notice = page => page.locator('#achievement-notice');
const names = { aurora: 'レクイエム', meteor: '星に願いを' };
const latest = page => page.evaluate(() => ['barb.save.v1.slotA', 'barb.save.v1.slotB'].map(key => JSON.parse(localStorage.getItem(key)))
  .filter(Boolean).sort((a, b) => b.generation - a.generation)[0]);

// Passive real-draw evidence in the test context only. Seed a normal validated
// save clock/heading; never force winners, shaders, samples or player APIs.
async function boot(page, seconds, { heading = 0, skip = false } = {}) {
  const data = createLightingSave(seconds);
  await page.addInitScript(({ data, heading, skip }) => {
    if (!sessionStorage.getItem('sky5-seeded')) {
      localStorage.setItem('barb.save.v1.slotA', JSON.stringify({ storageVersion: 1, generation: 1, data: { ...data, boat: { ...data.boat, heading } } }));
      if (skip) localStorage.setItem('barb.play.preferences.v1', JSON.stringify({ version: 1, dayNightSkip: true }));
      sessionStorage.setItem('sky5-seeded', 'yes');
    }
    window.sky5Evidence = { frames: [] };
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', ({ detail: renderer }) => {
      if (!renderer.isWebGLRenderer) return;
      const render = renderer.render, direct = renderer.renderBufferDirect;
      let draws = null;
      renderer.renderBufferDirect = function(...args) {
        const before = renderer.info.render.calls, result = direct.apply(this, args), name = args[4]?.name;
        if (draws && (name?.startsWith('clear-night-aurora-') || name === 'clear-night-meteor')) draws[name] = (draws[name] ?? 0) + renderer.info.render.calls - before;
        return result;
      };
      renderer.render = function(scene, camera) {
        // Explicit negative tests: omit the actual render or fail it. These
        // controls exist only in the observer injected by this browser spec.
        if (window.sky5DropRender) return;
        if (window.sky5FailRender) throw Error('Sky5 test-only render failure');
        draws = {}; const result = render.call(this, scene, camera);
        const aurora = scene.getObjectByName('clear-night-aurora-0'), meteor = scene.getObjectByName('clear-night-meteor');
        window.sky5Evidence.frames.push({ now: performance.now(), draws, calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries,
          programs: renderer.info.programs.length, textures: renderer.info.memory.textures,
          auroraOpacity: aurora.material.uniforms.auroraOpacity.value,
          meteorOpacity: meteor.material.uniforms.meteorOpacity.value,
          opticalTime: aurora.material.uniforms.auroraTime.value, camera: camera.quaternion.toArray() });
        if (window.sky5Evidence.frames.length > 60) window.sky5Evidence.frames.shift();
        draws = null; return result;
      };
    });
  }, { data, heading, skip });
  await installPausedClock(page); await page.goto('./'); await page.clock.fastForward(250);
  await expect(page.locator('#status')).toBeHidden(); await expect(page.locator('#error')).toBeHidden();
  expect((await latest(page)).generation).toBe(1);
}

async function evidence(page, info, label) {
  const json = info.outputPath(`${label}.json`), png = info.outputPath(`${label}.png`);
  await writeFile(json, JSON.stringify({ saved: await latest(page), ...await page.evaluate(() => window.sky5Evidence) }, null, 2));
  await page.screenshot({ path: png });
  await info.attach(`${label}-draws`, { path: json, contentType: 'application/json' });
  await info.attach(label, { path: png, contentType: 'image/png' });
}

for (const profile of [
  { name: 'PC TPS', width: 1000, height: 700, touch: false },
  { name: 'touch portrait', width: 390, height: 844, touch: true },
  { name: 'touch landscape', width: 844, height: 390, touch: true },
]) for (const kind of ['aurora', 'meteor']) test(`${profile.name}: ${kind} real draws, minimum time, one notice and durable reload`, async ({ createContext }, info) => {
  const context = await createContext({ viewport: { width: profile.width, height: profile.height },
    hasTouch: profile.touch, isMobile: profile.touch, deviceScaleFactor: 1 });
  // This ordinary winner's head enters the TPS viewport at age ~0.4s. Restore
  // at +0.2s so the first ordinary +250ms frame already has a visible core.
  const page = await context.newPage(); await boot(page, kind === 'aurora' ? auroraTime : meteor.start + .2);
  const duration = kind === 'aurora' ? 500 : 100;
  await expect(notice(page)).toBeHidden();
  await page.clock.runFor(duration - 32); await expect(notice(page)).toBeHidden();
  await evidence(page, info, 'below-threshold');
  await page.clock.runFor(64); await expect(notice(page)).toContainText(names[kind]);
  const frames = await page.evaluate(() => window.sky5Evidence.frames);
  expect(frames.some(frame => Object.entries(frame.draws).some(([name, calls]) => name.includes(kind) && calls > 0))).toBe(true);
  await evidence(page, info, 'observed');
  expect(await notice(page).evaluate(node => getComputedStyle(node).pointerEvents)).toBe('none');
  await page.clock.fastForward(5000); await expect(notice(page)).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const checkpoint = await latest(page), id = `normal-${kind}-observed`;
  expect(checkpoint.data.achievements.contractVersion).toBe(6);
  expect(checkpoint.data.achievements.unlocked.filter(row => row.id === id)).toHaveLength(1);
  const date = checkpoint.data.achievements.unlocked.find(row => row.id === id).unlockedAt;
  await page.reload(); await page.clock.fastForward(250); await expect(notice(page)).toBeHidden();
  const click = locator => profile.touch ? locator.tap() : locator.click();
  await click(page.locator('#menu-button')); await click(page.locator('[data-view="achievements"]'));
  const card = page.locator(`[data-achievement-id="${id}"]`);
  await expect(page.locator('.achievement-card')).toHaveCount(19); await expect(card.locator('h3')).toHaveText(names[kind]);
  await expect(card.locator('time')).toHaveAttribute('datetime', date); await expect(card.locator('.achievement-progress')).toHaveText('天体観測：1 / 1（観測済み）');
});

for (const kind of ['aurora', 'meteor']) test(`PC FPS: ${kind} outside view then native READY look into view`, async ({ page }, info) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await boot(page, kind === 'aurora' ? auroraTime - 6.5 : meteor.start - 6.5, { heading: Math.PI });
  await page.locator('#fish-button').click(); for (let i = 0; i < 12; i++) await page.clock.fastForward(250);
  await expect(notice(page)).toBeHidden(); await evidence(page, info, 'outside-view');
  await page.mouse.move(100, 350); await page.mouse.down(); await page.mouse.move(100 + Math.PI / .004, 350);
  await page.clock.fastForward(250); await page.mouse.up();
  for (let i = 0; i < 12; i++) await page.clock.fastForward(250);
  await page.clock.runFor(750); await expect(notice(page)).toContainText(names[kind]);
  await evidence(page, info, 'native-look-observed');
});

for (const reason of ['menu', 'dialog', 'blur', 'hidden', 'pagehide', 'resize', 'no-submit']) test(`aurora: ${reason} breaks partial observation without banked time`, async ({ page }, info) => {
  await page.setViewportSize({ width: 1000, height: 700 }); await boot(page, auroraTime);
  await page.clock.runFor(400); await expect(notice(page)).toBeHidden();
  if (reason === 'menu') await page.locator('#menu-button').click();
  if (reason === 'dialog') await page.locator('#catch-dialog').evaluate(dialog => dialog.showModal());
  if (reason === 'blur' || reason === 'pagehide') await page.evaluate(reason => window.dispatchEvent(new Event(reason)), reason);
  if (reason === 'hidden') await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  if (reason === 'resize') await page.setViewportSize({ width: 1100, height: 750 });
  if (reason === 'no-submit') await page.evaluate(() => { window.sky5DropRender = true; });
  await page.clock.runFor(reason === 'resize' ? 400 : 1000); await expect(notice(page)).toBeHidden();
  await evidence(page, info, 'interrupted');
  if (reason === 'menu') await page.locator('#collection-close').click();
  if (reason === 'dialog') await page.locator('#catch-dialog').evaluate(dialog => dialog.close());
  if (reason === 'blur' || reason === 'pagehide') await page.evaluate(reason => window.dispatchEvent(new Event(reason === 'blur' ? 'focus' : 'pageshow')), reason);
  if (reason === 'hidden') await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  if (reason === 'no-submit') await page.evaluate(() => { window.sky5DropRender = false; });
  if (reason !== 'resize') { await page.clock.runFor(400); await expect(notice(page)).toBeHidden(); }
  await page.clock.runFor(200); await expect(notice(page)).toContainText('レクイエム');
});

test('SkyCheck ON excludes 18x frames; cancel and normal 1x recovery start a fresh observation', async ({ page }, info) => {
  await page.setViewportSize({ width: 1000, height: 700 }); await boot(page, auroraTime, { skip: true });
  await page.locator('#day-night-skip').click(); await page.clock.runFor(1000);
  await expect(page.locator('#app')).toHaveAttribute('data-time-skipping', 'true'); await expect(notice(page)).toBeHidden();
  await evidence(page, info, 'skip-excluded');
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await expect(page.locator('#app')).toHaveAttribute('data-time-skipping', 'false');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.clock.runFor(400); await expect(notice(page)).toBeHidden();
  await page.clock.runFor(200); await expect(notice(page)).toContainText('レクイエム');
});

for (const seconds of [90, findAuroraNight({ selected: false, fogType: 'CLEAR' }) * 360 + 270,
  findAuroraNight({ fogType: 'FOG' }) * 360 + 270, findAuroraNight({ fogType: 'DENSE_FOG' }) * 360 + 270]) {
  test(`day/fog/nonwinning clock ${seconds} cannot unlock celestial achievements`, async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 400 }); await boot(page, seconds);
    await page.clock.runFor(800); await expect(notice(page)).toBeHidden();
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    expect((await latest(page)).data.achievements.unlocked.filter(row => row.id.endsWith('-observed'))).toEqual([]);
  });
}

for (const reason of ['exception', 'context-loss']) test(`${reason}: failed renderer cannot complete a partial observation`, async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 400 }); await boot(page, auroraTime);
  await page.clock.runFor(400); await expect(notice(page)).toBeHidden();
  if (reason === 'exception') await page.evaluate(() => { window.sky5FailRender = true; });
  else await page.locator('#scene').evaluate(canvas => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  await page.clock.runFor(1000); await expect(page.locator('#error')).toContainText('ページを再読み込み');
  await expect(notice(page)).toBeHidden(); expect((await latest(page)).data.achievements.unlocked).toEqual([]);
});
