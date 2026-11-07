import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createFishingEffects } from '../src/rendering/fishing-effects.js';
import { createFishingView } from '../src/rendering/fishing.js';
import { createFishing } from '../src/game/fishing.js';
import { readMobileImplementation } from '../scripts/lib/mobile-comparison-source.js';
import { nativeFishingState } from '../scripts/lib/mobile-rod-reel-replay.js';
import { phaseCapture } from './helpers/fishing-phase-fixture.js';

const BASE = 'b562b3f4d9d39ed38b05049e2981923bac175cfc';
const source = readFileSync(new URL('../src/rendering/fishing-effects.js', import.meta.url), 'utf8');
let instrumentIndex = 0;
async function instrument(constructors) {
  const key = `__uuidConstructorTest${++instrumentIndex}`;
  globalThis[key] = { ...THREE, ...constructors };
  try {
    const text = source.replace("import * as THREE from 'three';", `const THREE = globalThis[${JSON.stringify(key)}];`);
    return await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`);
  } finally { delete globalThis[key]; }
}
function withCrypto(value, run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value });
  try { return run(); } finally { Object.defineProperty(globalThis, 'crypto', descriptor); }
}

test('only four synchronous constructors use crypto UUID entropy; scene/buffer methods observe the original spy', () => {
  const original = Math.random, randomSpy = () => { throw new Error('shared RNG consumed'); };
  const methods = [[THREE.Object3D.prototype, 'add'], [THREE.BufferGeometry.prototype, 'setAttribute'],
    [THREE.BufferGeometry.prototype, 'setDrawRange'], [THREE.BufferGeometry.prototype, 'computeBoundingSphere']];
  const originals = methods.map(([object, method]) => object[method]);
  Math.random = randomSpy;
  try {
    methods.forEach(([object, method], i) => { object[method] = function(...args) {
      assert.equal(Math.random, randomSpy, `${method} ran within UUID replacement`);
      return originals[i].apply(this, args);
    }; });
    const effects = createFishingEffects(); assert.equal(Math.random, randomSpy);
    effects.update({ phase: 'ready', revision: 0 }, true, 0, 10, 12);
    effects.dispose(); assert.equal(Math.random, randomSpy);
  } finally { methods.forEach(([object, method], i) => { object[method] = originals[i]; }); Math.random = original; }
  assert.doesNotMatch(source, /export\s+(?:function|const)\s+(?:construct|allocateResources|visualUuidRandom)/);
});

test('four new UUIDs are nonempty and unique within/across factories and existing scene objects', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), uuids = new Set([scene.uuid, camera.uuid]);
  const existing = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  for (const object of [existing, existing.geometry, existing.material]) uuids.add(object.uuid);
  const original = Math.random; let sharedCalls = 0;
  Math.random = () => { sharedCalls++; return .5; };
  try {
    for (let i = 0; i < 50; i++) {
      const effects = createFishingEffects(), mesh = effects.group.children[0];
      for (const object of [effects.group, mesh.material, mesh.geometry, mesh]) {
        assert.match(object.uuid, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
        assert(!uuids.has(object.uuid), 'UUID collision'); uuids.add(object.uuid);
      }
      effects.dispose();
    }
    assert.equal(sharedCalls, 0);
  } finally { Math.random = original; existing.geometry.dispose(); existing.material.dispose(); }
});

test('constructor exceptions, native Promises and thenables restore the exact mock reference', async () => {
  const original = Math.random, spy = () => { throw new Error('domain RNG consumed'); };
  for (const kind of ['Group', 'MeshBasicMaterial', 'BufferGeometry', 'Mesh']) {
    for (const result of ['throw', 'promise', 'thenable']) {
      const module = await instrument({ [kind]: function() {
        assert.notEqual(Math.random, spy);
        if (result === 'throw') throw new Error(`deliberate ${kind} failure`);
        return result === 'promise' ? Promise.resolve({}) : { then() {} };
      } });
      Math.random = spy;
      try {
        assert.throws(() => module.createFishingEffects(), /deliberate|STOP: asynchronous/);
        assert.equal(Math.random, spy);
      } finally { Math.random = original; }
    }
  }
});

test('missing/failed/async crypto stops before replacing Math.random and never falls back', () => {
  const original = Math.random, spy = () => { throw new Error('shared fallback'); };
  Math.random = spy;
  try {
    for (const crypto of [undefined, {}, { getRandomValues() { throw new Error('crypto unavailable'); } },
      { getRandomValues() { return Promise.resolve(); } }]) {
      withCrypto(crypto, () => assert.throws(() => createFishingEffects(), /STOP|crypto unavailable/));
      assert.equal(Math.random, spy);
    }
    const e = createFishingEffects(); e.dispose(); assert.equal(Math.random, spy, 'failed preflight left the factory locked');
  } finally { Math.random = original; }
});

test('reentry from entropy refill or a constructor rejects nested construction and restores both guards', async () => {
  const original = Math.random, spy = () => { throw new Error('domain RNG consumed'); };
  let nested;
  const module = await instrument({ Group: function() { return nested(); } });
  nested = () => module.createFishingEffects();
  Math.random = spy;
  try {
    for (let i = 0; i < 2; i++) {
      assert.throws(nested, /STOP: reentrant/); assert.equal(Math.random, spy);
    }
    withCrypto({ getRandomValues() { return createFishingEffects(); } }, () => {
      assert.throws(() => createFishingEffects(), /STOP: reentrant/); assert.equal(Math.random, spy);
    });
    const e = createFishingEffects(); e.dispose(); assert.equal(Math.random, spy);
  } finally { Math.random = original; }
});

test('crypto word buffers replenish independently without scheduler/shared RNG use; refill errors restore the caller', async () => {
  const nativeCrypto = globalThis.crypto, buffers = new Set(); let fills = 0;
  const module = await instrument({ Mesh: function(...args) {
    for (let i = 0; i < 20; i++) { const value = Math.random(); assert(value >= 0 && value < 1); }
    return new THREE.Mesh(...args);
  } });
  const original = Math.random, spy = () => { throw new Error('shared RNG consumed'); };
  Math.random = spy;
  try {
    withCrypto({ getRandomValues(words) { fills++; buffers.add(words); return nativeCrypto.getRandomValues(words); } }, () => {
      for (let i = 0; i < 2; i++) { const e = module.createFishingEffects(); e.dispose(); assert.equal(Math.random, spy); }
    });
    assert.equal(buffers.size, 2); assert(fills > buffers.size, 'no replenishment was exercised');
    let first = true;
    withCrypto({ getRandomValues(words) { if (!first) throw new Error('refill failure'); first = false; return nativeCrypto.getRandomValues(words); } }, () => {
      assert.throws(() => module.createFishingEffects(), /refill failure/); assert.equal(Math.random, spy);
    });
  } finally { Math.random = original; }
});

let basePromise;
async function baseSource() {
  if (!basePromise) basePromise = (async () => {
    const implementation = await readMobileImplementation(BASE), entry = await phaseCapture(implementation, 'pc-bite');
    let source;
    await nativeFishingState(implementation, entry.metrics.cameraFrames, frame => { source = frame.source; });
    return source;
  })();
  return basePromise;
}
function play(createDomain, createView, seed, aspect) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, aspect, .1, 2400), tip = new THREE.Vector3(10, 2, 20);
  camera.position.set(10, 2.15, 21.25);
  const original = Math.random, values = [], frames = [], trips = [];
  let rng = seed >>> 0, elapsed = 0;
  const sharedRandom = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; const v = rng / 4294967296; values.push(v); return v; };
  Math.random = sharedRandom;
  let view;
  try {
    const fishing = createDomain({ random: sharedRandom, now: () => Date.UTC(2026, 0, 1) + Math.round(elapsed * 1000),
      qte: { enabled: true, selectOperation: () => 'tap' } });
    view = createView(scene, camera);
    assert.equal(Math.random, sharedRandom);
    const factoryDraws = values.length;
    const record = () => {
      const before = JSON.stringify(fishing.state);
      view.update(fishing, true, elapsed, tip);
      assert.equal(JSON.stringify(fishing.state), before, 'view mutated domain');
      frames.push(before);
    };
    const step = () => { elapsed += .25; fishing.step(.25); record(); };
    for (let trip = 0; trip < 3; trip++) {
      assert.equal(fishing.prepare({ x: 10, z: 20, heading: 0 }, 0), true); fishing.aim(0, 150); fishing.cast(); record();
      const start = elapsed;
      for (let i = 0; i < 1000 && fishing.state.phase !== 'bite'; i++) step();
      assert.equal(fishing.state.phase, 'bite');
      const bite = { seconds: elapsed - start, encounter: structuredClone(fishing.state.encounter) };
      assert.equal(fishing.hook(), true); record();
      let held = false;
      for (let i = 0; i < 1000 && ['fight', 'landing'].includes(fishing.state.phase); i++) {
        if (fishing.state.fight?.mode === 'awaiting-result') {
          assert.equal(fishing.submitQteResult(fishing.state.fight.qte.token, true), true);
          record();
        }
        if (fishing.state.inputOwner === 'normal') {
          if (fishing.state.tension < .35) held = true;
          else if (fishing.state.tension > .6) held = false;
          fishing.reel(held);
        }
        step();
      }
      assert.equal(fishing.state.phase, 'result', 'controlled native domain trip did not land');
      trips.push({ bite, catch: structuredClone(fishing.state.catch) });
      assert.equal(fishing.closeResult(), true); record();
    }
    return { factoryDraws, values, frames, trips, collectionBytes: JSON.stringify({
      catches: fishing.collection.catches, wallet: fishing.collection.wallet, equipment: fishing.collection.equipment }) };
  } finally { view?.dispose?.(); Math.random = original; }
}

test('exact base replay: shared factory draws, RNG value stream, every state, QTE and three catches match for five seeds/two viewports', async t => {
  const base = await baseSource(), summary = [];
  for (const seed of [0x5f1b2026, 1, 17, 0x12345678, 0xffffffff]) for (const aspect of [1280 / 800, 390 / 844]) {
    // Compare renderer factories against the same domain in each pair. Phase
    // 6-A intentionally changes normalized species intervals; the twelve- and
    // twenty-species domains are both independently exercised without masking
    // state, QTE, camera, RNG or collection differences within either pair.
    for (const createDomain of [base.createFishing, createFishing]) {
    const before = play(createDomain, base.createFishingView, seed, aspect);
    const after = play(createDomain, createFishingView, seed, aspect);
    assert.equal(after.factoryDraws, before.factoryDraws, 'additional shared UUID RNG consumption');
    assert.deepEqual(after.values, before.values, 'domain random value stream changed');
    assert.deepEqual(after.frames, before.frames, 'phase/state/QTE history changed');
    assert.deepEqual(after.trips, before.trips, 'BITE time or species/length/weight/catch changed');
    assert.equal(after.collectionBytes, before.collectionBytes, 'persisted collection bytes changed');
    summary.push({ seed, aspect, factoryCalls: after.factoryDraws, bites: after.trips.map(t => t.bite.seconds), trips: after.trips.length });
    }
  }
  t.diagnostic(JSON.stringify({ sourceBase: BASE, matched: summary }));
});
