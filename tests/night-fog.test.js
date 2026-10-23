import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGameClock } from '../src/game/game-clock.js';
import { hasNightFog, NIGHT_FOG_CONFIG, sampleNightFog } from '../src/world/night-fog.js';
import { createLake } from '../src/world/lake.js';
import { sampleDayNight } from '../src/world/day-night.js';
import { createBoatState } from '../src/game/boat.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { createAchievements } from '../src/game/achievements.js';
import { createSaveData, restoreSaveData } from '../src/game/save-data.js';

const at = elapsedSeconds => createGameClock(undefined, { elapsedSeconds }).state;
const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('stable night mapping has approximately 30% fog over early, late and >32-bit indices', t => {
  assert.equal(NIGHT_FOG_CONFIG.probability, 0.3);
  for (const start of [0, 1_000_000, 2 ** 32, 2 ** 40]) {
    let foggy = 0;
    for (let index = start; index < start + 100_000; index++) {
      const result = hasNightFog(index);
      assert.equal(result, hasNightFog(index));
      foggy += result;
    }
    const ratio = foggy / 100_000;
    assert.ok(ratio > 0.29 && ratio < 0.31, `${start}: ${ratio}`);
    t.diagnostic(`nights ${start}..${start + 99_999}: ${foggy}/100000 (${ratio * 100}%)`);
  }
  // Pin save-v1 compatibility, not merely repeatability within one execution.
  assert.deepEqual(Array.from({ length: 10 }, (_, i) => hasNightFog(i)),
    [false, false, true, true, false, true, true, false, false, true]);
  assert.notDeepEqual(Array.from({ length: 100 }, (_, i) => hasNightFog(i)),
    Array.from({ length: 100 }, (_, i) => hasNightFog(i + 2 ** 32)));
  for (const invalid of [-1, 0.5, NaN, Infinity, undefined]) assert.equal(hasNightFog(invalid), false);
});

test('every daytime is clear and each night has one decision across all of its frames', () => {
  for (const index of [0, 1, 2, 3, 4, 1000, 2 ** 32]) {
    for (const phase of [0, 6, 12, 90, 168, 174, 179.99]) {
      const day = sampleNightFog(at(index * 360 + phase));
      assert.equal(day.nightIndex, index);
      assert.equal(day.isFoggyNight, false); assert.equal(day.intensity, 0);
      const night = sampleNightFog(at(index * 360 + 180 + phase));
      assert.equal(night.nightIndex, index);
      assert.equal(night.isFoggyNight, hasNightFog(index));
      assert.ok(night.intensity >= 0 && night.intensity <= 1);
      if (!night.isFoggyNight) assert.equal(night.intensity, 0);
    }
  }
  assert.equal(sampleNightFog(at(360 + 270)).isFoggyNight, false);
  assert.equal(sampleNightFog(at(720 + 270)).isFoggyNight, true);
});

test('fog rises and falls over 12 seconds with continuous values and slopes at night/day boundaries', () => {
  const start = 2 * 360 + 180, end = 3 * 360;
  for (const [offset, expected] of [[0, 0], [6, 0.5], [12, 1], [90, 1], [168, 1], [174, 0.5], [180, 0]])
    near(sampleNightFog(at(start + offset)).intensity, expected);
  for (const boundary of [start, start + 12, end - 12, end]) {
    const before = sampleNightFog(at(boundary - 1e-4)).intensity;
    const centre = sampleNightFog(at(boundary)).intensity;
    const after = sampleNightFog(at(boundary + 1e-4)).intensity;
    near(before, centre, 1e-8); near(after, centre, 1e-8);
    near((after - before) / 2e-4, 0, 1e-5);
  }
});

test('30/60/144fps, pauses, low fps and multi-cycle jumps sample the current shared clock', () => {
  for (const fps of [30, 60, 144]) {
    const clock = createGameClock(), target = {};
    for (let second = 1; second <= 1080; second++) {
      for (let frame = 0; frame < fps; frame++) clock.step(1 / fps);
      assert.equal(sampleNightFog(clock.state, target), target);
      const expected = sampleNightFog(at(second));
      assert.equal(target.nightIndex, expected.nightIndex);
      assert.equal(target.isFoggyNight, expected.isFoggyNight);
      near(target.intensity, expected.intensity);
    }
    clock.step(720 + 186);
    const before = { ...sampleNightFog(clock.state) };
    clock.step(36000, true);
    assert.deepEqual(sampleNightFog(clock.state), before);
    for (const dt of [0.5, 4, 360 * 100_000 + 123.5]) {
      clock.step(dt);
      assert.deepEqual(sampleNightFog(clock.state), sampleNightFog(at(clock.state.elapsedSeconds)));
    }
  }
});

test('v1 round trips preserve the first fog state without new save fields', () => {
  const collection = createCatchCollection(), achievements = createAchievements({ collection });
  for (const seconds of [270, 906, 990, 1074, 1080, 360 * 100_000 + 270]) {
    const state = { collection, achievements, boat: createBoatState(), clock: createGameClock(undefined, { elapsedSeconds: seconds }) };
    const data = createSaveData(state), restored = restoreSaveData(JSON.parse(JSON.stringify(data)));
    assert.deepEqual(sampleNightFog(restored.clock.state), sampleNightFog(state.clock.state));
    assert.equal(data.saveVersion, 1); assert.deepEqual(data.clock, { elapsedSeconds: seconds });
    assert.deepEqual(data.settings, {});
  }
});

test('fog shares terrain/water density and color, leaves clear-night/day lighting intact, and reuses resources', () => {
  const scene = new THREE.Scene(), lake = createLake(scene), boat = createBoatState();
  const water = scene.getObjectByName('lake-water'), sky = scene.children.find(o => o.isSky);
  const resources = [];
  scene.traverse(o => resources.push(o, o.geometry, o.material));
  const fog = scene.fog, uniforms = water.material.uniforms;
  const fogColor = uniforms.fogColor.value, skyFogColor = sky.material.uniforms.nightFogColor.value;
  assert.equal(water.material.fog, true);
  // Use Three's shared view-depth, output-color fog chunks in both materials.
  assert.ok(water.material.vertexShader.includes('#include <fog_vertex>'));
  assert.ok(water.material.fragmentShader.indexOf('#include <fog_fragment>') > water.material.fragmentShader.indexOf('#include <colorspace_fragment>'));
  assert.notEqual(fogColor, scene.fog.color); // renderer color conversion must not mutate the scene
  for (const seconds of [90, 270, 900, 906, 912, 990, 1074, 1080, 360 * 100_000 + 270]) {
    const clock = at(seconds), night = sampleNightFog(clock), env = sampleDayNight(clock);
    lake.update(0, boat, clock);
    const expectedColor = new THREE.Color().fromArray(env.horizon).lerp(new THREE.Color('#53646f'), night.intensity * 0.45);
    near(scene.fog.density, 0.0018 + (0.0052 - 0.0018) * night.intensity);
    assert.deepEqual(scene.fog.color.toArray(), expectedColor.toArray());
    assert.equal(uniforms.fogDensity.value, scene.fog.density);
    assert.deepEqual(fogColor.toArray(), scene.fog.color.toArray());
    assert.deepEqual(skyFogColor.toArray(), scene.fog.color.toArray());
    assert.equal(sky.material.uniforms.nightFogStrength.value, night.intensity);
    assert.deepEqual(uniforms.deepColor.value.toArray(), env.waterDeep);
    assert.equal(scene.children.find(o => o.isHemisphereLight).intensity, env.ambientIntensity);
    assert.equal(uniforms.fogColor.value, fogColor); assert.equal(scene.fog, fog);
    const after = []; scene.traverse(o => after.push(o, o.geometry, o.material));
    assert.deepEqual(after, resources);
  }
  // Near-boat visibility remains almost unaffected at peak density.
  assert.ok(1 - Math.exp(-((20 * 0.0052) ** 2)) < 0.011);
});
