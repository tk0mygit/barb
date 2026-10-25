import { expect } from '@playwright/test';
import { installPausedClock } from './clock-fixture.js';
import { Color } from 'three';
import { sampleNightFog, getNightFogDensity } from '../../src/world/night-fog.js';
import { createCatchCollection } from '../../src/game/catch-collection.js';
import { createAchievements } from '../../src/game/achievements.js';
import { createBoatState } from '../../src/game/boat.js';
import { createGameClock } from '../../src/game/game-clock.js';
import { createSaveData } from '../../src/game/save-data.js';
import { sampleDayNight } from '../../src/world/day-night.js';

const now = new Date('2026-10-23T00:00:00Z');
export const tick = page => page.clock.fastForward(250);
export const read = page => page.evaluate(() => window.lightingProbe.last);

export async function observeControls(page) {
  await page.evaluate(() => {
    window.controlProbe = window.e2eDiagnostics;
  });
}

export async function activateControl(page, id, touch) {
  const button = page.locator(`#${id}`);
  await Promise.all([expect(button).toBeVisible(), expect(button).toBeEnabled()]);
  const before = await button.evaluate(button => {
    const bounds = button.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    const snapshot = { id: button.id, hidden: button.hidden, disabled: button.disabled, bounds: bounds.toJSON(),
      hit: hit?.closest('button')?.id ?? hit?.id, boatSpeed: window.lightingProbe.last.boatSpeed,
      motion: document.querySelector('#motion-label').textContent, eventSequence: window.controlProbe.events.at(-1)?.sequence ?? 0 };
    window.controlProbe.actions.push(snapshot);
    if (window.controlProbe.actions.length > 30) window.controlProbe.actions.shift();
    return snapshot;
  });
  expect(before.hit).toBe(id);
  // Keep Playwright's stability/receives-events checks and send one input only.
  if (touch) await button.tap();
  else await button.click();
  // Read the completed event sequence once per poll. This retains both
  // assertions without extra CDP round trips while software WebGL is active.
  await expect.poll(() => page.evaluate(start => {
    const events = window.controlProbe.events.filter(event => event.sequence > start);
    window.controlProbe.actions.at(-1).eventsAfterInput = events;
    return {
      clicks: events.filter(event => event.type === 'click').map(event => ({ target: event.target, trusted: event.trusted })),
      pointerTargets: events.filter(event => event.type === 'pointerdown').map(event => event.target),
    };
  }, before.eventSequence)).toEqual({ clicks: [{ target: id, trusted: true }], pointerTargets: [id] });
}

export async function setup(page, elapsedSeconds, { freeze = true } = {}) {
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
      const hooked = new WeakSet(), initializedGeometries = new Set();
      renderer.render = function(scene, camera) {
        const cpuGeometries = new Set();
        let fishing;
        scene.traverse(object => {
          if (object.isGroup && object.children.some(child => child.isLine)
            && object.children.some(child => child.geometry?.type === 'RingGeometry' && child.geometry.parameters.outerRadius === 0.7)) fishing = object;
          if (!object.geometry) return;
          cpuGeometries.add(object.geometry.id);
          if (hooked.has(object)) return;
          hooked.add(object);
          // Record the actual geometry used by ordinary and shadow draws.
          // This observes lazy GPU initialization without warming hidden fish
          // markers or changing scene visibility/camera/game state.
          for (const method of ['onBeforeRender', 'onBeforeShadow']) {
            const original = object[method];
            object[method] = function(...args) {
              initializedGeometries.add(object.geometry.id);
              return original?.apply(this, args);
            };
          }
          const geometry = object.geometry;
          geometry.addEventListener('dispose', () => initializedGeometries.delete(geometry.id));
        });
        const ambient = scene.children.find(o => o.isHemisphereLight);
        const [sun, moonlight] = scene.children.filter(o => o.isDirectionalLight);
        const sky = scene.children.find(o => o.isSky), moon = scene.getObjectByName('moon');
        const water = scene.getObjectByName('lake-water').material.uniforms;
        const mist = scene.getObjectByName('surface-fog');
        const mistUniforms = mist.children[0].material.uniforms;
        const snapshot = {
          ambient: ambient.intensity, sun: sun.intensity, moon: moonlight.intensity,
          sky: sky.material.uniforms.skyDaylight.value, fog: scene.fog.color.toArray(),
          fogDensity: scene.fog.density, waterFogDensity: water.fogDensity.value,
          skyFog: sky.material.uniforms.nightFogColor.value.toArray(),
          fogStrength: sky.material.uniforms.nightFogStrength.value,
          mistVisible: mist.visible, mistAmount: mistUniforms.fogAmount.value, mistTime: mistUniforms.fogTime.value,
          deep: water.deepColor.value.toArray(), reflection: water.reflectionColor.value.toArray(),
          sunDirection: water.sunDirection.value.toArray(), moonDirection: water.moonDirection.value.toArray(),
          sunHighlight: water.sunHighlight.value, moonHighlight: water.moonHighlight.value,
          moonOpacity: moon.material.opacity, moonVisible: moon.visible,
          waterTime: water.time.value, boat: water.boatPosition.value.toArray(), boatSpeed: water.boatSpeed.value,
          shadows: scene.children.filter(o => o.isLight && o.castShadow).length,
        };
        const result = render.call(this, scene, camera);
        // Observe uploaded fog after Three.js converts the uniform. A resize
        // while paused renders again without lake.update() resetting its color.
        snapshot.waterFog = water.fogColor.value.toArray();
        const probe = window.lightingProbe;
        probe.first ??= snapshot; probe.last = snapshot; probe.renders++;
        probe.camera = camera.quaternion.toArray();
        probe.cameraHeight = camera.position.y;
        probe.moonScreen = moon.position.clone().project(camera).toArray();
        probe.performance = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
          programs: renderer.info.programs.length };
        probe.resourceCatalog = { cpuGeometryIds: [...cpuGeometries].sort((a, b) => a - b),
          initializedGeometryIds: [...initializedGeometries].sort((a, b) => a - b),
          programKeys: renderer.info.programs.map(program => program.cacheKey).sort(),
          fishingVisible: fishing.visible,
          fishing: fishing.children.filter(child => child.geometry).map(child => ({ id: child.geometry.id, type: child.geometry.type,
            initialized: initializedGeometries.has(child.geometry.id),
            programKeys: [...(renderer.properties.get(child.material).programs?.values() ?? [])].map(program => program.cacheKey).sort() })) };
        // Test-only paired render proves that low wisps contribute pixels;
        // production code exposes no scene controls or capture endpoint.
        probe.captureMistPair = () => {
          const visible = mist.visible;
          render.call(renderer, scene, camera);
          const withMist = renderer.domElement.toDataURL('image/png');
          mist.visible = false; render.call(renderer, scene, camera);
          const withoutMist = renderer.domElement.toDataURL('image/png');
          mist.visible = visible; render.call(renderer, scene, camera);
          return { withMist, withoutMist };
        };
        probe.uploadedWaterFog = water.fogColor.value.toArray();
        probe.outputFog = scene.fog.color.clone().convertLinearToSRGB().toArray();
        // Infer the optical target from the real layer clock/envelope, without
        // exporting a production game-clock or audio debug endpoint.
        const cycle = snapshot.mistTime % 360, phase = cycle - 180;
        const smooth = x => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
        const fade = cycle < 180 ? 0 : smooth(phase / 12) * smooth((180 - phase) / 12);
        probe.denseFade = fade > 0 && snapshot.fogStrength / fade > 0.9 ? fade : 0;
        return result;
      };
    });
  }, data);
  if (freeze) {
    await installPausedClock(page, now);
  }
  await page.goto('./');
  if (freeze) await tick(page);
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#error')).toBeHidden();
}

export function assertEnvironment(actual, elapsedSeconds) {
  const clock = createGameClock(undefined, { elapsedSeconds }).state;
  const expected = sampleDayNight(clock);
  const night = sampleNightFog(clock);
  expected.fogColor = new Color().fromArray(expected.horizon).lerp(new Color('#53646f'), night.effectiveFogAmount * 0.65).toArray();
  expected.moonOpacity *= (1 - night.effectiveFogAmount) ** 2;
  for (const [field, parameter] of Object.entries({ ambient: 'ambientIntensity', sun: 'sunIntensity', moon: 'moonIntensity',
    sky: 'skyDaylight', fog: 'fogColor', deep: 'waterDeep', reflection: 'waterReflection', sunDirection: 'sunDirection',
    moonDirection: 'moonDirection', sunHighlight: 'sunHighlight', moonHighlight: 'moonHighlight', moonOpacity: 'moonOpacity' })) {
    if (Array.isArray(expected[parameter])) expected[parameter].forEach((v, i) => expect(actual[field][i]).toBeCloseTo(v, 7));
    else expect(actual[field]).toBeCloseTo(expected[parameter], 7);
  }
  expect(actual.shadows).toBe(1);
  expect(actual.fogStrength).toBeCloseTo(night.effectiveFogAmount, 7);
  expect(actual.fogDensity).toBeCloseTo(getNightFogDensity(night.effectiveFogAmount), 9);
  expect(actual.mistAmount).toBeCloseTo(night.effectiveFogAmount, 7);
  expect(actual.mistVisible).toBe(night.effectiveFogAmount > 0);
  expect(actual.mistTime).toBeCloseTo(elapsedSeconds % 3600, 7);
  expect(actual.waterFogDensity).toBe(actual.fogDensity);
  const outputFog = new Color().fromArray(actual.fog).convertLinearToSRGB().toArray();
  actual.waterFog.forEach((v, i) => expect(v).toBeCloseTo(outputFog[i], 7));
  expect(actual.skyFog).toEqual(actual.fog);
}
