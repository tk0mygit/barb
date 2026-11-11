import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createStars, createStarAttributes, sampleStars, STAR_CONFIG } from '../src/world/stars.js';
import { createGameClock, GAME_CLOCK_CONFIG } from '../src/game/game-clock.js';
import { sampleNightFog } from '../src/world/night-fog.js';
import { createFishing } from '../src/game/fishing.js';
import { starSnapshot } from './helpers/star-snapshot.js';

const clock = seconds => createGameClock(undefined, { elapsedSeconds: seconds }).state;
test('960 deterministic directions, fixed hemisphere/radius, pale colors, bounded sizes and slow phases never use shared randomness', () => {
  const original = Math.random;
  Math.random = () => { throw new Error('shared random consumed'); };
  try {
    const a = createStarAttributes(); assert.deepEqual(createStarAttributes(), a);
    assert.equal(STAR_CONFIG.count, 960); assert.equal(STAR_CONFIG.nightSeconds, GAME_CLOCK_CONFIG.nightSeconds);
    assert.equal(a.positions.length, 2880); assert.equal(a.colors.length, 2880);
    assert.equal(Object.values(a).reduce((sum, array) => sum + array.byteLength, 0), 34560);
    const directions = new Set(); let bright = 0;
    for (let i = 0; i < 960; i++) {
      const p = a.positions.slice(i * 3, i * 3 + 3), color = a.colors.slice(i * 3, i * 3 + 3);
      assert(Math.abs(Math.hypot(...p) - 1200) < .0001); assert(p[1] > 30 && p[1] < 1200);
      directions.add(p.join(','));
      assert(color[0] >= .68 && color[0] <= .8 && color[0] < color[1] && color[1] < color[2]);
      assert(a.sizes[i] >= 1.6 && a.sizes[i] <= 3.25); if (a.sizes[i] === 3.25) bright++;
      else assert(a.sizes[i] < 2.35);
      assert(Number.isInteger(a.periods[i]) && a.periods[i] >= 4 && a.periods[i] <= 9);
      assert.equal(2520 % a.periods[i], 0); assert(a.phases[i] >= 0 && a.phases[i] < 2 * Math.PI);
    }
    assert.equal(directions.size, 960); assert.equal(bright, 34);
    assert(bright / 960 >= .03 && bright / 960 <= .05);
  } finally { Math.random = original; }
});

test('night AND CLEAR only; 12-second smooth fades have exact endpoints and preserve restored/large clocks', () => {
  for (const [phaseSeconds, opacity] of [[0, 0], [6, .5], [12, 1], [90, 1], [168, 1], [174, .5], [180, 0]]) {
    const c = { ...clock(1710), phaseProgress: phaseSeconds / 180 };
    assert.equal(sampleStars(c, 'CLEAR').opacity, opacity);
    for (const fog of ['FOG', 'DENSE_FOG']) assert.equal(sampleStars(c, fog).visible, false);
    assert.equal(sampleStars({ ...c, timeOfDay: 'day' }, 'CLEAR').visible, false);
  }
  for (const seconds of [0, 90, 180, 270, 630, 1710, 10 ** 12 + 270, 2 ** 48 + .25]) {
    const c = clock(seconds), fog = sampleNightFog(c), s = sampleStars(c, fog.fogType), target = {};
    assert.equal(sampleStars(c, fog.fogType, target), target); assert.deepEqual(target, s);
    assert(s.time >= 0 && s.time < 2520); assert.deepEqual(sampleStars(clock(seconds), fog.fogType), s);
    assert.equal(s.visible, c.timeOfDay === 'night' && fog.fogType === 'CLEAR' && s.opacity > 0);
  }
  const attrs = createStarAttributes();
  for (let i = 0; i < 960; i++) for (const seconds of [2519.99, 2520, 2520.01, 1e12 + .25]) {
    const value = t => 1 + STAR_CONFIG.amplitude * Math.sin(t * 2 * Math.PI / attrs.periods[i] + attrs.phases[i]);
    const reduced = value(seconds % 2520);
    assert(reduced >= .925 && reduced <= 1.075);
    // Stable CPU modulo is the authority; adding a whole wrap never changes phase.
    assert(Math.abs(reduced - value((seconds % 2520) + 2520)) < 1e-12);
  }
});

test('construct once; 30 nights/pauses/rotation/jumps retain buffers/material, center follows only boat translation; dispose once', () => {
  const original = Math.random; Math.random = () => { throw new Error('shared random consumed'); };
  try {
    const stars = createStars(), points = stars.points, geometry = points.geometry, material = points.material;
    const initial = starSnapshot(points), attributes = { ...geometry.attributes }, uniforms = material.uniforms;
    let geometryDisposals = 0, materialDisposals = 0;
    geometry.addEventListener('dispose', () => geometryDisposals++); material.addEventListener('dispose', () => materialDisposals++);
    for (let night = 0; night < 30; night++) for (const offset of [90, 180, 186, 270, 354, 360]) {
      const c = clock(night * 360 + offset), boat = { x: night * 5, z: -night, heading: night };
      stars.update(c, boat, sampleNightFog(c).fogType);
      assert.equal(points.geometry, geometry); assert.equal(points.material, material); assert.equal(material.uniforms, uniforms);
      assert.deepEqual(points.position.toArray(), [boat.x, 0, boat.z]); assert.deepEqual(points.quaternion.toArray(), [0, 0, 0, 1]);
      for (const [key, attribute] of Object.entries(attributes)) assert.equal(geometry.attributes[key], attribute);
      assert.deepEqual(starSnapshot(points).attributes, initial.attributes);
      const snapshot = starSnapshot(points); stars.update(c, boat, sampleNightFog(c).fogType); assert.deepEqual(starSnapshot(points), snapshot);
    }
    stars.dispose(); stars.dispose(); assert.equal(geometryDisposals, 1); assert.equal(materialDisposals, 1);
  } finally { Math.random = original; }
});

const source = readFileSync(new URL('../src/world/stars.js', import.meta.url), 'utf8');
let instrumentIndex = 0;
async function instrument(constructors) {
  const key = `__starConstructors${++instrumentIndex}`; globalThis[key] = { ...THREE, ...constructors };
  try { return await import(`data:text/javascript;base64,${Buffer.from(source.replace("import * as THREE from 'three';", `const THREE = globalThis[${JSON.stringify(key)}];`)).toString('base64')}`); }
  finally { delete globalThis[key]; }
}
function withCrypto(value, run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value });
  try { return run(); } finally { Object.defineProperty(globalThis, 'crypto', descriptor); }
}
test('all three constructor failures/thenables restore the exact RNG; missing/failing/reentrant crypto fails closed', async () => {
  const original = Math.random, spy = () => { throw new Error('domain consumed'); };
  for (const name of ['BufferGeometry', 'ShaderMaterial', 'Points']) for (const result of ['throw', 'promise', 'thenable']) {
    const module = await instrument({ [name]: function() {
      assert.notEqual(Math.random, spy);
      if (result === 'throw') throw new Error('deliberate');
      return result === 'promise' ? Promise.resolve({}) : { then() {} };
    } });
    Math.random = spy;
    try { assert.throws(() => module.createStars(), /deliberate|STOP: asynchronous/); assert.equal(Math.random, spy); }
    finally { Math.random = original; }
  }
  Math.random = spy;
  try {
    for (const crypto of [undefined, {}, { getRandomValues() { throw new Error('entropy failed'); } },
      { getRandomValues() { return Promise.resolve(); } }, { getRandomValues() { return createStars(); } }]) {
      withCrypto(crypto, () => assert.throws(createStars, /STOP|entropy failed/)); assert.equal(Math.random, spy);
    }
    const stars = createStars(); stars.dispose();
  } finally { Math.random = original; }
});

test('UUID entropy is confined to constructors, replenishes safely, rejects constructor reentry, and keeps UUIDs unique', async () => {
  const original = Math.random, spy = () => { throw new Error('shared random consumed'); };
  const methods = [[THREE.BufferGeometry.prototype, 'setAttribute'], [THREE.BufferGeometry.prototype, 'computeBoundingSphere']];
  const originals = methods.map(([object, key]) => object[key]);
  const nativeCrypto = globalThis.crypto, uuids = new Set(); let refills = 0;
  const module = await instrument({ Points: function(...args) {
    for (let i = 0; i < 40; i++) assert(Math.random() >= 0);
    return new THREE.Points(...args);
  } });
  let nested;
  const recursive = await instrument({ Points: function() { return nested(); } });
  nested = () => recursive.createStars();
  Math.random = spy;
  try {
    methods.forEach(([object, key], i) => { object[key] = function(...args) { assert.equal(Math.random, spy); return originals[i].apply(this, args); }; });
    for (let i = 0; i < 30; i++) {
      const stars = createStars();
      for (const object of [stars.points, stars.points.geometry, stars.points.material]) {
        assert.match(object.uuid, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
        assert(!uuids.has(object.uuid)); uuids.add(object.uuid);
      }
      stars.dispose(); assert.equal(Math.random, spy);
    }
    withCrypto({ getRandomValues(words) { refills++; return nativeCrypto.getRandomValues(words); } }, () => module.createStars().dispose());
    assert(refills >= 3);
    let first = true;
    withCrypto({ getRandomValues(words) { if (!first) throw new Error('refill failed'); first = false; return nativeCrypto.getRandomValues(words); } }, () => {
      assert.throws(() => module.createStars(), /refill failed/); assert.equal(Math.random, spy);
    });
    for (let i = 0; i < 2; i++) { assert.throws(nested, /STOP: reentrant/); assert.equal(Math.random, spy); }
  } finally { methods.forEach(([object, key], i) => { object[key] = originals[i]; }); Math.random = original; }
});

function domainRun(seed, withStars) {
  const original = Math.random, values = [], frames = [], bites = [];
  let rng = seed >>> 0, seconds = 0, stars;
  const random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; const v = rng / 4294967296; values.push(v); return v; };
  Math.random = random;
  try {
    const fishing = createFishing({ random, now: () => 1800000000000 + seconds * 1000, qte: { enabled: true, selectOperation: () => 'tap' } });
    if (withStars) stars = createStars();
    const factoryCalls = values.length;
    for (let trip = 0; trip < 3; trip++) {
      fishing.prepare({ x: 10, z: 20, heading: 0 }, 0); fishing.aim(0, 150); fishing.cast();
      let held = false;
      for (let i = 0; i < 2000 && fishing.state.phase !== 'result'; i++) {
        seconds += .25; fishing.step(.25);
        if (stars) { const c = clock(1710 + seconds); stars.update(c, { x: 10, z: 20, heading: i }, sampleNightFog(c).fogType); }
        frames.push(JSON.stringify(fishing.state));
        if (fishing.state.phase === 'bite') { bites.push({ seconds, encounter: structuredClone(fishing.state.encounter) }); fishing.hook(); }
        if (fishing.state.fight?.mode === 'awaiting-result') fishing.submitQteResult(fishing.state.fight.qte.token, true);
        if (fishing.state.inputOwner === 'normal') {
          if (fishing.state.tension < .35) held = true; else if (fishing.state.tension > .6) held = false;
          fishing.reel(held);
        }
      }
      assert.equal(fishing.state.phase, 'result'); fishing.closeResult();
    }
    return { factoryCalls, values, frames, bites, saved: JSON.stringify({ catches: fishing.collection.catches,
      wallet: fishing.collection.wallet, equipment: fishing.collection.equipment }) };
  } finally { stars?.dispose(); Math.random = original; }
}
test('five identical seeds preserve shared call/value streams, every fish/QTE state, BITE times and persisted collection bytes', t => {
  const summary = [];
  for (const seed of [1, 17, 0x534b5932, 0x12345678, 0xffffffff]) {
    const before = domainRun(seed, false), after = domainRun(seed, true); assert.deepEqual(after, before);
    summary.push({ seed, calls: after.values.length, bites: after.bites.map(b => b.seconds) });
  }
  t.diagnostic(JSON.stringify(summary));
});
