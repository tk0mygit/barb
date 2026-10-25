import { test, expect } from './diagnostics-fixture.js';
import { writeFile } from 'node:fs/promises';
import { installPausedClock } from './clock-fixture.js';
import { activateButton } from './input-fixture.js';
import { createCatchCollection } from '../../src/game/catch-collection.js';
import { createAchievements } from '../../src/game/achievements.js';
import { createBoatState } from '../../src/game/boat.js';
import { createGameClock } from '../../src/game/game-clock.js';
import { createSaveData } from '../../src/game/save-data.js';
import { shoreRadius } from '../../src/world/config.js';

const profiles = [
  { id: 'pc', width: 1000, height: 700, touch: false },
  { id: 'portrait', width: 390, height: 844, touch: true },
  { id: 'landscape', width: 844, height: 390, touch: true },
  { id: 'small', width: 320, height: 568, touch: true },
];
const tick = page => page.clock.fastForward(250);
const panel = page => page.locator('#fishing-panel');
const read = page => page.evaluate(() => window.castProbe);
const separated = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;

function savedSession(rodLevel, boatPosition = { x: 0, z: 30, heading: 0 }) {
  const collection = createCatchCollection({ initialData: { catches: [], wallet: { balance: 0, lifetimeSales: 0 }, equipment: { rodLevel, reelLevel: 1 } } });
  return createSaveData({ collection, achievements: createAchievements({ collection }), boat: createBoatState(boatPosition),
    clock: createGameClock(undefined, { elapsedSeconds: 90 }) });
}

async function setup(createContext, profile, rodLevel = 1, boatPosition, randomValue = 0) {
  const context = await createContext({ viewport: { width: profile.width, height: profile.height },
    hasTouch: profile.touch, isMobile: profile.touch, deviceScaleFactor: 0.5 });
  const page = await context.newPage();
  // Save seeding is an initial condition. All preparation, aim, casts and phase
  // changes below use the production application and native pointer events.
  await page.addInitScript(({ data, randomValue }) => {
    localStorage.setItem('barb.save.v1.slotA', JSON.stringify({ storageVersion: 1, generation: 1, data }));
    Math.random = () => randomValue;
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', ({ detail: renderer }) => {
      if (!renderer.isWebGLRenderer) return;
      const render = renderer.render;
      renderer.render = function(scene, camera) {
        const result = render.call(this, scene, camera);
        let ring, lure;
        scene.traverse(object => {
          if (object.geometry?.type === 'RingGeometry' && object.geometry.parameters.outerRadius === 0.7) ring = object;
          if (object.geometry?.type === 'SphereGeometry' && object.geometry.parameters.radius === 0.13) lure = object;
        });
        const visible = object => object && object.visible && (!object.parent || visible(object.parent));
        const project = vector => {
          const ndc = vector.clone().project(camera);
          return { ndc: ndc.toArray(), x: (ndc.x + 1) * innerWidth / 2, y: (1 - ndc.y) * innerHeight / 2 };
        };
        const mesh = object => {
          if (!object) return null;
          const position = object.geometry.attributes.position, points = [];
          for (let i = 0; i < position.count; i++) {
            points.push(project(object.localToWorld(object.position.clone().set(position.getX(i), position.getY(i), position.getZ(i)))));
          }
          return { visible: Boolean(visible(object)), world: object.position.toArray(), scale: object.scale.toArray(),
            center: project(object.getWorldPosition(object.position.clone())),
            bounds: { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
              top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) },
            depth: { min: Math.min(...points.map(p => p.ndc[2])), max: Math.max(...points.map(p => p.ndc[2])) } };
        };
        const direction = camera.getWorldDirection(camera.position.clone());
        const obstacles = [...document.querySelectorAll('.masthead, .action-panel, .telemetry, .edition, #fishing-panel, #spot-status, .compass, #sale-notice, #achievement-notice')]
          .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
          .map(element => ({ id: element.id || element.className, ...element.getBoundingClientRect().toJSON() }));
        window.castProbe = { phase: document.querySelector('#fishing-panel').dataset.phase,
          viewport: { width: innerWidth, height: innerHeight },
          camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(),
            pitch: Math.asin(direction.y), heading: Math.atan2(direction.x, -direction.z), aspect: camera.aspect, fov: camera.fov },
          ring: mesh(ring), lure: mesh(lure), obstacles };
        return result;
      };
    });
  }, { data: savedSession(rodLevel, boatPosition), randomValue });
  await installPausedClock(page);
  await page.goto('./'); await tick(page);
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#error')).toBeHidden();
  const click = selector => activateButton(page.locator(selector), profile.touch);
  const cdp = await context.newCDPSession(page);
  let touchActive = false;
  const input = {
    async down(x, y) {
      if (profile.touch) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); touchActive = true; }
      else { await page.mouse.move(x, y); await page.mouse.down(); }
    },
    async move(x, y) {
      if (profile.touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
      else await page.mouse.move(x, y);
    },
    async up() {
      if (profile.touch) {
        if (!touchActive) return;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); touchActive = false;
      }
      else await page.mouse.up();
    },
    async cancel() {
      if (profile.touch) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); touchActive = false;
        // CDP can acknowledge cancellation before Chromium dispatches it.
        // Wait for the native capture release before advancing the paused rAF.
        await expect.poll(() => page.locator('#scene').evaluate(canvas => {
          const id = window.e2eDiagnostics.events.findLast(event => event.type === 'pointerdown' && event.target === 'scene')?.pointerId;
          return id === undefined || !canvas.hasPointerCapture(id);
        })).toBe(true);
      }
      else await page.locator('#scene').evaluate(canvas => canvas.releasePointerCapture(1));
    },
  };
  await click('#fish-button'); await tick(page);
  await expect(panel(page)).toHaveAttribute('data-phase', 'ready');
  return { context, page, click, input };
}

function assertSafe(snapshot, { lure = false } = {}) {
  const objects = [snapshot.ring, ...(lure ? [snapshot.lure] : [])];
  for (const object of objects) {
    expect(object.visible).toBe(true);
    const b = object.bounds, size = snapshot.viewport;
    // Projection is evaluated in CSS pixels, independently of the backbuffer.
    expect(b.left).toBeGreaterThanOrEqual(12 - 1e-4);
    expect(b.right).toBeLessThanOrEqual(size.width - 12 + 1e-4);
    expect(b.top).toBeGreaterThanOrEqual(12 - 1e-4);
    expect(b.bottom).toBeLessThanOrEqual(size.height - 12 + 1e-4);
    expect(object.depth.min).toBeGreaterThan(-1);
    expect(object.depth.max).toBeLessThan(1);
    for (const obstacle of snapshot.obstacles) expect(separated(b, obstacle), `overlap with ${obstacle.id}`).toBe(true);
  }
}

async function aim(page, click, input, direction, distance, profile) {
  await click('#cast-button'); await tick(page);
  await expect(panel(page)).toHaveAttribute('data-phase', 'aim');
  const width = page.viewportSize().width, height = page.viewportSize().height;
  const x = direction < 0 ? width - 90 : direction > 0 ? 90 : width / 2, y = height * 0.48;
  await input.down(x, y);
  // Commit pending capture even for the zero-length 8m cast, so cancellation
  // exercises the native lost-capture path on mouse as well as touch.
  await input.move(x + 1, y);
  await input.move(distance > 8 ? x + direction * 181 : x, distance > 8 ? y - (direction ? 0 : 181) : y);
  await tick(page);
  await expect(page.locator('#line-distance')).toHaveText(`着水予測 ${distance.toFixed(1)} m`);
  const snapshot = await read(page);
  expect(Math.abs(snapshot.camera.pitch)).toBeLessThanOrEqual(1e-3);
  assertSafe(snapshot);
  return snapshot;
}

async function save(page, info, id, snapshot) {
  const jsonPath = info.outputPath(`${id}-projection.json`);
  await writeFile(jsonPath, JSON.stringify(snapshot, null, 2));
  await info.attach(`${id}-projection`, { path: jsonPath, contentType: 'application/json' });
  const path = info.outputPath(`${id}.png`);
  await page.screenshot({ path });
  await info.attach(id, { path, contentType: 'image/png' });
}

async function castAndReturn(page, input, prediction, info, id) {
  await input.up();
  const flight = [];
  for (let i = 0; i < 8; i++) {
    await page.clock.fastForward(100);
    flight.push(await read(page));
  }
  // One further dt cap covers substep rounding around the 0.8-second boundary.
  if (await panel(page).getAttribute('data-phase') === 'cast') await page.clock.fastForward(100);
  await expect(panel(page)).toHaveAttribute('data-phase', 'lure');
  const landing = await read(page);
  assertSafe(landing, { lure: true });
  expect(Math.abs(landing.ring.world[0] - prediction.ring.world[0])).toBeLessThanOrEqual(1e-6);
  expect(Math.abs(landing.ring.world[2] - prediction.ring.world[2])).toBeLessThanOrEqual(1e-6);
  expect(landing.camera.position).toEqual(prediction.camera.position);
  expect(landing.camera.quaternion).toEqual(prediction.camera.quaternion);
  // Late flight must be visible. Earlier rod-tip/apex excursions are recorded
  // and permitted, while the majority of flight must show the actual lure.
  const inView = s => s.lure.visible && s.lure.depth.min > -1 && s.lure.bounds.left >= 0 && s.lure.bounds.right <= s.viewport.width && s.lure.bounds.top >= 0 && s.lure.bounds.bottom <= s.viewport.height;
  expect(flight.slice(-2).every(inView)).toBe(true);
  expect(flight.filter(inView).length).toBeGreaterThan(flight.length / 2);
  await save(page, info, `${id}-landing`, { prediction, landing, flight });
  const samples = [];
  for (let i = 0; i < 24 && await panel(page).getAttribute('data-phase') !== 'ready'; i++) {
    await tick(page);
    const snapshot = await read(page);
    if (['lure', 'bite'].includes(snapshot.phase)) { assertSafe(snapshot, { lure: true }); samples.push(snapshot); }
  }
  await expect(panel(page)).toHaveAttribute('data-phase', 'ready');
  expect(samples.some(s => s.phase === 'bite')).toBe(true);
}

for (const profile of profiles) {
  test(`cast visibility: ${profile.id} mouse/touch 8m and 32m fixed camera`, async ({ createContext }, info) => {
    const { page, input, click } = await setup(createContext, profile);
    // Prepare during the initial TPS→FPS interpolation, before any settling.
    const central = await aim(page, click, input, 0, 8, profile);
    expect(central.camera.position[1]).toBeCloseTo(2.15, 8);
    await castAndReturn(page, input, central, info, '8m-center');
    for (const direction of [0, -1, 1]) {
      const prediction = await aim(page, click, input, direction, 32, profile);
      await save(page, info, `32m-${direction}-aim`, prediction);
      if (direction === 1) await castAndReturn(page, input, prediction, info, '32m-right');
      else { await input.cancel(); await input.up(); await tick(page); await expect(panel(page)).toHaveAttribute('data-phase', 'ready'); }
    }
  });

  test(`cast visibility: ${profile.id} rod Lv5 keeps 40m and continuous direction`, async ({ createContext }, info) => {
    const { page, input, click } = await setup(createContext, profile, 5);
    for (const direction of [0, 1, -1]) {
      const prediction = await aim(page, click, input, direction, 40, profile);
      await save(page, info, `40m-${direction}-aim`, prediction);
      if (direction === -1) await castAndReturn(page, input, prediction, info, '40m-left');
      else { await input.cancel(); await input.up(); await tick(page); await expect(panel(page)).toHaveAttribute('data-phase', 'ready'); }
    }
  });
}

for (const profile of [profiles[0], profiles[1]]) {
  test(`cast visibility: ${profile.id} keeps a live drag held through camera preparation`, async ({ createContext }, info) => {
    const { page, input, click } = await setup(createContext, profile);
    await click('#cast-button');
    await expect(page.locator('#app')).toHaveAttribute('data-cast-preparing', 'true');
    const x = profile.width / 2, y = profile.height * 0.48;
    await input.down(x, y);
    await input.move(x, y - 181);
    const contact = await page.evaluate(() => window.e2eDiagnostics.events.findLast(event => event.type === 'pointerdown' && event.target === 'scene')?.pointerId);
    expect(contact).toBeDefined();
    expect(await page.locator('#scene').evaluate((canvas, id) => canvas.hasPointerCapture(id), contact)).toBe(true);
    // The contact remains held while the real 100ms preparation completes.
    // It must become the same AIM drag, rather than disappearing or casting
    // from its future release before the camera reaches its fixed pose.
    await tick(page);
    await expect(panel(page)).toHaveAttribute('data-phase', 'aim');
    await expect(page.locator('#line-distance')).toHaveText('着水予測 32.0 m');
    expect(await page.locator('#scene').evaluate((canvas, id) => canvas.hasPointerCapture(id), contact)).toBe(true);
    const prediction = await read(page);
    expect(prediction.camera.fov).toBe(55);
    expect(Math.abs(prediction.camera.pitch)).toBeLessThanOrEqual(1e-3);
    assertSafe(prediction);
    await input.up(); await tick(page);
    await expect(panel(page)).toHaveAttribute('data-phase', 'cast');
    for (let i = 0; i < 4 && await panel(page).getAttribute('data-phase') === 'cast'; i++) await tick(page);
    await expect(panel(page)).toHaveAttribute('data-phase', 'lure');
    const landing = await read(page);
    assertSafe(landing, { lure: true });
    expect(landing.ring.world).toEqual(prediction.ring.world);
    expect(landing.camera.quaternion).toEqual(prediction.camera.quaternion);
    expect(await page.locator('#scene').evaluate((canvas, id) => canvas.hasPointerCapture(id), contact)).toBe(false);
    await save(page, info, 'held-preparation-drag', { prediction, landing });
  });

  test(`cast visibility: ${profile.id} READY pitch/yaw, cancellation and rotation`, async ({ createContext }, info) => {
    const { page, input, click } = await setup(createContext, profile);
    for (const vertical of [-1, 1]) {
      await input.down(profile.width / 2, profile.height * 0.48);
      await input.move(profile.width / 2, profile.height * 0.48 + vertical * 180);
      await tick(page); await input.up();
      for (let i = 0; i < 6; i++) await tick(page);
      const ready = await read(page);
      expect(Math.abs(ready.camera.pitch)).toBeGreaterThan(10 * Math.PI / 180);
      expect(Math.abs(ready.camera.pitch)).toBeLessThanOrEqual(15 * Math.PI / 180);
      const prediction = await aim(page, click, input, 0, 8, profile);
      await save(page, info, `pitch-${vertical}`, { ready, prediction });
      await input.cancel(); await input.up(); await tick(page);
    }
    for (let i = 0; i < 6; i++) await tick(page);
    const beforeTurn = await read(page);
    await input.down(40, profile.height * 0.48); await input.move(220, profile.height * 0.48);
    await tick(page); await input.up();
    const duringTurn = await read(page);
    await click('#cast-button'); await tick(page);
    const prepared = await read(page);
    const requestedHeading = beforeTurn.camera.heading + 180 * 0.004;
    const headingError = actual => Math.abs(Math.atan2(Math.sin(actual - requestedHeading), Math.cos(actual - requestedHeading)));
    expect(headingError(duringTurn.camera.heading)).toBeGreaterThan(0.01);
    expect(headingError(prepared.camera.heading)).toBeLessThanOrEqual(1e-3);
    await save(page, info, 'prepare-during-camera-turn', { beforeTurn, duringTurn, prepared });
    await click('#cancel-cast'); await tick(page);
    // Several native drags cross both π and 2π. The same sign always advances
    // heading; preparation must retain the logical yaw even during smoothing.
    let accumulated = 0, previous = (await read(page)).camera.heading;
    for (let i = 0; i < 10; i++) {
      await input.down(40, profile.height * 0.48); await input.move(220, profile.height * 0.48);
      await tick(page); await input.up();
      for (let j = 0; j < 4; j++) await tick(page);
      const heading = (await read(page)).camera.heading;
      const delta = Math.atan2(Math.sin(heading - previous), Math.cos(heading - previous));
      expect(delta).toBeGreaterThan(0); accumulated += delta; previous = heading;
    }
    expect(accumulated).toBeGreaterThan(2 * Math.PI);
    for (const reason of ['menu', 'blur', 'cancel']) {
      if (reason === 'menu') {
        await click('#cast-button'); await tick(page); await expect(panel(page)).toHaveAttribute('data-phase', 'aim');
        await click('#menu-button'); await click('#collection-close');
      }
      else if (reason === 'blur') {
        await aim(page, click, input, 0, 8, profile);
        await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await input.up();
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      } else { await aim(page, click, input, 0, 8, profile); await input.cancel(); await input.up(); }
      await tick(page); await expect(panel(page)).toHaveAttribute('data-phase', 'ready');
    }
    const prediction = await aim(page, click, input, 1, 32, profile);
    await input.cancel(); await input.up(); await tick(page);
    await click('#cast-button'); await tick(page);
    await page.setViewportSize(profile.touch ? { width: 844, height: 390 } : { width: 390, height: 844 });
    await tick(page);
    const resized = await read(page);
    assertSafe(resized);
    expect(Math.abs(resized.camera.pitch)).toBeLessThanOrEqual(1e-3);
    await save(page, info, 'resized-aim', { prediction, resized });
    await click('#cancel-cast'); await tick(page);
    await expect(panel(page)).toHaveAttribute('data-phase', 'ready');
    // With the clock paused, no part of the preparation blend has elapsed.
    // Releasing an early gesture must never become a deferred cast.
    await click('#cast-button');
    const size = page.viewportSize();
    await input.down(size.width / 2, size.height * 0.48); await input.up();
    await tick(page);
    await expect(panel(page)).toHaveAttribute('data-phase', 'aim');
    expect(Math.abs((await read(page)).camera.pitch)).toBeLessThanOrEqual(1e-3);
    await click('#cancel-cast'); await tick(page);
    await expect(panel(page)).toHaveAttribute('data-phase', 'ready');
    for (const reason of ['menu', 'blur']) {
      await click('#cast-button'); // Preparation remains at zero virtual ms.
      if (reason === 'menu') { await click('#menu-button'); await click('#collection-close'); }
      else {
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      }
      await tick(page);
      await expect(panel(page)).toHaveAttribute('data-phase', 'ready');
    }
  });
}

test('cast visibility: shore shortening keeps water ray and safe landing', async ({ createContext }, info) => {
  const boundary = shoreRadius(0);
  const { page, input, click } = await setup(createContext, profiles[0], 1, { x: boundary - 18, z: 0, heading: Math.PI / 2 });
  await click('#cast-button'); await tick(page);
  await input.down(500, 336); await input.move(500, 156); await tick(page);
  const prediction = await read(page);
  assertSafe(prediction);
  const text = await page.locator('#line-distance').textContent();
  const distance = Number(text.match(/[\d.]+/)?.[0]);
  expect(distance).toBeGreaterThanOrEqual(5.5); expect(distance).toBeLessThan(32);
  await save(page, info, 'shore-shortened', prediction);
  await castAndReturn(page, input, prediction, info, 'shore-shortened');
});


test('cast visibility: no safe shore target rejects release with an explanation', async ({ createContext }, info) => {
  const { page, input, click } = await setup(createContext, profiles[1], 1,
    { x: shoreRadius(0) - 7, z: 0, heading: Math.PI / 2 });
  await click('#cast-button'); await tick(page);
  await expect(panel(page)).toHaveAttribute('data-phase', 'aim');
  await input.down(195, 405); await input.move(196, 405); await input.move(195, 225); await tick(page);
  await expect(page.locator('#line-distance')).toContainText('投げられません');
  await input.up(); await tick(page);
  await expect(panel(page)).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('#fishing-note')).toContainText(/岸|画面|安全|湖側/);
  await save(page, info, 'blocked-shore', await read(page));
});


async function resizeAndObserve(page, viewport) {
  await page.setViewportSize(viewport);
  // setViewportSize can finish before Chromium delivers the resize event.
  // Observe the actual renderer at the new aspect instead of assuming that a
  // single queued rAF already consumed it. Ordinary 16ms frames keep the
  // simulation's phase boundaries and hook window unchanged.
  await expect.poll(async () => {
    await page.clock.runFor(16);
    const snapshot = await read(page);
    return { viewport: snapshot.viewport, aspect: snapshot.camera.aspect };
  }, { intervals: [0] }).toEqual({ viewport, aspect: viewport.width / viewport.height });
}

for (const phase of ['cast', 'lure', 'bite']) {
  test(`cast visibility: unsafe rotation during ${phase.toUpperCase()} recalls the lure at FOV55`, async ({ createContext }, info) => {
    const { page, input, click } = await setup(createContext, profiles[0]);
    const prediction = await aim(page, click, input, 1, 32, profiles[0]);
    await input.up(); await tick(page);
    for (let i = 0; i < 20 && await panel(page).getAttribute('data-phase') !== phase; i++) await tick(page);
    await expect(panel(page)).toHaveAttribute('data-phase', phase);
    const before = await read(page);
    expect(before.camera.fov).toBe(55);
    // A contact spanning rotation must be released by the same production
    // reset path that recalls the unsafe target.
    await input.down(500, 336);
    await resizeAndObserve(page, { width: 390, height: 844 });
    await expect(panel(page)).toHaveAttribute('data-phase', 'ready');
    await expect(page.locator('#fishing-note')).toContainText(/画面サイズ.*回収/);
    const recalled = await read(page);
    expect(recalled.camera.fov).toBe(55);
    expect(recalled.camera.heading).toBe(before.camera.heading);
    expect(recalled.ring.world).toEqual(prediction.ring.world);
    expect(recalled.ring.visible).toBe(false);
    expect(recalled.lure.visible).toBe(false);
    expect(await page.locator('#scene').evaluate(canvas => canvas.hasPointerCapture(1))).toBe(false);
    await save(page, info, `recalled-${phase}`, { prediction, before, recalled });
    await input.up(); await tick(page);
    await expect(panel(page)).toHaveAttribute('data-phase', 'ready');
    const retry = await aim(page, click, input, 0, 8, profiles[0]);
    expect(retry.camera.fov).toBe(55);
    await input.up(); await tick(page);
    await expect(panel(page)).toHaveAttribute('data-phase', 'cast');
    for (let i = 0; i < 5 && await panel(page).getAttribute('data-phase') === 'cast'; i++) await tick(page);
    await expect(panel(page)).toHaveAttribute('data-phase', 'lure');
    assertSafe(await read(page), { lure: true });
    expect((await read(page)).ring.world).toEqual(retry.ring.world);
  });
}

test('cast visibility: a safe central cast continues through rotation with FOV55 and the same target', async ({ createContext }, info) => {
  const { page, input, click } = await setup(createContext, profiles[0]);
  const prediction = await aim(page, click, input, 0, 32, profiles[0]);
  await input.up(); await tick(page);
  await expect(panel(page)).toHaveAttribute('data-phase', 'cast');
  for (let i = 0; i < 5 && await panel(page).getAttribute('data-phase') === 'cast'; i++) await tick(page);
  await expect(panel(page)).toHaveAttribute('data-phase', 'lure');
  const before = await read(page);
  await resizeAndObserve(page, { width: 390, height: 844 });
  await expect(panel(page)).toHaveAttribute('data-phase', 'lure');
  const rotated = await read(page);
  expect(rotated.camera.fov).toBe(55);
  expect(rotated.camera.position).toEqual(before.camera.position);
  expect(rotated.camera.quaternion).toEqual(before.camera.quaternion);
  expect(rotated.ring.world).toEqual(prediction.ring.world);
  assertSafe(rotated, { lure: true });
  for (let i = 0; i < 20 && await panel(page).getAttribute('data-phase') === 'lure'; i++) await tick(page);
  await expect(panel(page)).toHaveAttribute('data-phase', 'bite');
  const bite = await read(page);
  assertSafe(bite, { lure: true });
  expect(bite.camera.fov).toBe(55);
  expect(bite.camera.quaternion).toEqual(prediction.camera.quaternion);
  expect(bite.ring.world).toEqual(prediction.ring.world);
  await save(page, info, 'rotated-safe-target', { prediction, before, rotated, bite });
});

test('cast visibility: AIM rotation re-limits the preview at FOV55 before release', async ({ createContext }, info) => {
  const { page, input, click } = await setup(createContext, profiles[0]);
  const before = await aim(page, click, input, 1, 32, profiles[0]);
  await resizeAndObserve(page, { width: 390, height: 844 });
  await expect(panel(page)).toHaveAttribute('data-phase', 'aim');
  const prediction = await read(page);
  expect(prediction.camera.fov).toBe(55);
  expect(prediction.camera.quaternion).toEqual(before.camera.quaternion);
  expect(prediction.ring.world[0]).toBeLessThan(before.ring.world[0]);
  assertSafe(prediction);
  await save(page, info, 'rotated-aim-preview', { before, prediction });
  await castAndReturn(page, input, prediction, info, 'rotated-aim');
});

test('cast visibility: near retrieval and BITE keep readable world markers above the boat', async ({ createContext }, info) => {
  const profile = profiles[1];
  const { page, input, click } = await setup(createContext, profile, 1, undefined, 0.5);
  const prediction = await aim(page, click, input, 0, 8, profile);
  await input.up();
  for (let i = 0; i < 5 && await panel(page).getAttribute('data-phase') !== 'lure'; i++) await tick(page);
  await expect(panel(page)).toHaveAttribute('data-phase', 'lure');
  await input.down(195, 405);
  let near;
  for (let i = 0; i < 28; i++) {
    await tick(page);
    near = await read(page);
    assertSafe(near, { lure: true });
    const distance = Math.hypot(near.lure.world[0], near.lure.world[2] - 30);
    if (distance <= 5) break;
  }
  await input.up(); await tick(page);
  near = await read(page);
  const distance = Math.hypot(near.lure.world[0], near.lure.world[2] - 30);
  expect(distance).toBeGreaterThan(4.5); expect(distance).toBeLessThanOrEqual(5);
  assertSafe(near, { lure: true });
  expect(near.camera.quaternion).toEqual(prediction.camera.quaternion);
  await save(page, info, 'near-retrieval', near);
  for (let i = 0; i < 40 && await panel(page).getAttribute('data-phase') !== 'bite'; i++) {
    await tick(page);
    const snapshot = await read(page);
    assertSafe(snapshot, { lure: true });
  }
  await expect(panel(page)).toHaveAttribute('data-phase', 'bite');
  const bite = await read(page);
  assertSafe(bite, { lure: true });
  expect(bite.camera.quaternion).toEqual(prediction.camera.quaternion);
  await save(page, info, 'near-bite', bite);
});
