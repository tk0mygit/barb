import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGameClock } from '../src/game/game-clock.js';
import { createEnvironmentParameters, sampleDayNight } from '../src/world/day-night.js';
import { createLake } from '../src/world/lake.js';
import { createBoatState } from '../src/game/boat.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { createAchievements } from '../src/game/achievements.js';
import { createSaveData, restoreSaveData } from '../src/game/save-data.js';

const at = elapsedSeconds => createGameClock(undefined, { elapsedSeconds }).state;
function close(a, b, tolerance = 1e-6) {
  if (Array.isArray(a)) a.forEach((value, i) => close(value, b[i], tolerance));
  else if (typeof a === 'object') Object.keys(a).forEach(key => close(a[key], b[key], tolerance));
  else assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
}

test('lighting is continuous across 180/360s without changing the gameplay phases', () => {
  for (const boundary of [180, 360, 720]) {
    assert.equal(at(boundary - 1e-5).timeOfDay, boundary === 180 ? 'day' : 'night');
    assert.equal(at(boundary).timeOfDay, boundary === 180 ? 'night' : 'day');
    const centre = sampleDayNight(at(boundary));
    close(sampleDayNight(at(boundary - 1e-5)), centre);
    close(sampleDayNight(at(boundary + 1e-5)), centre);
  }
  for (const seconds of [0, 25, 90, 165, 180, 200, 270, 345])
    close(sampleDayNight(at(seconds)), sampleDayNight(at(seconds + 360 * 100)), 1e-12);
});

test('full cycle has finite, bounded colors, readable night lighting and coherent sun/moon directions', () => {
  for (let seconds = 0; seconds < 360; seconds += 0.25) {
    const env = sampleDayNight(at(seconds));
    for (const [key, value] of Object.entries(env)) {
      for (const n of Array.isArray(value) ? value : [value]) {
        assert.ok(Number.isFinite(n), key);
        if (!key.endsWith('Direction')) assert.ok(n >= 0, key);
      }
    }
    close(Math.hypot(...env.sunDirection), 1);
    close(Math.hypot(...env.moonDirection), 1);
    close(env.sunDirection.map(v => -v), env.moonDirection);
    assert.ok(env.ambientIntensity >= 0.65 && env.ambientIntensity <= 2.4);
    assert.ok(env.sunIntensity <= 3.2 && env.moonIntensity <= 0.55);
  }
  const day = sampleDayNight(at(90)), night = sampleDayNight(at(270));
  assert.equal(day.moonOpacity, 0); assert.equal(day.moonIntensity, 0);
  assert.equal(night.sunIntensity, 0); assert.equal(night.moonOpacity, 1);
  assert.ok(night.moonIntensity > 0 && night.waterDeep[2] > night.waterDeep[0]);
  assert.ok(day.waterDeep.every((v, i) => v > night.waterDeep[i]));
  assert.ok(night.moonHighlight > 0 && night.moonHighlight < day.sunHighlight);
});

test('30/60/144fps, paused clocks and a large delta produce the same absolute environment', () => {
  for (const fps of [30, 60, 144]) {
    const clock = createGameClock();
    const target = createEnvironmentParameters(), deep = target.waterDeep;
    for (let second = 1; second <= 360; second++) {
      for (let frame = 0; frame < fps; frame++) clock.step(1 / fps);
      assert.equal(sampleDayNight(clock.state, target), target);
      close(target, sampleDayNight(at(second)), 1e-10);
    }
    const before = structuredClone(target);
    clock.step(100000, true);
    close(sampleDayNight(clock.state, target), before, 0);
    clock.step(360 * 100 + 270);
    close(sampleDayNight(clock.state, target), sampleDayNight(at(270)), 1e-10);
    assert.equal(target.waterDeep, deep);
  }
});

test('restored clock sets lights, sky, moon and water before any render; resources stay stable', () => {
  const collection = createCatchCollection(), achievements = createAchievements({ collection });
  const state = { collection, achievements, boat: createBoatState({ x: 10, z: 20, heading: 0.5 }),
    clock: createGameClock(undefined, { elapsedSeconds: 270 }) };
  const save = createSaveData(state), restored = restoreSaveData(save);
  const scene = new THREE.Scene(), lake = createLake(scene);
  lake.update(0, restored.boat, restored.clock.state);
  const ambient = scene.children.find(object => object.isHemisphereLight);
  const [sun, moonlight] = scene.children.filter(object => object.isDirectionalLight);
  const moon = scene.getObjectByName('moon'), water = scene.getObjectByName('lake-water');
  const sky = scene.children.find(object => object.isSky), env = sampleDayNight(at(270));
  assert.equal(ambient.intensity, env.ambientIntensity);
  assert.equal(sun.intensity, 0); assert.equal(moonlight.intensity, env.moonIntensity);
  assert.equal(sun.castShadow, true); assert.equal(moonlight.castShadow, false);
  assert.equal(moon.visible, true); assert.equal(sky.material.uniforms.skyDaylight.value, 0);
  close(water.material.uniforms.deepColor.value.toArray(), env.waterDeep);
  assert.equal(water.material.uniforms.fogColor.value, scene.fog.color);
  close(moonlight.position.clone().sub(moonlight.target.position).normalize().toArray(), env.moonDirection);
  close(water.material.uniforms.moonDirection.value.toArray(), env.moonDirection);
  const resources = [];
  scene.traverse(object => { resources.push(object, object.geometry, object.material); });
  const vectors = Object.values(water.material.uniforms).map(uniform => uniform.value);
  for (const seconds of [360, 90, 180, 270, 360 * 100 + 30])
    lake.update(seconds, { ...restored.boat, x: 30, speed: 4 }, at(seconds));
  const after = []; scene.traverse(object => { after.push(object, object.geometry, object.material); });
  assert.deepEqual(after, resources);
  Object.values(water.material.uniforms).forEach((uniform, i) => {
    if (typeof vectors[i] === 'object') assert.equal(uniform.value, vectors[i]);
  });
  assert.deepEqual(createSaveData(state).collection, save.collection);
  assert.deepEqual(achievements.snapshot, save.achievements);
});
