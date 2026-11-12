import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { auroraRoll, sampleAurora, createAurora, AURORA_CONFIG } from '../src/world/aurora.js';
import { createGameClock } from '../src/game/game-clock.js';
import { getNightFogProfile } from '../src/world/night-fog.js';
import { createFishing } from '../src/game/fishing.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { createSaveData, restoreSaveData } from '../src/game/save-data.js';
import { createLightingSave } from './helpers/lighting-save.js';
import { auroraSnapshot } from './helpers/aurora-snapshot.js';

const clock = seconds => createGameClock(undefined, { elapsedSeconds: seconds }).state;
function winner(start = 0) {
  for (let n = start; n < start + 10000; n++) if (auroraRoll(n) < .2 && getNightFogProfile(n).fogType === 'CLEAR') return n;
  throw new Error('No ordinary CLEAR winner');
}

test('50,000 independent p=.20 night draws, conditional CLEAR rate, high digits and invalid input never consume gameplay RNG', t => {
  const original = Math.random; Math.random = () => { throw new Error('shared RNG'); };
  try {
    assert.equal(AURORA_CONFIG.probability, .2);
    const byWeather = { CLEAR: [0, 0], FOG: [0, 0], DENSE_FOG: [0, 0] };
    for (let n = 0; n < 50000; n++) {
      const weather = getNightFogProfile(n), before = structuredClone(weather), roll = auroraRoll(n);
      assert(roll >= 0 && roll < 1); assert.equal(roll, auroraRoll(n));
      byWeather[weather.fogType][1]++;
      if (roll < .2) byWeather[weather.fogType][0]++;
      for (const fog of Object.keys(byWeather)) {
        const sample = sampleAurora(clock(n * 360 + 270), fog);
        assert.equal(sample.selected, roll < .2); assert.equal(sample.visible, roll < .2 && fog === 'CLEAR');
      }
      assert.deepEqual(getNightFogProfile(n), before);
    }
    for (const [wins, count] of Object.values(byWeather)) assert(Math.abs(wins / count - .2) < .012);
    assert(Math.abs(byWeather.CLEAR[0] / 50000 - .08) < .005);
    for (const n of [0, 1, 2 ** 32, 2 ** 40 + 17, Number.MAX_SAFE_INTEGER]) {
      assert.equal(auroraRoll(n), auroraRoll(n)); assert.notEqual(auroraRoll(n), auroraRoll(n, 'aurora-folds-sky4-v1'));
      if (n <= Number.MAX_SAFE_INTEGER - 2 ** 32) assert.notEqual(auroraRoll(n), auroraRoll(n + 2 ** 32));
    }
    for (const n of [-1, .5, NaN, Infinity, '0', Number.MAX_SAFE_INTEGER + 1]) assert.equal(auroraRoll(n), 1);
    for (const salt of [null, '', 123]) assert.equal(auroraRoll(0, salt), 1);
    t.diagnostic(JSON.stringify({ nights: 50000, byWeather, clearConditional: byWeather.CLEAR[0] / byWeather.CLEAR[1], allNights: byWeather.CLEAR[0] / 50000 }));
  } finally { Math.random = original; }
});

test('15s envelope is continuous at both 180/360 boundaries; mismatched clock state fails closed explicitly', () => {
  const n = winner();
  for (const [seconds, opacity] of [[0, 0], [7.5, .5], [15, 1], [90, 1], [165, 1], [172.5, .5], [180, 0]]) {
    const sample = sampleAurora(clock(n * 360 + 180 + seconds), 'CLEAR');
    assert.equal(sample.valid, true); assert.equal(sample.opacity, opacity); assert.equal(sample.visible, opacity > 0);
    for (const fog of ['FOG', 'DENSE_FOG']) assert.equal(sampleAurora(clock(n * 360 + 180 + seconds), fog).visible, false);
  }
  for (const boundary of [n * 360 + 180, (n + 1) * 360]) {
    for (const offset of [-.00001, 0, .00001]) assert(sampleAurora(clock(boundary + offset), 'CLEAR').opacity < 1e-10);
  }
  for (const n of [winner(2 ** 32), winner(2 ** 40)]) {
    const sample = sampleAurora(clock(n * 360 + 270), 'CLEAR'); assert.equal(sample.nightIndex, n); assert.equal(sample.visible, true);
  }
  const good = clock(n * 360 + 270);
  for (const invalid of [null, {}, ...['elapsedSeconds', 'cycleSeconds', 'cycleProgress', 'phaseProgress'].flatMap(key =>
    [{ ...good, [key]: NaN }, { ...good, [key]: Infinity }, { ...good, [key]: -1 }]),
    { ...good, timeOfDay: 'day' }, { ...good, cycleSeconds: good.cycleSeconds + .001 },
    { ...good, elapsedSeconds: good.elapsedSeconds + 1 }, { ...good, phaseProgress: .1 }]) {
    const sample = sampleAurora(invalid, 'CLEAR'); assert.equal(sample.valid, false); assert.equal(sample.visible, false); assert.equal(sample.opacity, 0);
  }
  assert.equal(sampleAurora(good, 'unknown').valid, false);
});

test('FPS, jumps, pause/resume and save restore directly sample time; wrapped shader frequencies are continuous', () => {
  const n = winner();
  for (const dt of [1 / 30, 1 / 60, 1 / 144, .1, .25, 2]) {
    const live = createGameClock(undefined, { elapsedSeconds: n * 360 + 175 });
    for (let i = 0; i < Math.ceil(190 / dt); i++) {
      live.step(dt); const sample = sampleAurora(live.state, 'CLEAR');
      assert.deepEqual(sample, sampleAurora(clock(live.state.elapsedSeconds), 'CLEAR'));
      live.step(900, true); assert.deepEqual(sampleAurora(live.state, 'CLEAR'), sample);
    }
    live.step(360000.8); assert.deepEqual(sampleAurora(live.state, 'CLEAR'), sampleAurora(clock(live.state.elapsedSeconds), 'CLEAR'));
  }
  for (const seconds of [n * 360 + 187.5, n * 360 + 352.5, 2 ** 40 * 360 + 270]) {
    const saved = createLightingSave(seconds), restored = restoreSaveData(saved);
    assert.deepEqual(sampleAurora(restored.clock.state, 'CLEAR'), sampleAurora(clock(seconds), 'CLEAR'));
    const canonical = createSaveData(restored, { savedAt: saved.savedAt });
    assert.equal(JSON.stringify(createSaveData(restoreSaveData(canonical), { savedAt: saved.savedAt })), JSON.stringify(canonical));
  }
  const wrap = AURORA_CONFIG.timeWrapSeconds;
  for (const frequency of [2, 3, 4]) {
    const before = Math.sin((wrap - 1e-7) * 2 * Math.PI / wrap * frequency);
    const after = Math.sin(1e-7 * 2 * Math.PI / wrap * frequency);
    assert(Math.abs(before - after) < 1e-8);
  }
});

test('30 nights keep exactly one geometry, two material identities, immutable buffers, world direction and idempotent disposal', () => {
  const original = Math.random; Math.random = () => { throw new Error('domain RNG'); };
  try {
    const aurora = createAurora(), [a, b] = aurora.meshes, geometry = a.geometry;
    assert.equal(geometry, b.geometry); assert.notEqual(a.material, b.material);
    const initial = auroraSnapshot(aurora.meshes), attributes = { ...geometry.attributes }, index = geometry.index;
    const uniforms = aurora.meshes.map(mesh => mesh.material.uniforms);
    let disposedGeometry = 0, disposedMaterials = 0;
    geometry.addEventListener('dispose', () => disposedGeometry++);
    for (const mesh of aurora.meshes) mesh.material.addEventListener('dispose', () => disposedMaterials++);
    for (let n = 0; n < 30; n++) for (const phase of [180, 187.5, 195, 270, 345, 352.5, 359.9]) {
      const state = clock(n * 360 + phase), boat = { x: n, z: -n };
      aurora.update(state, boat, 'CLEAR'); const before = auroraSnapshot(aurora.meshes);
      aurora.update(state, boat, 'CLEAR'); assert.deepEqual(auroraSnapshot(aurora.meshes), before);
      assert.deepEqual(before.attributes, initial.attributes); assert.deepEqual(before.indices, initial.indices);
      assert.equal(geometry.index, index);
      for (const key of Object.keys(attributes)) assert.equal(geometry.attributes[key], attributes[key]);
      aurora.update(state, { x: boat.x + 100, z: boat.z - 200, heading: 2 }, 'CLEAR');
      aurora.meshes.forEach((mesh, layer) => {
        assert.equal(mesh.geometry, geometry); assert.equal(mesh.material.uniforms, uniforms[layer]);
        assert.equal(mesh.material.id, initial.layers[layer].materialId);
        assert.deepEqual(mesh.quaternion.toArray().map(value => value === 0 ? 0 : value), before.layers[layer].quaternion);
        assert.deepEqual(mesh.position.toArray(), [boat.x + 100, 0, boat.z - 200]);
      });
    }
    assert.equal(a.material.vertexShader, b.material.vertexShader); assert.equal(a.material.fragmentShader, b.material.fragmentShader);
    assert.equal(a.material.customProgramCacheKey(), b.material.customProgramCacheKey());
    for (const mesh of aurora.meshes) {
      assert.equal(mesh.material.forceSinglePass, true); assert.equal(mesh.material.depthTest, true);
      assert.equal(mesh.material.depthWrite, false); assert.equal(mesh.material.fog, false); assert.equal(mesh.renderOrder, -2);
    }
    aurora.dispose(); aurora.dispose(); assert.equal(disposedGeometry, 1); assert.equal(disposedMaterials, 2);
  } finally { Math.random = original; }
});
const source = readFileSync(new URL('../src/world/aurora.js', import.meta.url), 'utf8');
let instrumentIndex = 0;
async function instrument(constructors) {
  const key = `__auroraConstructors${++instrumentIndex}`; globalThis[key] = { ...THREE, ...constructors };
  try { return await import(`data:text/javascript;base64,${Buffer.from(source.replace("import * as THREE from 'three';", `const THREE = globalThis[${JSON.stringify(key)}];`)).toString('base64')}`); }
  finally { delete globalThis[key]; }
}
function withCrypto(value, run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value });
  try { return run(); } finally { Object.defineProperty(globalThis, 'crypto', descriptor); }
}
test('constructor throws/thenables, crypto failure/reentry and entropy refill restore the exact shared RNG', async () => {
  const original = Math.random, spy = () => { throw new Error('domain consumed'); };
  for (const name of ['BufferGeometry', 'ShaderMaterial', 'Mesh']) for (const result of ['throw', 'thenable']) {
    const module = await instrument({ [name]: function() {
      assert.notEqual(Math.random, spy); if (result === 'throw') throw new Error('deliberate'); return { then() {} };
    } });
    Math.random = spy;
    try { assert.throws(() => module.createAurora(), /deliberate|STOP: asynchronous/); assert.equal(Math.random, spy); }
    finally { Math.random = original; }
  }
  const crypto = globalThis.crypto, uuids = new Set(); let refills = 0;
  const module = await instrument({ Mesh: function(...args) { for (let i = 0; i < 40; i++) Math.random(); return new THREE.Mesh(...args); } });
  const setup = THREE.BufferGeometry.prototype.setAttribute;
  Math.random = spy;
  try {
    THREE.BufferGeometry.prototype.setAttribute = function(...args) { assert.equal(Math.random, spy); return setup.apply(this, args); };
    for (const value of [undefined, {}, { getRandomValues() { throw new Error('entropy failed'); } },
      { getRandomValues() { return Promise.resolve(); } }, { getRandomValues(words) { return words; } },
      { getRandomValues(words) { words[0] = 1; return words.subarray(0, 1); } }, { getRandomValues() { return createAurora(); } }]) {
      withCrypto(value, () => assert.throws(createAurora, /STOP|entropy failed/)); assert.equal(Math.random, spy);
    }
    for (let i = 0; i < 30; i++) {
      const m = createAurora(); for (const object of [m.meshes[0].geometry, ...m.meshes, ...m.meshes.map(mesh => mesh.material)]) { assert(!uuids.has(object.uuid)); uuids.add(object.uuid); } m.dispose();
    }
    withCrypto({ getRandomValues(words) { refills++; return crypto.getRandomValues(words); } }, () => module.createAurora().dispose());
    assert(refills >= 3);
    let first = true;
    withCrypto({ getRandomValues(words) { if (!first) throw new Error('refill failed'); first = false; return crypto.getRandomValues(words); } }, () => assert.throws(() => module.createAurora(), /refill failed/));
    assert.equal(Math.random, spy);
  } finally { THREE.BufferGeometry.prototype.setAttribute = setup; Math.random = original; }
});

function domainRun(seed, withAurora) {
  const original = Math.random, values = [], frames = [], bites = [], receipts = [];
  let rng = seed >>> 0, seconds = 0, aurora;
  const random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; const value = rng / 4294967296; values.push(value); return value; };
  Math.random = random;
  try {
    const now = () => 1800000000000 + seconds * 1000;
    const fishing = createFishing({ random, now, collection: createCatchCollection({ now }), qte: { enabled: true, selectOperation: () => 'tap' } });
    if (withAurora) aurora = createAurora();
    const factoryCalls = values.length;
    for (let trip = 0; trip < 3; trip++) {
      fishing.prepare({ x: 10, z: 20, heading: 0 }, 0); fishing.aim(0, 150); fishing.cast(); let held = false;
      for (let i = 0; i < 2000 && fishing.state.phase !== 'result'; i++) {
        seconds += .25; fishing.step(.25); aurora?.update(clock(1710 + seconds), { x: 10, z: 20 }, 'CLEAR');
        frames.push(JSON.stringify(fishing.state));
        if (fishing.state.phase === 'bite') { bites.push({ seconds, encounter: structuredClone(fishing.state.encounter) }); fishing.hook(); }
        if (fishing.state.fight?.mode === 'awaiting-result') fishing.submitQteResult(fishing.state.fight.qte.token, true);
        if (fishing.state.inputOwner === 'normal') { if (fishing.state.tension < .35) held = true; else if (fishing.state.tension > .6) held = false; fishing.reel(held); }
      }
      assert.equal(fishing.state.phase, 'result'); receipts.push(fishing.sellResult()); fishing.closeResult();
    }
    const save = createLightingSave(winner() * 360 + 270), restored = restoreSaveData(save);
    if (aurora) aurora.update(restored.clock.state, restored.boat, 'CLEAR');
    return { factoryCalls, values, frames, bites, receipts, saveBytes: JSON.stringify(createSaveData(restored, { savedAt: save.savedAt })),
      collection: JSON.stringify({ catches: fishing.collection.catches, wallet: fishing.collection.wallet, equipment: fishing.collection.equipment }) };
  } finally { aurora?.dispose(); Math.random = original; }
}
test('five identical seeds preserve RNG call/value streams, fish/QTE states, BITE times, sales and restored save bytes', () => {
  for (const seed of [1, 17, 0x534b5933, 0x12345678, 0xffffffff]) assert.deepEqual(domainRun(seed, true), domainRun(seed, false));
});
