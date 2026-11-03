import { expect } from './diagnostics-fixture.js';
import { installPausedClock } from './clock-fixture.js';
import { activateButton } from './input-fixture.js';
import { gearSave } from '../helpers/rod-reel-save.js';
export { gearSave };

export const GEAR_PROFILES = [
  { id: 'pc', width: 1280, height: 800, dpr: 1, touch: false },
  { id: 'portrait', width: 390, height: 844, dpr: 2, touch: true },
  { id: 'landscape', width: 844, height: 390, dpr: 2, touch: true },
  { id: 'small', width: 360, height: 740, dpr: 3, touch: true },
];
export const gearTick = page => page.clock.fastForward(250);
export const gearPhase = page => page.locator('#fishing-panel').getAttribute('data-phase');
export const gearRead = (page, options = {}) => page.evaluate(options => window.readRodReel(options), options);

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
      let renders = 0, renderedPhase, phaseStartedElapsed = 0;
      renderer.render = function(scene, camera) {
        const result = render.call(this, scene, camera);
        renders++;
        const phase = document.querySelector('#fishing-panel').dataset.phase;
        const elapsed = scene.getObjectByName('lake-water').material.uniforms.time.value;
        if (phase !== renderedPhase) { renderedPhase = phase; phaseStartedElapsed = elapsed; }
        const frame = { phase, elapsed, observedPhaseSeconds: elapsed - phaseStartedElapsed };
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
        window.readRodReel = ({ includeTriangles = false } = {}) => {
          const root = scene.getObjectByName('fishing-rod-reel');
          const visible = object => Boolean(object && object.visible && (!object.parent || visible(object.parent)));
          const project = world => {
            const ndc = world.clone().project(camera);
            return { world: world.toArray(), normalized: [(ndc.x + 1) / 2, (1 - ndc.y) / 2],
              x: (ndc.x + 1) * innerWidth / 2, y: (1 - ndc.y) * innerHeight / 2, depth: ndc.z };
          };
          const describeMesh = (mesh, metadata = {}) => {
            if (!mesh) return null;
            const geometry = mesh.geometry, position = geometry.attributes.position;
            const available = geometry.index?.count ?? position.count;
            const start = geometry.drawRange.start, end = Math.min(start + geometry.drawRange.count, available);
            const points = [];
            for (let i = start; i < end; i++) {
              const index = geometry.index ? geometry.index.getX(i) : i;
              points.push(project(mesh.localToWorld(mesh.position.clone().fromBufferAttribute(position, index))));
            }
            return { visible: visible(mesh), ...metadata, renderOrder: mesh.renderOrder,
              geometryId: geometry.id, materialId: mesh.material.id, triangles: (end - start) / 3,
              positionVersion: position.version, colorVersion: geometry.attributes.color?.version ?? null,
              scale: mesh.scale.toArray(),
              center: project(mesh.getWorldPosition(mesh.position.clone())),
              bounds: { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
                top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) },
              depth: { min: Math.min(...points.map(p => p.depth)), max: Math.max(...points.map(p => p.depth)) },
              ...(includeTriangles ? { projectedTriangles: Array.from({ length: (end - start) / 3 }, (_, i) =>
                points.slice(i * 3, i * 3 + 3).map(p => [p.x, p.y])) } : {}) };
          };
          const describe = name => {
            const part = root?.getObjectByName(name), mesh = part?.children.find(child => child.isMesh);
            return mesh ? describeMesh(mesh, { level: part.userData.level, parts: [...part.userData.parts] }) : null;
          };
          const line = scene.getObjectByName('fishing-line');
          const lineStart = line && project(line.localToWorld(line.position.clone().fromBufferAttribute(line.geometry.attributes.position, 0)));
          const lineEnd = line && project(line.localToWorld(line.position.clone().fromBufferAttribute(line.geometry.attributes.position, 1)));
          const tipWorld = root && root.localToWorld(root.position.clone().fromArray(root.userData.tip));
          // The line's Float32 attribute is the only precision loss allowed.
          // Recompute its exact quantized expectation from this same model tip.
          const quantizeForLine = world => {
            const local = line.worldToLocal(world.clone());
            return line.localToWorld(local.set(...local.toArray().map(Math.fround)));
          };
          const quantizedTip = tipWorld && line && project(quantizeForLine(tipWorld));
          let ring;
          scene.traverse(object => {
            if (object.geometry?.type === 'RingGeometry' && object.geometry.parameters.outerRadius === 0.7) ring = object;
          });
          const gl = renderer.getContext();
          const rect = element => ({ id: element.id || element.className, ...element.getBoundingClientRect().toJSON() });
          return { renders, phase: document.querySelector('#fishing-panel').dataset.phase, frame,
            visible: visible(root), viewport: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio,
            cameraParent: camera.parent?.type ?? null,
            camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(),
              fov: camera.fov, aspect: camera.aspect, near: camera.near, far: camera.far, zoom: camera.zoom },
            tip: tipWorld && project(tipWorld),
            grip: root && project(root.localToWorld(root.position.clone().set(0, 0.12, 0))),
            rod: describe('fishing-rod'), reel: describe('fishing-reel'),
            lure: describeMesh(scene.getObjectByName('fishing-lure')), ring: describeMesh(ring),
            line: { visible: visible(line), start: lineStart, end: lineEnd, quantizedTip,
              geometryId: line?.geometry.id, materialId: line?.material.id,
              worldDelta: tipWorld && lineStart?.world.map((value, index) => value - tipWorld.getComponent(index)),
              projectionDelta: quantizedTip && lineStart?.normalized.map((value, index) => value - project(tipWorld).normalized[index]) },
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
    async cancel() {
      if (profile.touch) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); touching = false;
        await expect.poll(() => page.locator('#scene').evaluate(canvas => {
          const id = window.e2eDiagnostics.events.findLast(event => event.type === 'pointerdown' && event.target === 'scene')?.pointerId;
          return id === undefined || !canvas.hasPointerCapture(id);
        })).toBe(true);
      } else await page.locator('#scene').evaluate(canvas => canvas.releasePointerCapture(1));
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
  // Keep the original strict projection contract in every neutral phase.
  // AIM/CAST now move the actual assembly; their line attachment is checked
  // against the same-frame mesh transform, never a fixed screen coordinate.
  if (!['aim', 'cast'].includes(snapshot.phase)) {
    expect(snapshot.tip.normalized[0]).toBeCloseTo(0.58, 6);
    expect(snapshot.tip.normalized[1]).toBeCloseTo(0.57, 6);
  }
  if (line) {
    expect(snapshot.line.visible).toBe(true);
    expect(snapshot.line.start.world).toEqual(snapshot.line.quantizedTip.world);
    expect(snapshot.line.start.normalized).toEqual(snapshot.line.quantizedTip.normalized);
    for (let i = 0; i < 3; i++) expect(snapshot.line.end.world[i]).toBe(Math.fround(snapshot.lure.center.world[i]));
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
