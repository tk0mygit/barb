import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAurora, sampleAurora, sampleAuroraLight, sampleAuroraEnvironment, AURORA_PALETTE } from '../src/world/aurora.js';
import { createGameClock } from '../src/game/game-clock.js';
import { createTimeSkip } from '../src/game/time-skip.js';
import { sampleDayNight } from '../src/world/day-night.js';
import { sampleNightFog } from '../src/world/night-fog.js';
import { createLake } from '../src/world/lake.js';
import { createWater } from '../src/world/water.js';
import { findAuroraNight } from './helpers/aurora-event.js';
import { createLightingSave } from './helpers/lighting-save.js';
import { restoreSaveData, createSaveData } from '../src/game/save-data.js';

const clock = seconds => createGameClock(undefined, { elapsedSeconds: seconds }).state;
const n = findAuroraNight({ forward: true }), peak = n * 360 + 270;
const lighting = state => sampleAuroraLight(sampleAurora(state, sampleNightFog(state).fogType));

test('the single Aurora sample controls light, exact fade, world direction and zero inactive outputs', () => {
  const aurora = createAurora(), sample = aurora.update(clock(peak), { x: 10, z: 20 }, 'CLEAR');
  const color = sample.lightColor, direction = sample.lightDirection;
  try {
    assert.equal(sample.lightStrength, .14); assert.equal(aurora.meshes[0].material.uniforms.auroraOpacity.value, sample.opacity);
    assert(Math.abs(Math.hypot(...direction) - 1) < 1e-15);
    for (const [offset, opacity] of [[0, 0], [7.5, .5], [15, 1], [90, 1], [165, 1], [172.5, .5], [180, 0]]) {
      const state = clock(n * 360 + 180 + offset), value = aurora.update(state, { x: 300, z: -80 }, 'CLEAR');
      assert.equal(value, sample); assert.equal(value.lightColor, color); assert.equal(value.lightDirection, direction);
      assert.equal(value.lightStrength, opacity * .14); assert.equal(value.opacity, opacity);
      if (!opacity) { assert.deepEqual(color, [0, 0, 0]); assert.deepEqual(direction, [0, 0]); }
    }
    for (const fog of ['FOG', 'DENSE_FOG']) {
      const value = aurora.update(clock(peak), { x: 10, z: 20 }, fog); assert.equal(value.lightStrength, 0); assert.deepEqual(value.lightColor, [0, 0, 0]);
    }
    for (const state of [clock(n * 360 + 90), clock(findAuroraNight({ selected: false }) * 360 + 270), null]) {
      const sample = sampleAurora(state, 'CLEAR'), light = sampleAuroraLight(sample);
      assert.equal(light.lightStrength, 0); assert.deepEqual(light.lightColor, [0, 0, 0]);
    }
    const valid = sampleAurora(clock(peak), 'CLEAR');
    for (const key of ['opacity', 'phase', 'time', 'hue', 'azimuth']) assert.equal(sampleAuroraLight({ ...valid, [key]: NaN }).lightStrength, 0);
    assert.equal(aurora.meshes[0].material.vertexShader, aurora.meshes[1].material.vertexShader);
    assert.equal(aurora.meshes[0].material.fragmentShader, aurora.meshes[1].material.fragmentShader);
    assert.equal(aurora.meshes[0].material.customProgramCacheKey(), aurora.meshes[1].material.customProgramCacheKey());
  } finally { aurora.dispose(); }
});

test('normal palettes remain immutable and repeated active/zero lighting cannot accumulate or retain color', () => {
  const output = { ambientSky: [0, 0, 0], ambientGround: [0, 0, 0] }, sky = output.ambientSky, ground = output.ambientGround;
  for (const seconds of [peak, n * 360 + 187.5, n * 360 + 352.5, n * 360 + 360, 90, 630, 1710, peak]) {
    const state = clock(seconds), base = sampleDayNight(state), original = structuredClone(base), light = lighting(state);
    sampleAuroraEnvironment(base, light, output);
    assert.deepEqual(base, original); assert.equal(output.ambientSky, sky); assert.equal(output.ambientGround, ground);
    const first = structuredClone(output); for (let i = 0; i < 100; i++) sampleAuroraEnvironment(base, light, output);
    assert.deepEqual(output, first); assert.deepEqual(base, original);
    const s = light.lightStrength;
    assert.equal(output.ambientIntensity, base.ambientIntensity + s * .3);
    for (let c = 0; c < 3; c++) {
      assert.equal(sky[c], s ? base.ambientSky[c] + (light.lightColor[c] - base.ambientSky[c]) * s : base.ambientSky[c]);
      assert.equal(ground[c], s ? base.ambientGround[c] + (light.lightColor[c] - base.ambientGround[c]) * s * .3 : base.ambientGround[c]);
    }
    sampleAuroraEnvironment(base, { lightStrength: 0 }, output);
    assert.deepEqual(output, { ambientSky: base.ambientSky, ambientGround: base.ambientGround, ambientIntensity: base.ambientIntensity });
    assert.throws(() => sampleAuroraEnvironment(base, light, base), /aliases/);
  }
});

test('water uses only three reused light uniforms and restores the normal 3-argument API exactly', () => {
  const water = createWater(), u = water.mesh.material.uniforms, base = sampleDayNight(clock(peak)), boat = { x: 10, z: 20, speed: 0 };
  const geometry = water.mesh.geometry, attrs = { ...geometry.attributes }, arrays = Object.values(attrs).map(a => a.array), light = lighting(clock(peak));
  const objects = [u.auroraColor.value, u.auroraDirection.value];
  water.update(10, boat, base, light); assert.equal(u.auroraStrength.value, .14); assert.deepEqual(u.auroraColor.value.toArray(), light.lightColor);
  const originalRandom = Math.random; Math.random = () => { throw new Error('shared RNG'); };
  try {
    for (let i = 0; i < 100; i++) water.update(i, boat, base, light);
    for (const inactive of [undefined, { lightStrength: 0 }, { lightStrength: NaN }]) {
      water.update(10, boat, base, inactive);
      assert.equal(u.auroraStrength.value, 0); assert.deepEqual(u.auroraColor.value.toArray(), [0, 0, 0]); assert.deepEqual(u.auroraDirection.value.toArray(), [0, 0]);
      assert.deepEqual(u.deepColor.value.toArray(), base.waterDeep); assert.deepEqual(u.reflectionColor.value.toArray(), base.waterReflection);
      assert.equal(u.moonHighlight.value, base.moonHighlight); assert.equal(u.sunHighlight.value, base.sunHighlight);
    }
  } finally { Math.random = originalRandom; }
  assert.equal(water.mesh.geometry, geometry); assert.deepEqual([u.auroraColor.value, u.auroraDirection.value], objects);
  Object.values(geometry.attributes).forEach((a, i) => { assert.equal(a, Object.values(attrs)[i]); assert.equal(a.array, arrays[i]); assert.equal(a.version, 0); });
});

test('31-night lake updates retain exactly the existing lights and all scene resources with no update-time RNG', () => {
  const scene = new THREE.Scene(), lake = createLake(scene), lights = scene.children.filter(o => o.isLight), resources = [];
  scene.traverse(o => { resources.push(o, o.geometry, o.material); });
  assert.equal(lights.length, 3); assert.equal(lights.filter(o => o.isHemisphereLight).length, 1); assert.equal(lights.filter(o => o.castShadow).length, 1);
  const water = scene.getObjectByName('lake-water'), u = water.material.uniforms, vectors = Object.fromEntries(Object.entries(u).map(([key, uniform]) => [key, uniform.value]));
  const originalRandom = Math.random; Math.random = () => { throw new Error('shared RNG'); };
  try {
    for (let night = n; night <= n + 30; night++) for (const offset of [180, 187.5, 270, 352.5, 360, 90]) {
      const state = clock(night * 360 + offset), base = sampleDayNight(state), light = lighting(state), expected = sampleAuroraEnvironment(base, light);
      lake.update(0, { x: 10, z: 20, heading: 0, speed: 0 }, state);
      const ambient = lights.find(o => o.isHemisphereLight);
      assert.deepEqual(ambient.color.toArray(), expected.ambientSky); assert.deepEqual(ambient.groundColor.toArray(), expected.ambientGround); assert.equal(ambient.intensity, expected.ambientIntensity);
      assert.equal(u.auroraStrength.value, light.lightStrength); assert.deepEqual(u.auroraColor.value.toArray(), light.lightColor);
      const after = []; scene.traverse(o => { after.push(o, o.geometry, o.material); }); assert.deepEqual(after, resources);
      for (const [key, uniform] of Object.entries(u)) if (typeof vectors[key] === 'object') assert.equal(uniform.value, vectors[key]);
    }
  } finally { Math.random = originalRandom; }
});

test('30/60/144fps, 18x SkyCheck, cancel/pause/restore and huge clocks directly resample both light consumers', () => {
  for (const fps of [30, 60, 144]) {
    const live = createGameClock(undefined, { elapsedSeconds: peak }), skip = createTimeSkip(live);
    assert.equal(skip.start(true), true);
    for (let frame = 0; frame < fps * 5; frame++) {
      skip.step(1 / fps); const sampled = lighting(live.state);
      assert.deepEqual(sampled, lighting(clock(live.state.elapsedSeconds)));
      const before = structuredClone(sampled); live.step(100, true); assert.deepEqual(lighting(live.state), before);
    }
    assert.equal(skip.active, false); assert.equal(lighting(live.state).lightStrength, 0);
    const normal = live.state.elapsedSeconds; skip.step(.25); assert.equal(live.state.elapsedSeconds, normal + .25);
  }
  const cancelClock = createGameClock(undefined, { elapsedSeconds: peak }), cancel = createTimeSkip(cancelClock);
  cancel.start(true); cancel.step(.5); const stopped = cancelClock.state.elapsedSeconds, color = lighting(cancelClock.state);
  cancel.cancel(); assert.deepEqual(lighting(cancelClock.state), color); cancel.step(.25);
  assert.equal(cancelClock.state.elapsedSeconds, stopped + .25);
  let large = 2 ** 40;
  while (!lighting(clock(large * 360 + 270)).lightStrength) large++;
  for (const start of [peak, large * 360 + 270]) {
    const save = createLightingSave(start), state = restoreSaveData(save), before = JSON.stringify(createSaveData(state, { savedAt: save.savedAt }));
    sampleAuroraEnvironment(sampleDayNight(state.clock.state), lighting(state.clock.state));
    assert.equal(JSON.stringify(createSaveData(state, { savedAt: save.savedAt })), before);
  }
  const appearance = sampleAurora(clock(peak), 'CLEAR');
  const a = sampleAuroraLight({ ...appearance, time: 0 }), b = sampleAuroraLight({ ...appearance, time: 720 });
  a.lightColor.forEach((value, i) => assert(Math.abs(value - b.lightColor[i]) < 1e-14));
  assert(Object.isFrozen(AURORA_PALETTE));
});
