import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { meteorRoll, sampleMeteor, createMeteor, METEOR_CONFIG } from '../src/world/meteor.js';
import { createGameClock } from '../src/game/game-clock.js';
import { getNightFogProfile } from '../src/world/night-fog.js';
import { createFishing } from '../src/game/fishing.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { createSaveData, restoreSaveData } from '../src/game/save-data.js';
import { createLightingSave } from './helpers/lighting-save.js';
import { meteorSnapshot } from './helpers/meteor-snapshot.js';

const clock = seconds => createGameClock(undefined, { elapsedSeconds: seconds }).state;
const secondsFor = (night, slot, offset = .55) => night * 360 + 180 + slot * 10 + 5 + offset;
function winner(slot, start = 0) { for (let n = start; n < start + 20000; n++) if (meteorRoll(n, slot) < .005) return n; throw new Error('No winner'); }

test('18 independent p=.005 salted decimal draws retain high digits, multiple winners and weather independence without shared RNG', t => {
  assert.equal(METEOR_CONFIG.probability, .005); assert.equal(METEOR_CONFIG.slots, 18);
  const original = Math.random; Math.random = () => { throw new Error('shared RNG'); };
  try {
    const perSlot = Array(18).fill(0), perFog = { CLEAR: [0, 0], FOG: [0, 0], DENSE_FOG: [0, 0] };
    let any = 0, multiple = 0;
    for (let n = 0; n < 50000; n++) {
      let wins = 0;
      const weather = perFog[getNightFogProfile(n).fogType]; weather[1] += 18;
      for (let s = 0; s < 18; s++) {
        const roll = meteorRoll(n, s), hit = roll < .005;
        assert(roll >= 0 && roll < 1); if (hit) { perSlot[s]++; wins++; weather[0]++; }
      }
      if (wins) any++; if (wins > 1) multiple++;
    }
    for (const count of perSlot) assert(Math.abs(count - 250) < 75);
    for (const [wins, count] of Object.values(perFog)) assert(Math.abs(wins / count - .005) < .0007);
    assert(Math.abs(any / 50000 - (1 - .995 ** 18)) < .005); assert(multiple > 100);
    for (const n of [0, 1, 2 ** 32, 2 ** 40 + 17, Number.MAX_SAFE_INTEGER]) {
      const rolls = Array.from({ length: 18 }, (_, s) => meteorRoll(n, s));
      assert.deepEqual(rolls, Array.from({ length: 18 }, (_, s) => meteorRoll(n, s)));
      assert.equal(new Set(rolls).size, 18);
      assert.notDeepEqual(rolls, Array.from({ length: 18 }, (_, s) => meteorRoll(n, s, 'meteor-speed-sky3-v1')));
      if (n <= Number.MAX_SAFE_INTEGER - 2 ** 32) assert.notDeepEqual(rolls, Array.from({ length: 18 }, (_, s) => meteorRoll(n + 2 ** 32, s)));
    }
    for (const n of [-1, .5, NaN, Infinity, '0', Number.MAX_SAFE_INTEGER + 1]) assert.equal(meteorRoll(n, 0), 1);
    for (const s of [-1, .5, 18, NaN, Infinity, '0']) assert.equal(meteorRoll(0, s), 1);
    t.diagnostic(JSON.stringify({ nights: 50000, perSlot, any, multiple, perFog }));
  } finally { Math.random = original; }
});

test('all 18 midpoints, duration endpoints, CLEAR/night gates and restoration sample only the absolute current phase', () => {
  for (let s = 0; s < 18; s++) {
    const n = winner(s), start = secondsFor(n, s, 0);
    for (const dt of [-5, -1e-6, 0, 1.1, 1.100001, 4.99, 5]) assert.equal(sampleMeteor(clock(start + dt), 'CLEAR').visible, false);
    for (const dt of [.001, .1, .55, .8, 1.099]) {
      const sample = sampleMeteor(clock(start + dt), 'CLEAR');
      assert(sample.visible); assert.equal(sample.nightIndex, n); assert.equal(sample.slotIndex, s);
      assert(Math.abs(sample.progress - dt / 1.1) < 1e-9); assert(sample.opacity > 0 && sample.opacity <= 1);
      for (const fog of ['FOG', 'DENSE_FOG', null]) assert.equal(sampleMeteor(clock(start + dt), fog).visible, false);
      assert.equal(sampleMeteor({ ...clock(start + dt), timeOfDay: 'day' }, 'CLEAR').visible, false);
      assert.deepEqual(sampleMeteor(clock(start + dt), 'CLEAR'), sample);
    }
    for (const seconds of [n * 360, n * 360 + 180, (n + 1) * 360]) assert.equal(sampleMeteor(clock(seconds), 'CLEAR').visible, false);
  }
  const n = winner(0), restored = sampleMeteor(clock(secondsFor(n, 0, .8)), 'CLEAR');
  assert(Math.abs(1.1 - restored.age - .3) < 1e-9);
  for (const invalid of [null, {}, { ...clock(185.5), cycleSeconds: NaN }, { ...clock(185.5), elapsedSeconds: -1 },
    { ...clock(185.5), cycleSeconds: 179 }, { ...clock(185.5), phaseProgress: 2 }]) assert.equal(sampleMeteor(invalid, 'CLEAR').visible, false);
});

test('30/60/144fps, 100/250ms/2s steps, jumps and pauses never restart or accumulate a past slot', () => {
  const n = winner(0), start = secondsFor(n, 0, -.5);
  for (const step of [1 / 30, 1 / 60, 1 / 144, .1, .25, 2]) {
    const live = createGameClock(undefined, { elapsedSeconds: start });
    let previous = -1, active = false, appearances = 0;
    for (let i = 0; i < Math.ceil(4 / step); i++) {
      live.step(step); const sample = sampleMeteor(live.state, 'CLEAR');
      assert.deepEqual(sample, sampleMeteor(clock(live.state.elapsedSeconds), 'CLEAR'));
      if (sample.visible) { if (!active) appearances++; assert(sample.progress > previous); previous = sample.progress; }
      active = sample.visible;
      live.step(900, true); assert.deepEqual(sampleMeteor(live.state, 'CLEAR'), sample);
    }
    assert(appearances <= 1);
    live.step(36000); assert.equal(sampleMeteor(live.state, 'CLEAR').visible, false);
  }
});

test('one immutable quad/material for 30 nights, stable pause/resize samples, world directions, idempotent disposal and zero shared RNG', () => {
  const original = Math.random; Math.random = () => { throw new Error('domain RNG'); };
  try {
    const meteor = createMeteor(), mesh = meteor.mesh, geometry = mesh.geometry, material = mesh.material;
    const initial = meteorSnapshot(mesh), attributes = { ...geometry.attributes }, uniforms = material.uniforms;
    let gd = 0, md = 0; geometry.addEventListener('dispose', () => gd++); material.addEventListener('dispose', () => md++);
    for (let n = 0; n < 30; n++) for (let s = 0; s < 18; s++) {
      const c = clock(secondsFor(n, s)), boat = { x: n, z: -s };
      meteor.update(c, boat, 'CLEAR'); const before = meteorSnapshot(mesh);
      meteor.update(c, boat, 'CLEAR'); assert.deepEqual(meteorSnapshot(mesh), before);
      assert.equal(mesh.geometry, geometry); assert.equal(mesh.material, material); assert.equal(material.uniforms, uniforms);
      assert.deepEqual(before.attributes, initial.attributes);
      for (const [key, attribute] of Object.entries(attributes)) assert.equal(geometry.attributes[key], attribute);
      const rotation = mesh.quaternion.toArray(), p = mesh.position.toArray();
      meteor.update(c, { x: n + 100, z: -s - 200, heading: 3 }, 'CLEAR');
      assert.deepEqual(mesh.quaternion.toArray(), rotation);
      assert(Math.abs(mesh.position.x - p[0] - 100) < 1e-10); assert.equal(mesh.position.y, p[1]);
      assert(Math.abs(mesh.position.z - p[2] + 200) < 1e-10);
    }
    assert.equal(initial.attributes.position.count, 6); assert.equal(material.forceSinglePass, true);
    meteor.dispose(); meteor.dispose(); assert.equal(gd, 1); assert.equal(md, 1);
  } finally { Math.random = original; }
});

const source = readFileSync(new URL('../src/world/meteor.js', import.meta.url), 'utf8');
let instrumentIndex = 0;
async function instrument(constructors) {
  const key = `__meteorConstructors${++instrumentIndex}`; globalThis[key] = { ...THREE, ...constructors };
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
    try { assert.throws(() => module.createMeteor(), /deliberate|STOP: asynchronous/); assert.equal(Math.random, spy); }
    finally { Math.random = original; }
  }
  const crypto = globalThis.crypto, uuids = new Set(); let refills = 0;
  const module = await instrument({ Mesh: function(...args) { for (let i = 0; i < 40; i++) Math.random(); return new THREE.Mesh(...args); } });
  const setup = THREE.BufferGeometry.prototype.setAttribute;
  Math.random = spy;
  try {
    THREE.BufferGeometry.prototype.setAttribute = function(...args) { assert.equal(Math.random, spy); return setup.apply(this, args); };
    for (const value of [undefined, {}, { getRandomValues() { throw new Error('entropy failed'); } },
      { getRandomValues() { return Promise.resolve(); } }, { getRandomValues() { return createMeteor(); } }]) {
      withCrypto(value, () => assert.throws(createMeteor, /STOP|entropy failed/)); assert.equal(Math.random, spy);
    }
    for (let i = 0; i < 30; i++) {
      const m = createMeteor(); for (const object of [m.mesh, m.mesh.geometry, m.mesh.material]) { assert(!uuids.has(object.uuid)); uuids.add(object.uuid); } m.dispose();
    }
    withCrypto({ getRandomValues(words) { refills++; return crypto.getRandomValues(words); } }, () => module.createMeteor().dispose());
    assert(refills >= 3);
    let first = true;
    withCrypto({ getRandomValues(words) { if (!first) throw new Error('refill failed'); first = false; return crypto.getRandomValues(words); } }, () => assert.throws(() => module.createMeteor(), /refill failed/));
    assert.equal(Math.random, spy);
  } finally { THREE.BufferGeometry.prototype.setAttribute = setup; Math.random = original; }
});

function domainRun(seed, withMeteor) {
  const original = Math.random, values = [], frames = [], bites = [], receipts = [];
  let rng = seed >>> 0, seconds = 0, meteor;
  const random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; const value = rng / 4294967296; values.push(value); return value; };
  Math.random = random;
  try {
    const now = () => 1800000000000 + seconds * 1000;
    const fishing = createFishing({ random, now, collection: createCatchCollection({ now }), qte: { enabled: true, selectOperation: () => 'tap' } });
    if (withMeteor) meteor = createMeteor();
    const factoryCalls = values.length;
    for (let trip = 0; trip < 3; trip++) {
      fishing.prepare({ x: 10, z: 20, heading: 0 }, 0); fishing.aim(0, 150); fishing.cast(); let held = false;
      for (let i = 0; i < 2000 && fishing.state.phase !== 'result'; i++) {
        seconds += .25; fishing.step(.25); meteor?.update(clock(1710 + seconds), { x: 10, z: 20 }, 'CLEAR');
        frames.push(JSON.stringify(fishing.state));
        if (fishing.state.phase === 'bite') { bites.push({ seconds, encounter: structuredClone(fishing.state.encounter) }); fishing.hook(); }
        if (fishing.state.fight?.mode === 'awaiting-result') fishing.submitQteResult(fishing.state.fight.qte.token, true);
        if (fishing.state.inputOwner === 'normal') { if (fishing.state.tension < .35) held = true; else if (fishing.state.tension > .6) held = false; fishing.reel(held); }
      }
      assert.equal(fishing.state.phase, 'result'); receipts.push(fishing.sellResult()); fishing.closeResult();
    }
    const save = createLightingSave(secondsFor(winner(0), 0, .8)), restored = restoreSaveData(save);
    if (meteor) meteor.update(restored.clock.state, restored.boat, 'CLEAR');
    return { factoryCalls, values, frames, bites, receipts, saveBytes: JSON.stringify(createSaveData(restored, { savedAt: save.savedAt })),
      collection: JSON.stringify({ catches: fishing.collection.catches, wallet: fishing.collection.wallet, equipment: fishing.collection.equipment }) };
  } finally { meteor?.dispose(); Math.random = original; }
}
test('five identical seeds preserve RNG call/value streams, fish/QTE states, BITE times, sales and restored save bytes', () => {
  for (const seed of [1, 17, 0x534b5933, 0x12345678, 0xffffffff]) assert.deepEqual(domainRun(seed, true), domainRun(seed, false));
});
