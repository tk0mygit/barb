import { expect } from '@playwright/test';
import { Color } from 'three';
import { sampleNightFog } from '../../src/world/night-fog.js';
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

export async function activateControl(page, id, touch) {
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
      renderer.render = function(scene, camera) {
        const ambient = scene.children.find(o => o.isHemisphereLight);
        const [sun, moonlight] = scene.children.filter(o => o.isDirectionalLight);
        const sky = scene.children.find(o => o.isSky), moon = scene.getObjectByName('moon');
        const water = scene.getObjectByName('lake-water').material.uniforms;
        const snapshot = {
          ambient: ambient.intensity, sun: sun.intensity, moon: moonlight.intensity,
          sky: sky.material.uniforms.skyDaylight.value, fog: scene.fog.color.toArray(),
          fogDensity: scene.fog.density, waterFogDensity: water.fogDensity.value,
          skyFog: sky.material.uniforms.nightFogColor.value.toArray(),
          fogStrength: sky.material.uniforms.nightFogStrength.value,
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
        probe.uploadedWaterFog = water.fogColor.value.toArray();
        probe.outputFog = scene.fog.color.clone().convertLinearToSRGB().toArray();
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

export function assertEnvironment(actual, elapsedSeconds) {
  const clock = createGameClock(undefined, { elapsedSeconds }).state;
  const expected = sampleDayNight(clock);
  const night = sampleNightFog(clock);
  expected.fogColor = new Color().fromArray(expected.horizon).lerp(new Color('#53646f'), night.intensity * 0.45).toArray();
  for (const [field, parameter] of Object.entries({ ambient: 'ambientIntensity', sun: 'sunIntensity', moon: 'moonIntensity',
    sky: 'skyDaylight', fog: 'fogColor', deep: 'waterDeep', reflection: 'waterReflection', sunDirection: 'sunDirection',
    moonDirection: 'moonDirection', sunHighlight: 'sunHighlight', moonHighlight: 'moonHighlight', moonOpacity: 'moonOpacity' })) {
    if (Array.isArray(expected[parameter])) expected[parameter].forEach((v, i) => expect(actual[field][i]).toBeCloseTo(v, 7));
    else expect(actual[field]).toBeCloseTo(expected[parameter], 7);
  }
  expect(actual.shadows).toBe(1);
  expect(actual.fogStrength).toBeCloseTo(night.intensity, 7);
  expect(actual.fogDensity).toBeCloseTo(0.0018 + (0.0052 - 0.0018) * night.intensity, 9);
  expect(actual.waterFogDensity).toBe(actual.fogDensity);
  const outputFog = new Color().fromArray(actual.fog).convertLinearToSRGB().toArray();
  actual.waterFog.forEach((v, i) => expect(v).toBeCloseTo(outputFog[i], 7));
  expect(actual.skyFog).toEqual(actual.fog);
}
