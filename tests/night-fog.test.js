import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGameClock } from '../src/game/game-clock.js';
import { getNightFogProfile, NIGHT_FOG_CONFIG, FOG_TYPE, sampleNightFog, getNightFogDensity } from '../src/world/night-fog.js';
import { createLake } from '../src/world/lake.js';
import { createSurfaceFog } from '../src/world/surface-fog.js';
import { sampleDayNight } from '../src/world/day-night.js';
import { createBoatState } from '../src/game/boat.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { createAchievements } from '../src/game/achievements.js';
import { createSaveData, restoreSaveData } from '../src/game/save-data.js';

const at = elapsedSeconds => createGameClock(undefined, { elapsedSeconds }).state;
const near = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test('salted stable profiles distribute 50/35/15 across separated ranges of 100000 nights', t => {
  assert.equal(NIGHT_FOG_CONFIG.clearProbability + NIGHT_FOG_CONFIG.fogProbability + NIGHT_FOG_CONFIG.denseProbability, 1);
  for (const start of [0, 1_000_000, 2 ** 32, 2 ** 40]) {
    const counts = { CLEAR: 0, FOG: 0, DENSE_FOG: 0 }, bins = [0, 0, 0, 0];
    let sum = 0, square = 0;
    for (let index = start; index < start + 100000; index++) {
      const profile = getNightFogProfile(index);
      assert.deepEqual(getNightFogProfile(index), profile);
      counts[profile.fogType]++;
      near(profile.visibilityClarity, 1 - profile.targetFogAmount);
      if (profile.fogType === FOG_TYPE.FOG) {
        assert.ok(profile.targetFogAmount >= 0.3 && profile.targetFogAmount <= 0.7);
        sum += profile.targetFogAmount; square += profile.targetFogAmount ** 2;
        bins[Math.min(3, Math.floor((profile.targetFogAmount - 0.3) * 10))]++;
      } else assert.equal(profile.targetFogAmount, profile.fogType === FOG_TYPE.CLEAR ? 0 : 0.95);
    }
    for (const [type, expected] of Object.entries({ CLEAR: 0.5, FOG: 0.35, DENSE_FOG: 0.15 })) near(counts[type] / 100000, expected, 0.01);
    near(sum / counts.FOG, 0.5, 0.003);
    near(square / counts.FOG - (sum / counts.FOG) ** 2, 0.4 ** 2 / 12, 0.001);
    for (const count of bins) near(count / counts.FOG, 0.25, 0.015);
    t.diagnostic(`${start}: ${JSON.stringify(counts)}, FOG mean ${sum / counts.FOG}`);
  }
  assert.deepEqual(Array.from({ length: 12 }, (_, i) => getNightFogProfile(i).fogType),
    ['CLEAR', 'DENSE_FOG', 'DENSE_FOG', 'CLEAR', 'CLEAR', 'CLEAR', 'CLEAR', 'FOG', 'FOG', 'FOG', 'FOG', 'DENSE_FOG']);
  for (const invalid of [-1, 0.5, NaN, Infinity, undefined]) assert.equal(getNightFogProfile(invalid).fogType, FOG_TYPE.CLEAR);
});

test('day is clear, night classification and amount stay fixed, and 12s envelopes are continuous', () => {
  for (const index of [0, 1, 2, 7, 8, 9, 1000, 2 ** 32]) {
    const profile = getNightFogProfile(index);
    for (const [phase, fade] of [[0, 0], [6, 0.5], [12, 1], [90, 1], [168, 1], [174, 0.5], [179.99, null]]) {
      const day = sampleNightFog(at(index * 360 + phase));
      assert.equal(day.fogType, FOG_TYPE.CLEAR); assert.equal(day.intensity, 0); assert.equal(day.effectiveFogAmount, 0);
      assert.equal(day.visibilityClarity, 1);
      const night = sampleNightFog(at(index * 360 + 180 + phase));
      assert.equal(night.fogType, profile.fogType); assert.equal(night.targetFogAmount, profile.targetFogAmount);
      if (fade !== null) near(night.intensity, profile.fogType === FOG_TYPE.CLEAR ? 0 : fade);
      near(night.effectiveFogAmount, profile.targetFogAmount * night.intensity);
    }
  }
  for (const boundary of [180, 360, 540, 552, 708, 720, 900, 1080]) {
    const before = sampleNightFog(at(boundary - 1e-4)), centre = sampleNightFog(at(boundary)), after = sampleNightFog(at(boundary + 1e-4));
    near(before.effectiveFogAmount, centre.effectiveFogAmount, 1e-8); near(after.effectiveFogAmount, centre.effectiveFogAmount, 1e-8);
    near((after.effectiveFogAmount - before.effectiveFogAmount) / 2e-4, 0, 1e-5);
  }
});

test('30/60/144fps, pause, long frames and whole-cycle jumps match absolute samples', () => {
  for (const fps of [30, 60, 144]) {
    const clock = createGameClock(), target = {};
    for (let second = 1; second <= 1080; second++) {
      for (let frame = 0; frame < fps; frame++) clock.step(1 / fps);
      assert.equal(sampleNightFog(clock.state, target), target);
      const expected = sampleNightFog(at(second));
      for (const key of Object.keys(expected)) {
        if (typeof expected[key] === 'number') near(target[key], expected[key]); else assert.equal(target[key], expected[key]);
      }
    }
    const before = { ...sampleNightFog(clock.state) }; clock.step(360000, true);
    assert.deepEqual(sampleNightFog(clock.state), before);
    for (const dt of [0.5, 4, 360 * 100000 + 123.5]) { clock.step(dt); assert.deepEqual(sampleNightFog(clock.state), sampleNightFog(at(clock.state.elapsedSeconds))); }
  }
});

test('relative visibility at 30m is exact; dense fog still allows near-boat identification', () => {
  const base = getNightFogDensity(0), transmittance = (density, d) => Math.exp(-((density * d) ** 2));
  assert.equal(base, 0.0018);
  for (const amount of [0, 0.15, 0.3, 0.5, 0.7, 0.95]) near(transmittance(getNightFogDensity(amount), 30) / transmittance(base, 30), 1 - amount);
  const dense = getNightFogDensity(0.95);
  const values = [5, 10, 20, 30].map(d => transmittance(dense, d) / transmittance(base, d));
  assert.ok(values[0] > 0.9); near(values[1], 0.7169, 0.001); near(values[2], 0.2639, 0.001); near(values[3], 0.05);
  for (const invalid of [-1, 1, NaN, Infinity]) assert.throws(() => getNightFogDensity(invalid));
});

test('save v1 round trips change no schema, settings, clock or collection fields', () => {
  const collection = createCatchCollection(), achievements = createAchievements({ collection });
  for (const seconds of [270, 630, 906, 990, 2790, 3150, 1074, 1080, 360 * 100000 + 270]) {
    const state = { collection, achievements, boat: createBoatState(), clock: createGameClock(undefined, { elapsedSeconds: seconds }) };
    const save = createSaveData(state), restored = restoreSaveData(JSON.parse(JSON.stringify(save)));
    assert.deepEqual(sampleNightFog(restored.clock.state), sampleNightFog(state.clock.state));
    assert.equal(save.saveVersion, 1); assert.deepEqual(save.settings, {}); assert.deepEqual(save.clock, { elapsedSeconds: seconds });
    assert.deepEqual(createSaveData(restored).collection, save.collection);
  }
});

test('surface wisps and fog reuse geometry/uniforms, align water/sky, obscure the moon without losing light', () => {
  const scene = new THREE.Scene(), lake = createLake(scene), boat = createBoatState();
  const water = scene.getObjectByName('lake-water'), sky = scene.children.find(o => o.isSky), mist = scene.getObjectByName('surface-fog');
  const resources = []; scene.traverse(o => resources.push(o, o.geometry, o.material));
  assert.equal(mist.children.length, 3);
  assert.equal(new Set(mist.children.map(o => o.geometry)).size, 1);
  assert.equal(new Set(mist.children.map(o => o.material)).size, 1);
  const material = mist.children[0].material, uniforms = material.uniforms, color = uniforms.fogTint.value;
  assert.equal(material.forceSinglePass, true); assert.equal(material.depthWrite, false); assert.equal(material.depthTest, true); assert.equal(material.transparent, true);
  assert.ok(water.material.fragmentShader.indexOf('#include <fog_fragment>') > water.material.fragmentShader.indexOf('#include <colorspace_fragment>'));
  for (const seconds of [90, 270, 540, 546, 552, 630, 714, 720, 2790, 3150, 360 * 100000 + 270]) {
    const clock = at(seconds), fog = sampleNightFog(clock), env = sampleDayNight(clock);
    lake.update(0, boat, clock);
    near(scene.fog.density, getNightFogDensity(fog.effectiveFogAmount));
    const expected = new THREE.Color().fromArray(env.horizon).lerp(new THREE.Color('#53646f'), fog.effectiveFogAmount * 0.65);
    assert.deepEqual(scene.fog.color.toArray(), expected.toArray());
    assert.deepEqual(water.material.uniforms.fogColor.value.toArray(), expected.toArray());
    assert.deepEqual(sky.material.uniforms.nightFogColor.value.toArray(), expected.toArray());
    assert.equal(mist.visible, fog.effectiveFogAmount > 0); assert.equal(uniforms.fogTint.value, color);
    assert.equal(uniforms.fogTime.value, seconds % 3600); assert.equal(uniforms.fogAmount.value, fog.effectiveFogAmount);
    near(scene.getObjectByName('moon').material.opacity, env.moonOpacity * (1 - fog.effectiveFogAmount) ** 2);
    assert.equal(scene.children.find(o => o.isHemisphereLight).intensity, env.ambientIntensity);
    assert.equal(scene.children.filter(o => o.isDirectionalLight)[1].intensity, env.moonIntensity);
    const after = []; scene.traverse(o => after.push(o, o.geometry, o.material)); assert.deepEqual(after, resources);
  }
  const factory = createSurfaceFog(); let disposed = 0;
  factory.group.children[0].geometry.addEventListener('dispose', () => disposed++);
  factory.group.children[0].material.addEventListener('dispose', () => disposed++);
  factory.dispose(); assert.equal(disposed, 2);
});
