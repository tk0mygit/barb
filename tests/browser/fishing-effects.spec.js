import { test, expect } from './diagnostics-fixture.js';
import { writeFile } from 'node:fs/promises';
import { setup } from './day-night-fixture.js';
import { enterFishing, fishingInput, phase, tick } from './mobile-capture.js';

async function observeSurface(page) {
  await page.addInitScript(() => {
    let devtools;
    Object.defineProperty(window, '__THREE_DEVTOOLS__', { configurable: true, get: () => devtools, set(value) {
      devtools = value;
      value.addEventListener('observe', ({ detail: renderer }) => {
        if (!renderer.isWebGLRenderer) return;
        const render = renderer.render, direct = renderer.renderBufferDirect;
        const hooked = new WeakSet(), alpha = Array(6).fill(0), disposal = { geometries: 0, materials: 0 };
        let calls = 0, triangles = 0, births = 0, renders = 0;
        renderer.renderBufferDirect = function(...args) {
          const beforeCalls = this.info.render.calls, beforeTriangles = this.info.render.triangles;
          const result = direct.apply(this, args);
          if (args[4].name === 'fishing-water-effects') {
            calls += this.info.render.calls - beforeCalls; triangles += this.info.render.triangles - beforeTriangles;
          }
          return result;
        };
        renderer.render = function(scene, camera) {
          calls = triangles = 0;
          const result = render.call(this, scene, camera); renders++;
          const mesh = scene.getObjectByName('fishing-water-effects');
          if (mesh) {
            for (const [resource, key] of [[mesh.geometry, 'geometries'], [mesh.material, 'materials']]) if (!hooked.has(resource)) {
              hooked.add(resource); resource.addEventListener('dispose', () => disposal[key]++);
            }
            const colors = mesh.geometry.attributes.color.array;
            for (let i = 0; i < 6; i++) {
              const current = colors[i * 288 * 4 + 3];
              if (current > alpha[i] + 1e-6) births++;
              alpha[i] = current;
            }
          }
          window.readSurface = () => {
            const object = scene.getObjectByName('fishing-water-effects');
            const visible = o => Boolean(o?.visible && (!o.parent || visible(o.parent)));
            let height = 0, left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
            if (object && visible(object)) {
              const position = object.geometry.attributes.position, color = object.geometry.attributes.color;
              const point = object.position.clone();
              for (let i = 0; i < position.count; i++) if (color.getW(i) > .005) {
                if (i >= 1728) height = Math.max(height, position.getY(i));
                point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld).project(camera);
                const x = (point.x + 1) * innerWidth / 2, y = (1 - point.y) * innerHeight / 2;
                left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
              }
            }
            return { phase: document.querySelector('#fishing-panel').dataset.phase, renders, births, alpha: [...alpha],
              elapsed: scene.getObjectByName('lake-water').material.uniforms.time.value, visible: visible(object), height,
              bounds: Number.isFinite(left) ? { left, top, right, bottom, height: bottom - top, width: right - left } : null,
              position: object?.position.toArray(), geometry: object?.geometry.id, material: object?.material.id,
              calls, triangles, disposal: { ...disposal },
              resources: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
                geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs.length } };
          };
          return result;
        };
      });
    } });
  });
}
const read = page => page.evaluate(() => window.readSurface());
async function evidence(page, info, label, records, screenshot = false) {
  const value = await read(page); records.push({ label, ...value });
  const path = info.outputPath('surface-effects.json'); await writeFile(path, JSON.stringify(records, null, 2));
  if (screenshot) await page.screenshot({ path: info.outputPath(`${label}.png`) });
  return value;
}
async function cast(page, input, touch, distance) {
  if (touch) await page.locator('#cast-button').tap(); else await page.locator('#cast-button').click();
  await tick(page);
  const p = { x: page.viewportSize().width * .6, y: page.viewportSize().height * .48 };
  await input.down(p);
  if (distance === 32) await input.move({ x: p.x, y: p.y - 180 });
  await tick(page); await expect(page.locator('#line-distance')).toHaveText(`着水予測 ${distance.toFixed(1)} m`);
  await input.up();
  for (let i = 0; i < 8 && await phase(page) !== 'lure'; i++) await tick(page);
  expect(await phase(page)).toBe('lure'); return p;
}

for (const touch of [false, true]) test(`surface effects ${touch ? 'touch 32m night fog QTE' : 'PC 8m day failure'}: native events, bounded batches and shutdown`, async ({ createContext }, info) => {
  const context = await createContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    deviceScaleFactor: touch ? 2 : 1, hasTouch: touch, isMobile: touch });
  const page = await context.newPage(), errors = [], records = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await observeSurface(page); await setup(page, touch ? 3971 * 360 + 270 : 90); await enterFishing(page, touch);
  expect((await read(page)).calls).toBe(0);
  const input = await fishingInput(page, touch), p = await cast(page, input, touch, touch ? 32 : 8);
  const landing = await evidence(page, info, 'landing-birth', records);
  expect(landing.births).toBe(1);
  await page.clock.fastForward(200);
  const peak = await evidence(page, info, 'landing-peak', records, true);
  expect(peak.height).toBeGreaterThan(.45); expect(peak.bounds.height).toBeGreaterThan(3);
  expect(peak.calls).toBe(1); expect(peak.triangles).toBe(1152); expect(peak.resources.calls).toBeLessThan(40);
  for (let i = 0; i < 120 && await phase(page) !== 'bite'; i++) await tick(page);
  expect(await phase(page)).toBe('bite');
  expect((await read(page)).births).toBe(2); await page.clock.fastForward(200);
  const bite = await evidence(page, info, 'bite-peak', records, true);
  expect(bite.height).toBeGreaterThan(peak.height); expect(bite.calls).toBe(1);
  if (!touch) {
    await page.clock.fastForward(250); await page.clock.fastForward(250); await page.clock.fastForward(250); await page.clock.fastForward(250);
    expect(await phase(page)).toBe('failed'); expect((await read(page)).visible).toBe(false); expect((await read(page)).calls).toBe(0);
    for (let i = 0; i < 7; i++) await tick(page);
    expect(await phase(page)).toBe('ready'); expect((await read(page)).calls).toBe(0);
  } else {
    await input.tap(); await page.clock.fastForward(16); expect(await phase(page)).toBe('fight');
    const before = await read(page); await input.down(p);
    for (let i = 0; i < 4; i++) await tick(page);
    const reeling = await evidence(page, info, 'reeling-peak', records, true);
    expect(reeling.births - before.births).toBeGreaterThanOrEqual(2); expect(reeling.births - before.births).toBeLessThanOrEqual(5);
    expect(reeling.calls).toBe(1); expect(reeling.triangles).toBe(1152);
    await input.up(); await page.clock.fastForward(16);
    const released = await read(page);
    for (let i = 0; i < 4; i++) await tick(page);
    expect((await read(page)).births).toBe(released.births); expect((await read(page)).calls).toBe(0);
    await page.locator('#menu-button').tap(); const paused = await read(page);
    await page.clock.fastForward(10000); expect((await read(page)).renders).toBe(paused.renders);
    await page.locator('#collection-close').tap(); await page.clock.fastForward(16);
    expect((await read(page)).births).toBe(paused.births);
    await page.setViewportSize({ width: 844, height: 390 });
    expect((await read(page)).births).toBe(paused.births);
    const point = { x: 844 * .6, y: 390 * .48 };
    let held = false;
    for (let i = 0; i < 60 && await page.locator('.qte-hud').isHidden(); i++) {
      const tension = await page.locator('#line-tension').evaluate(e => e.value);
      if (!held && tension < .35) { await input.down(point); held = true; }
      else if (held && tension > .6) { await input.up(); held = false; }
      await tick(page);
    }
    await expect(page.locator('.qte-hud')).toBeVisible(); await input.up();
    const qteBirths = (await read(page)).births;
    for (let i = 0; i < 12 && await page.locator('.qte-hud').getAttribute('data-state') !== 'active'; i++) await page.clock.fastForward(100);
    await expect(page.locator('.qte-hud')).toHaveAttribute('data-state', 'active');
    const operation = await page.evaluate(() => {
      const region = document.querySelector('.qte-gesture').getBoundingClientRect(), circle = document.querySelector('.qte-target');
      const target = circle.getBoundingClientRect(), vector = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }[document.querySelector('.qte-arrow').dataset.direction] ?? [0, 0];
      const operation = document.querySelector('.qte-hud').dataset.operation;
      const center = circle.hidden ? { x: (region.left + region.right) / 2, y: (region.top + region.bottom) / 2 }
        : { x: (target.left + target.right) / 2, y: (target.top + target.bottom) / 2 };
      return { center, vector, operation };
    });
    const distance = operation.operation === 'swipe' ? 80 : operation.operation === 'flick' ? 50 : 0;
    const start = { x: operation.center.x - operation.vector[0] * distance / 2, y: operation.center.y - operation.vector[1] * distance / 2 };
    expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.id, start)).toBe('scene');
    for (let i = 0; i < (operation.operation === 'tap' ? 3 : 1); i++) {
      await page.clock.fastForward(10); await input.down(start);
      if (distance) await input.move({ x: start.x + operation.vector[0] * distance, y: start.y + operation.vector[1] * distance });
      await page.clock.fastForward(20); await input.up();
    }
    for (let i = 0; i < 24 && !['success', 'failure'].includes(await page.locator('.qte-hud').getAttribute('data-state')); i++) await page.clock.fastForward(100);
    await expect(page.locator('.qte-hud')).toHaveAttribute('data-state', 'success');
    expect((await read(page)).births).toBe(qteBirths);
    await evidence(page, info, 'qte-native-success', records, true);
  }
  const final = await evidence(page, info, 'before-shutdown', records);
  expect(final.geometry).toBe(peak.geometry); expect(final.material).toBe(peak.material);
  await page.locator('#scene').evaluate(canvas => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  await expect(page.locator('#error')).toContainText('ページを再読み込み');
  const destroyed = await evidence(page, info, 'shutdown', records);
  expect(destroyed.disposal).toEqual({ geometries: 1, materials: 1 }); expect(destroyed.visible).toBe(false);
  await page.locator('#scene').evaluate(canvas => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  expect((await read(page)).disposal).toEqual({ geometries: 1, materials: 1 });
  expect(errors).toEqual([]);
});
