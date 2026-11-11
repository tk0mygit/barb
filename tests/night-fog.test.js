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

test('salted stable profiles distribute 40/30/30 across separated ranges of 100000 nights', t => {
  assert.deepEqual([NIGHT_FOG_CONFIG.clearProbability, NIGHT_FOG_CONFIG.fogProbability, NIGHT_FOG_CONFIG.denseProbability], [0.4, 0.3, 0.3]);
  assert.equal(NIGHT_FOG_CONFIG.clearProbability + NIGHT_FOG_CONFIG.fogProbability + NIGHT_FOG_CONFIG.denseProbability, 1);
  for (const [start, expectedCounts] of [[0, [39786, 30138, 30076]], [1_000_000, [40186, 29809, 30005]],
    [2 ** 32, [39865, 30192, 29943]], [2 ** 40, [39853, 29835, 30312]]]) {
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
    assert.deepEqual([counts.CLEAR, counts.FOG, counts.DENSE_FOG], expectedCounts);
    let chiSquare = 0;
    for (const [type, expected] of Object.entries({ CLEAR: 0.4, FOG: 0.3, DENSE_FOG: 0.3 })) {
      near(counts[type] / 100000, expected, 0.01);
      chiSquare += (counts[type] - 100000 * expected) ** 2 / (100000 * expected);
    }
    // Pearson goodness of fit, two degrees of freedom; reject at p < 0.001.
    const pValue = Math.exp(-chiSquare / 2);
    assert.ok(pValue >= 0.001, `${start}: chi-square ${chiSquare}, p=${pValue}`);
    near(sum / counts.FOG, 0.5, 0.003);
    near(square / counts.FOG - (sum / counts.FOG) ** 2, 0.4 ** 2 / 12, 0.001);
    for (const count of bins) near(count / counts.FOG, 0.25, 0.015);
    t.diagnostic(`${start}: ${JSON.stringify(counts)}, FOG mean ${sum / counts.FOG}, chi-square ${chiSquare}, p=${pValue}`);
  }
  assert.deepEqual(Array.from({ length: 12 }, (_, i) => getNightFogProfile(i).fogType),
    ['FOG', 'DENSE_FOG', 'DENSE_FOG', 'FOG', 'CLEAR', 'FOG', 'CLEAR', 'FOG', 'DENSE_FOG', 'DENSE_FOG', 'FOG', 'DENSE_FOG']);
  for (const invalid of [-1, 0.5, NaN, Infinity, undefined]) assert.equal(getNightFogProfile(invalid).fogType, FOG_TYPE.CLEAR);
});

test('profiles keep their amounts after cache eviction and never consume shared Math.random', t => {
  t.mock.method(Math, 'random', () => assert.fail('weather must not consume the fishing random stream'));
  for (const [index, type, amount] of [[0, 'FOG', 0.3396991244517267], [4, 'CLEAR', 0],
    [7615, 'FOG', 0.3000874656252563], [3971, 'FOG', 0.4999069510959089], [2859, 'FOG', 0.6997745639644563],
    [8301, 'DENSE_FOG', 0.95], [5825, 'DENSE_FOG', 0.95], [1, 'DENSE_FOG', 0.95]]) {
    const profile = getNightFogProfile(index);
    assert.equal(profile.fogType, type); near(profile.targetFogAmount, amount);
    assert.equal(getNightFogProfile(index), profile); assert.ok(Object.isFrozen(profile));
    getNightFogProfile(2 ** 40 + index);
    assert.deepEqual(getNightFogProfile(index), profile);
    assert.equal(sampleNightFog(at(index * 360 + 270)).targetFogAmount, amount);
  }
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

test('save V3 round trips preserve settings, clock and collection fields', () => {
  const collection = createCatchCollection(), achievements = createAchievements({ collection });
  for (const seconds of [270, 630, 906, 990, 2790, 3150, 1074, 1080, 360 * 100000 + 270]) {
    const state = { collection, achievements, boat: createBoatState(), clock: createGameClock(undefined, { elapsedSeconds: seconds }) };
    const save = createSaveData(state), restored = restoreSaveData(JSON.parse(JSON.stringify(save)));
    assert.deepEqual(sampleNightFog(restored.clock.state), sampleNightFog(state.clock.state));
    assert.equal(save.saveVersion, 3); assert.deepEqual(save.settings, {}); assert.deepEqual(save.clock, { elapsedSeconds: seconds });
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
  const material = mist.children[0].material, uniforms = material.uniforms, color = uniforms.fogTint.value, drift = uniforms.fogDrift.value;
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
    assert.equal(uniforms.fogDrift.value, drift);
    near(drift.x, Math.sin((seconds % 3600) * 2 * Math.PI / 3600) * 34);
    near(drift.y, Math.cos((seconds % 3600) * 2 * Math.PI / 3600) * 22);
    assert.equal(uniforms.fogTime.value, seconds % 3600); assert.equal(uniforms.fogAmount.value, fog.effectiveFogAmount);
    near(uniforms.fogAmount.value * uniforms.fogOpacityScale.value, Math.min(fog.targetFogAmount, 0.7) * fog.intensity);
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
