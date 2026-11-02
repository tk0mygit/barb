import { expect } from './diagnostics-fixture.js';
import { installPausedClock } from './clock-fixture.js';
import { activateButton } from './input-fixture.js';
import { createCatchCollection } from '../../src/game/catch-collection.js';
import { createAchievements } from '../../src/game/achievements.js';
import { createBoatState } from '../../src/game/boat.js';
import { createGameClock } from '../../src/game/game-clock.js';
import { createSaveData, validateSaveData } from '../../src/game/save-data.js';

export const GEAR_PROFILES = [
  { id: 'pc', width: 1280, height: 800, dpr: 1, touch: false },
  { id: 'portrait', width: 390, height: 844, dpr: 2, touch: true },
  { id: 'landscape', width: 844, height: 390, dpr: 2, touch: true },
  { id: 'small', width: 360, height: 740, dpr: 3, touch: true },
];
export const gearTick = page => page.clock.fastForward(250);
export const gearPhase = page => page.locator('#fishing-panel').getAttribute('data-phase');
export const gearRead = page => page.evaluate(() => window.readRodReel());

export function gearSave({ level = 1, version = 2, seconds = 90, balance = 0 } = {}) {
  const collection = createCatchCollection({ initialData: { catches: [],
    wallet: { balance, lifetimeSales: balance }, equipment: { rodLevel: level, reelLevel: level } } });
  const data = createSaveData({ collection, achievements: createAchievements({ collection }),
    boat: createBoatState({ x: 10, z: 20, heading: 0 }), clock: createGameClock(undefined, { elapsedSeconds: seconds }) },
  { savedAt: '2026-11-02T00:00:00.000Z' });
  // Empty-history V1 is its real wire schema: no V2 catch fields to remove.
  return validateSaveData({ ...data, saveVersion: version });
}

export async function openGear(createContext, profile, options = {}) {
  const context = await createContext({ viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: profile.dpr, hasTouch: profile.touch, isMobile: profile.touch });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await installPausedClock(page);
  await page.addInitScript(data => {
    if (!sessionStorage.getItem('rod-reel-save-seeded')) {
      localStorage.setItem('barb.save.v1.slotA', JSON.stringify({ storageVersion: 1, generation: 1, data }));
      sessionStorage.setItem('rod-reel-save-seeded', 'yes');
    }
    Math.random = () => 0.5;
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', ({ detail: renderer }) => {
      if (!renderer.isWebGLRenderer) return;
      const render = renderer.render, disposal = { geometries: [], materials: [] }, hooked = new WeakSet();
      let renders = 0;
      renderer.render = function(scene, camera) {
        const result = render.call(this, scene, camera);
        renders++;
        const group = scene.getObjectByName('fishing-rod-reel');
        group?.traverse(object => {
          for (const [resource, key] of [[object.geometry, 'geometries'], [object.material, 'materials']]) {
            if (!resource || hooked.has(resource)) continue;
            hooked.add(resource);
            resource.addEventListener('dispose', () => disposal[key].push(resource.id));
          }
        });
        // Test-only, read-only observation. Re-read the observed scene while
        // the menu pauses rendering, so purchase synchronization is not
        // inferred from a later frame or a second persistent equipment value.
        window.readRodReel = () => {
          const root = scene.getObjectByName('fishing-rod-reel');
          const visible = object => Boolean(object && object.visible && (!object.parent || visible(object.parent)));
          const project = world => {
            const ndc = world.clone().project(camera);
            return { world: world.toArray(), normalized: [(ndc.x + 1) / 2, (1 - ndc.y) / 2],
              x: (ndc.x + 1) * innerWidth / 2, y: (1 - ndc.y) * innerHeight / 2, depth: ndc.z };
          };
          const describe = name => {
            const part = root?.getObjectByName(name), mesh = part?.children.find(child => child.isMesh);
            if (!mesh) return null;
            const position = mesh.geometry.attributes.position, count = mesh.geometry.drawRange.count;
            const points = [];
            for (let i = 0; i < count; i++) points.push(project(mesh.localToWorld(mesh.position.clone().fromBufferAttribute(position, i))));
            return { visible: visible(mesh), level: part.userData.level, parts: [...part.userData.parts],
              geometryId: mesh.geometry.id, materialId: mesh.material.id, triangles: count / 3,
              positionVersion: position.version, colorVersion: mesh.geometry.attributes.color.version,
              bounds: { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
                top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) },
              depth: { min: Math.min(...points.map(p => p.depth)), max: Math.max(...points.map(p => p.depth)) } };
          };
          const line = scene.getObjectByName('fishing-line');
          const lineStart = line && project(line.localToWorld(line.position.clone().fromBufferAttribute(line.geometry.attributes.position, 0)));
          const gl = renderer.getContext();
          const rect = element => ({ id: element.id || element.className, ...element.getBoundingClientRect().toJSON() });
          return { renders, phase: document.querySelector('#fishing-panel').dataset.phase,
            visible: visible(root), viewport: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio,
            cameraParent: camera.parent?.type ?? null,
            tip: root && project(root.localToWorld(root.position.clone().fromArray(root.userData.tip))),
            rod: describe('fishing-rod'), reel: describe('fishing-reel'),
            line: { visible: visible(line), start: lineStart },
            resources: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
              geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs.length },
            buffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
            qte: [...document.querySelectorAll('.qte-hud,.qte-gesture')].filter(el => el.getClientRects().length).map(rect),
            controls: [...document.querySelectorAll('button,.masthead,#fishing-panel,#reticle')]
              .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden').map(rect),
            disposal: { geometries: [...disposal.geometries], materials: [...disposal.materials] } };
        };
        return result;
      };
    });
  }, gearSave(options));
  await page.goto('./'); await gearTick(page);
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#error')).toBeHidden();
  const click = selector => activateButton(page.locator(selector), profile.touch);
  const cdp = await context.newCDPSession(page);
  let touching = false;
  const input = {
    async down(point) {
      const p = point ?? { x: Math.round(page.viewportSize().width * 0.6), y: Math.round(page.viewportSize().height * 0.48) };
      if (profile.touch) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] }); touching = true; }
      else { await page.mouse.move(p.x, p.y); await page.mouse.down(); }
    },
    async move(point) {
      if (profile.touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
      else await page.mouse.move(point.x, point.y);
    },
    async up() {
      if (profile.touch) { if (touching) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); touching = false; }
      else await page.mouse.up();
    },
  };
  return { context, page, click, input, errors };
}

export function assertGear(snapshot, level, { line = false } = {}) {
  expect(snapshot.visible).toBe(true);
  expect(snapshot.cameraParent).toBeNull();
  expect(snapshot.rod.level).toBe(level); expect(snapshot.reel.level).toBe(level);
  expect(snapshot.rod.geometryId).not.toBe(snapshot.reel.geometryId);
  expect(snapshot.rod.materialId).toBe(snapshot.reel.materialId);
  for (const part of [snapshot.rod, snapshot.reel]) {
    expect(part.visible).toBe(true);
    expect(part.depth.min).toBeGreaterThan(-1); expect(part.depth.max).toBeLessThan(1);
    expect(part.bounds.right - part.bounds.left).toBeGreaterThan(8);
    expect(part.bounds.bottom - part.bounds.top).toBeGreaterThan(8);
    expect(part.bounds.left).toBeGreaterThanOrEqual(0);
    expect(part.bounds.right).toBeLessThanOrEqual(snapshot.viewport.width);
    expect(part.bounds.top).toBeGreaterThanOrEqual(0);
    expect(part.bounds.bottom).toBeLessThanOrEqual(snapshot.viewport.height);
  }
  expect(snapshot.tip.normalized[0]).toBeCloseTo(0.58, 6);
  expect(snapshot.tip.normalized[1]).toBeCloseTo(0.57, 6);
  if (line) {
    expect(snapshot.line.visible).toBe(true);
    for (let i = 0; i < 2; i++) expect(snapshot.tip.normalized[i]).toBeCloseTo(snapshot.line.start.normalized[i], 6);
  }
}

export async function gearEvidence(page, info, label, { screenshot = false } = {}) {
  const snapshot = await gearRead(page);
  const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
    * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const overlaps = [snapshot.rod, snapshot.reel].flatMap((part, index) => [...snapshot.controls, ...snapshot.qte]
    .map(rect => ({ model: index ? 'reel' : 'rod', element: rect.id, boundingBoxOverlapPx2: overlap(part.bounds, rect) }))
    .filter(row => row.boundingBoxOverlapPx2 > 0));
  await info.attach(label, { body: JSON.stringify({ snapshot, overlaps,
    limits: ['Projected bounding-box intersections can contain empty space. DOM HUD remains painted above WebGL.',
      'Headless Chromium/SwiftShader; not physical-device GPU measurements.'] }, null, 2), contentType: 'application/json' });
  if (screenshot) {
    const path = info.outputPath(`${label}.png`); await page.screenshot({ path });
    await info.attach(`${label}-image`, { path, contentType: 'image/png' });
  }
  return snapshot;
}
