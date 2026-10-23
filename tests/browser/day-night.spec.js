import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createCatchCollection } from '../../src/game/catch-collection.js';
import { createAchievements } from '../../src/game/achievements.js';
import { createBoatState } from '../../src/game/boat.js';
import { createGameClock } from '../../src/game/game-clock.js';
import { createSaveData } from '../../src/game/save-data.js';
import { sampleDayNight } from '../../src/world/day-night.js';

test.use({ deviceScaleFactor: 0.5 });
const now = new Date('2026-10-23T00:00:00Z');
const tick = page => page.clock.fastForward(250);
const read = page => page.evaluate(() => window.lightingProbe.last);

async function observeControls(page) {
  await page.evaluate(() => {
    window.controlProbe = { events: [], actions: [] };
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click']) {
      window.addEventListener(type, event => {
        const record = {
          type, target: event.target.closest('button')?.id ?? event.target.id,
          x: event.clientX ?? event.changedTouches?.[0]?.clientX, y: event.clientY ?? event.changedTouches?.[0]?.clientY, trusted: event.isTrusted,
          mode: document.body.classList.contains('fishing') ? 'fishing' : 'sailing',
        };
        window.controlProbe.events.push(record);
        queueMicrotask(() => { record.prevented = event.defaultPrevented; });
      }, true);
    }
  });
}

async function activateControl(page, id, touch) {
  const button = page.locator(`#${id}`);
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  const before = await button.evaluate(button => {
    const bounds = button.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    const snapshot = { id: button.id, hidden: button.hidden, disabled: button.disabled, bounds: bounds.toJSON(),
      hit: hit?.closest('button')?.id ?? hit?.id, boatSpeed: window.lightingProbe.last.boatSpeed,
      motion: document.querySelector('#motion-label').textContent, eventCount: window.controlProbe.events.length };
    window.controlProbe.actions.push(snapshot);
    return snapshot;
  });
  expect(before.hit).toBe(id);
  // Keep Playwright's stability/receives-events checks and send one input only.
  if (touch) await button.tap();
  else await button.click();
  await page.evaluate(start => {
    window.controlProbe.actions.at(-1).eventsAfterInput = window.controlProbe.events.slice(start);
  }, before.eventCount);
  // Never retry input or infer activation from a completed protocol command.
  await expect.poll(() => page.evaluate(start => window.controlProbe.events.slice(start)
    .filter(event => event.type === 'click').map(event => ({ target: event.target, trusted: event.trusted })), before.eventCount))
    .toEqual([{ target: id, trusted: true }]);
  const events = await page.evaluate(start => window.controlProbe.events.slice(start), before.eventCount);
  expect(events.filter(event => event.type === 'pointerdown').map(event => event.target)).toEqual([id]);
}

async function setup(page, elapsedSeconds, { freeze = true } = {}) {
  const collection = createCatchCollection();
  const data = createSaveData({ collection, achievements: createAchievements({ collection }),
    boat: createBoatState({ x: 10, z: 20, heading: 0 }),
    clock: createGameClock(undefined, { elapsedSeconds }) });
  // Observe the actual production renderer via Three.js's existing devtools
  // event. No production debug API, source rewrite or forced game state.
  await page.addInitScript(data => {
    if (!sessionStorage.getItem('lighting-seeded')) {
      localStorage.setItem('barb.save.v1.slotA', JSON.stringify({ storageVersion: 1, generation: 1, data }));
      sessionStorage.setItem('lighting-seeded', 'yes');
    }
    Math.random = () => 0.5;
    window.lightingProbe = { first: null, last: null, renders: 0 };
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', ({ detail: renderer }) => {
      if (!renderer.isWebGLRenderer) return;
      const render = renderer.render;
      renderer.render = function(scene, camera) {
        const ambient = scene.children.find(o => o.isHemisphereLight);
        const [sun, moonlight] = scene.children.filter(o => o.isDirectionalLight);
        const sky = scene.children.find(o => o.isSky), moon = scene.getObjectByName('moon');
        const water = scene.getObjectByName('lake-water').material.uniforms;
        const snapshot = {
          ambient: ambient.intensity, sun: sun.intensity, moon: moonlight.intensity,
          sky: sky.material.uniforms.skyDaylight.value, fog: scene.fog.color.toArray(),
          deep: water.deepColor.value.toArray(), reflection: water.reflectionColor.value.toArray(),
          sunDirection: water.sunDirection.value.toArray(), moonDirection: water.moonDirection.value.toArray(),
          sunHighlight: water.sunHighlight.value, moonHighlight: water.moonHighlight.value,
          moonOpacity: moon.material.opacity, moonVisible: moon.visible,
          waterTime: water.time.value, boat: water.boatPosition.value.toArray(), boatSpeed: water.boatSpeed.value,
          shadows: scene.children.filter(o => o.isLight && o.castShadow).length,
        };
        const result = render.call(this, scene, camera);
        const probe = window.lightingProbe;
        probe.first ??= snapshot; probe.last = snapshot; probe.renders++;
        probe.camera = camera.quaternion.toArray();
        probe.cameraHeight = camera.position.y;
        probe.moonScreen = moon.position.clone().project(camera).toArray();
        probe.performance = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
          programs: renderer.info.programs.length };
        return result;
      };
    });
  }, data);
  if (freeze) {
    await page.clock.install({ time: now });
    await page.clock.pauseAt(new Date(+now + 1000));
  }
  await page.goto('./');
  if (freeze) await tick(page);
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#error')).toBeHidden();
}

function assertEnvironment(actual, elapsedSeconds) {
  const clock = createGameClock(undefined, { elapsedSeconds }).state;
  const expected = sampleDayNight(clock);
  for (const [field, parameter] of Object.entries({ ambient: 'ambientIntensity', sun: 'sunIntensity', moon: 'moonIntensity',
    sky: 'skyDaylight', fog: 'horizon', deep: 'waterDeep', reflection: 'waterReflection', sunDirection: 'sunDirection',
    moonDirection: 'moonDirection', sunHighlight: 'sunHighlight', moonHighlight: 'moonHighlight', moonOpacity: 'moonOpacity' })) {
    if (Array.isArray(expected[parameter])) expected[parameter].forEach((v, i) => expect(actual[field][i]).toBeCloseTo(v, 7));
    else expect(actual[field]).toBeCloseTo(expected[parameter], 7);
  }
  expect(actual.shadows).toBe(1);
}

for (const [seconds, label] of [[0, 'sunrise'], [90, 'day'], [175, 'dusk'], [180, 'night-boundary'],
  [270, 'night'], [350, 'morning'], [360, 'cycle-boundary'], [36270, 'later-night']]) {
  test(`saved ${label}: the very first production render uses ${seconds}s lighting`, async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setViewportSize({ width: 1000, height: 700 });
    await setup(page, seconds);
    const first = await page.evaluate(() => window.lightingProbe.first);
    assertEnvironment(first, seconds);
    expect(first.waterTime).toBe(0); expect(first.boat).toEqual([10, 20]);
    if (['day', 'dusk', 'night', 'morning'].includes(label)) {
      const path = testInfo.outputPath(`${label}.png`);
      await page.screenshot({ path });
      await testInfo.attach(label, { path, contentType: 'image/png' });
      const counts = testInfo.outputPath('render-counts.json');
      await writeFile(counts, JSON.stringify(await page.evaluate(() => window.lightingProbe.performance), null, 2));
      await testInfo.attach('render-counts', { path: counts, contentType: 'application/json' });
    }
    expect(errors).toEqual([]);
  });
}

test('lighting crosses both clock boundaries, handles long frames and freezes with menu/focus/visibility', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await setup(page, 178);
  await page.locator('#fish-button').click({ force: true }); await tick(page);
  const display = page.locator('#fishing-conditions');
  const seconds = async () => Number(await display.getAttribute('data-cycle-progress')) * 360;
  const advanceTo = async target => page.clock.fastForward(Math.round((target - await seconds()) * 1000));
  for (const [boundary, beforePhase, afterPhase] of [[180, 'day', 'night'], [360, 'night', 'day']]) {
    await advanceTo(boundary - 0.05);
    await expect(display).toHaveAttribute('data-time-of-day', beforePhase);
    const before = await read(page);
    await page.clock.fastForward(100);
    await expect(display).toHaveAttribute('data-time-of-day', afterPhase);
    const after = await read(page);
    assertEnvironment(after, await seconds());
    for (const key of ['ambient', 'sun', 'moon', 'sky']) expect(Math.abs(before[key] - after[key])).toBeLessThan(0.01);
    for (const key of ['fog', 'deep', 'sunDirection']) before[key].forEach((v, i) => expect(Math.abs(v - after[key][i])).toBeLessThan(0.01));
  }
  await page.clock.fastForward(360000 * 20 + 270000);
  assertEnvironment(await read(page), await seconds());
  expect((await read(page)).waterTime).toBeLessThan(3); // simulation keeps its existing dt cap
  for (const reason of ['menu', 'blur', 'hidden']) {
    if (reason === 'menu') await page.locator('#menu-button').click({ force: true });
    else await page.evaluate(reason => {
      if (reason === 'blur') window.dispatchEvent(new Event('blur'));
      else { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
    }, reason);
    const before = await read(page), clockBefore = await seconds();
    const renders = await page.evaluate(() => window.lightingProbe.renders);
    await page.clock.fastForward(600000);
    expect(await read(page)).toEqual(before);
    expect(await seconds()).toBe(clockBefore);
    expect(await page.evaluate(() => window.lightingProbe.renders)).toBe(renders);
    // resize() can render while paused; it must retain the same night scene.
    await page.setViewportSize({ width: 600, height: 800 });
    expect(await read(page)).toEqual(before);
    if (reason === 'menu') await page.locator('#collection-close').click({ force: true });
    else await page.evaluate(reason => {
      if (reason === 'blur') window.dispatchEvent(new Event('focus'));
      else { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }
    }, reason);
    await tick(page);
    expect(await seconds() - clockBefore).toBeCloseTo(0.25, 2);
    assertEnvironment(await read(page), await seconds());
  }
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const saved = await page.evaluate(() => ['barb.save.v1.slotA', 'barb.save.v1.slotB'].map(k => JSON.parse(localStorage.getItem(k))).filter(Boolean).sort((a, b) => b.generation - a.generation)[0].data);
  expect(saved.saveVersion).toBe(1); expect(saved.settings).toEqual({});
  expect(saved.collection.catches).toEqual([]); expect(saved.achievements.unlocked).toEqual([]);
  await page.reload(); await tick(page);
  assertEnvironment(await page.evaluate(() => window.lightingProbe.first), saved.clock.elapsedSeconds);
});

for (const viewport of [{ width: 1000, height: 700, touch: false }, { width: 320, height: 568, touch: true },
  { width: 568, height: 320, touch: true }]) {
  test(`night sailing, FPS look and cast with ${viewport.touch ? 'touch' : 'mouse'} at ${viewport.width}x${viewport.height}`, async ({ browser }, testInfo) => {
    const { touch, width, height } = viewport;
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 0.5 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Boundary tests freeze rAF; operation regressions use the real timeline.
    // Do not compress seconds between native gestures with a mocked JS clock.
    await setup(page, 270, { freeze: false });
    await observeControls(page);
    try {
      // Landscape controls occupy the right half; start gestures on clear canvas.
      const cdp = await context.newCDPSession(page), x = width * (width > height && touch ? 0.35 : 0.6), y = height * 0.55;
      const down = async () => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }) : (await page.mouse.move(x, y), page.mouse.down());
      const move = (dy, dx = 0) => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy }] }) : page.mouse.move(x + dx, y + dy);
      const up = () => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) : page.mouse.up();
      const initial = await read(page);
      await down(); await move(-80);
      await expect(page.locator('#motion-label')).toHaveText('航行中');
      await expect.poll(async () => (await read(page)).boatSpeed).toBeGreaterThan(2);
      await up();
      await expect(page.locator('#motion-label')).toHaveText('停船中');
      expect((await read(page)).boatSpeed).toBe(0);
      await expect(page.locator('#joystick')).toBeHidden();
      expect((await read(page)).boat).not.toEqual(initial.boat);
      await activateControl(page, 'fish-button', touch);
      await expect(page.locator('#motion-label')).toHaveText('釣り視点');
      await expect(page.locator('body')).toHaveClass('fishing');
      await expect(page.locator('#reticle')).toBeVisible();
      await expect(page.locator('#fish-button')).toBeHidden();
      await expect(page.locator('#fish-button')).toBeDisabled();
      await expect(page.locator('#fishing-panel')).toBeVisible();
      await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'ready');
      await expect(page.locator('#fishing-conditions')).toHaveAttribute('data-time-of-day', 'night');
      await expect.poll(() => page.evaluate(() => window.lightingProbe.cameraHeight)).toBeCloseTo(2.15, 1);
      const cameraBefore = await page.evaluate(() => window.lightingProbe.camera);
      expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y).id, [x, y])).toBe('scene');
      await down(); await move(-60, 100); await up();
      await expect.poll(() => page.evaluate(() => window.lightingProbe.camera)).not.toEqual(cameraBefore);
      for (const id of ['menu-button', 'cast-button', 'return-button']) {
        const bounds = await page.locator(`#${id}`).boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width); expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
      }
      const path = testInfo.outputPath('moon-fishing.png');
      await expect.poll(() => page.evaluate(() => window.lightingProbe.moonScreen.slice(0, 2).every(v => Math.abs(v) < 1))).toBe(true);
      const moonScreen = await page.evaluate(() => window.lightingProbe.moonScreen);
      expect(Math.abs(moonScreen[0])).toBeLessThan(1); expect(Math.abs(moonScreen[1])).toBeLessThan(1);
      await page.screenshot({ path }); await testInfo.attach('moon-fishing', { path, contentType: 'image/png' });
      const memoryBefore = await page.evaluate(() => window.lightingProbe.performance);
      await activateControl(page, 'cast-button', touch);
      await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'aim');
      expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y).id, [x, y])).toBe('scene');
      await down(); await move(-120); await up();
      await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'lure');
      await down();
      await expect(page.locator('#reel-state')).toHaveText('巻き取り中');
      await up();
      await expect(page.locator('#reel-state')).toHaveText('待機中');
      const { lighting, cycleProgress } = await page.evaluate(() => ({ lighting: window.lightingProbe.last,
        cycleProgress: Number(document.querySelector('#fishing-conditions').dataset.cycleProgress) }));
      assertEnvironment(lighting, cycleProgress * 360);
      const performance = await page.evaluate(() => window.lightingProbe.performance);
      expect(performance.geometries).toBeLessThanOrEqual(memoryBefore.geometries + 1);
      expect(performance.calls).toBeLessThan(40);
      const counts = testInfo.outputPath('render-counts.json');
      await writeFile(counts, JSON.stringify({ beforeCast: memoryBefore, duringLure: performance }, null, 2));
      await testInfo.attach('render-counts', { path: counts, contentType: 'application/json' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      const controlsPath = testInfo.outputPath('control-events.json');
      await writeFile(controlsPath, JSON.stringify(await page.evaluate(() => ({
        ...window.controlProbe, lighting: window.lightingProbe.last,
        motion: document.querySelector('#motion-label').textContent,
        reticleHidden: document.querySelector('#reticle').hidden,
        fishingPhase: document.querySelector('#fishing-panel').dataset.phase,
      })), null, 2));
      await testInfo.attach('control-events', { path: controlsPath, contentType: 'application/json' });
      await context.close();
    }
  });
}
