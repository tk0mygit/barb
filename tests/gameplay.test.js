import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGameplay } from '../src/game/gameplay.js';
import { createFishing } from '../src/game/fishing.js';
import { createSaveData, restoreSaveData } from '../src/game/save-data.js';
import { createSaveStorage, SAVE_STORAGE_KEYS as keys } from '../src/game/save-storage.js';
import { createQteOperationProvider } from '../src/game/qte-operation-provider.js';
import { estimateWaterDepth } from '../src/world/depth.js';
import { shoreRadius } from '../src/world/config.js';

const savedAt = '2026-10-31T00:00:00.000Z';
const legacy = JSON.parse(readFileSync(new URL('./fixtures/saves/lighting-save-v1.json', import.meta.url)));
function memory(data) {
  const raw = JSON.stringify({ storageVersion: 1, generation: 4, data });
  const map = new Map([[keys[0], raw]]), writes = [];
  return { map, writes, raw, getItem: key => map.get(key) ?? null,
    setItem(key, value) { writes.push(key); map.set(key, value); } };
}
function bite(fishing) {
  assert.equal(fishing.prepare({ x: 0, z: 30 }, 0), true);
  fishing.aim(0, 150); fishing.cast();
  for (let n = 0; fishing.state.phase !== 'bite' && n < 500; n++) fishing.step(.1);
  assert.equal(fishing.state.phase, 'bite');
}

test('one policy/factory constructs new, V1 and V2 fishing before subscribers; loading writes zero bytes', () => {
  for (const enabled of [false, true]) {
    const factory = options => createGameplay({ ...options, qteEnabled: enabled, random: () => .5 });
    const fresh = factory();
    const current = createSaveData(fresh, { savedAt });
    for (const data of [legacy, current]) {
      const storage = memory(data), manager = createSaveStorage({ getStorage: () => storage, gameplayFactory: factory });
      const restored = manager.load().state;
      assert.ok(restored); assert.equal(manager.load().state, restored);
      assert.equal(restored.fishing.collection, restored.collection);
      assert.equal(restored.fishing.state.phase, 'ready'); assert.equal(restored.qteProvider, null);
      assert.deepEqual(restored.achievements.snapshot, restoreSaveData(data).achievements.snapshot);
      assert.deepEqual(storage.writes, []); assert.equal(storage.map.get(keys[0]), storage.raw);
      bite(restored.fishing); assert.equal(restored.fishing.hook(), true);
      assert.equal(restored.fishing.state.fight.qte.enabled, enabled);
      assert.equal(restored.fishing.state.fight.qte.finiteDelivery, enabled);
      if (enabled) {
        const identity = { fightId: 1, speciesId: restored.fishing.state.encounter.speciesId,
          lengthCm: restored.fishing.state.encounter.lengthCm };
        assert.deepEqual(restored.qteProvider.identity, createQteOperationProvider(identity).identity);
      } else assert.equal(restored.qteProvider, null);
      assert.deepEqual(storage.writes, []);
    }
    bite(fresh.fishing); fresh.fishing.hook();
    assert.equal(fresh.fishing.state.fight.qte.enabled, enabled);
  }
});

test('provider binds the actual identity before selection, reuses descriptors, and changes only on next fight', () => {
  let calls = 0;
  const game = createGameplay({ qteEnabled: true, random: () => { calls++; return .5; } });
  for (let id = 1; id <= 3; id++) {
    bite(game.fishing); const before = calls;
    game.fishing.hook(); const provider = game.qteProvider;
    assert.equal(calls, before); assert.equal(provider.identity.fightId, id);
    const descriptor = provider.getDescriptor(0);
    game.fishing.reel(true);
    for (let n = 0; game.fishing.state.fight.mode === 'normal' && n < 1000; n++) game.fishing.step(1 / 60);
    assert.equal(game.fishing.state.fight.mode, 'warning');
    assert.equal(game.fishing.state.fight.qte.operation, descriptor.operation);
    assert.equal(game.qteProvider, provider); assert.equal(provider.getDescriptor(0), descriptor);
    assert.equal(new Set(provider.descriptors.map(d => d.operation)).size, 4);
    assert.equal(game.fishing.abortFight(), true); assert.equal(game.fishing.state.phase, 'ready');
    assert.equal(game.collection.catches.length, 0);
  }
});

test('shared OFF gameplay preserves existing encounter RNG and fixed-physics results against the prior assembly', () => {
  const currentDraws = [], oldDraws = [];
  const rng = record => { let seed = 1729; return () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    const value = seed / 4294967296; record.push(value); return value; }; };
  const game = createGameplay({ random: rng(currentDraws) });
  const old = createFishing({ random: rng(oldDraws),
    isWater: (x, z) => Math.hypot(x, z) < shoreRadius(Math.atan2(z, x)) - 2,
    getBoatPosition: () => game.boat,
    getEnvironment: position => ({ depthM: estimateWaterDepth(position), ...game.clock.state }),
  });
  for (const f of [game.fishing, old]) { bite(f); assert.equal(f.hook(), true); }
  assert.deepEqual(game.fishing.state.encounter, old.state.encounter);
  for (let n = 0; n < 600; n++) {
    const dt = [1 / 30, 1 / 60, 1 / 144, .25][n % 4];
    for (const f of [game.fishing, old]) { f.reel(f.state.tension < .6); f.step(dt); }
    assert.deepEqual(game.fishing.state.fight, old.state.fight);
  }
  assert.deepEqual(currentDraws, oldDraws); assert.equal(game.qteProvider, null);
});

test('factory failure never authorizes storage writes or retries restoration as an empty domain', () => {
  const storage = memory(legacy); let calls = 0;
  const manager = createSaveStorage({ getStorage: () => storage, gameplayFactory() { calls++; throw new Error('assembly failed'); } });
  const result = manager.load();
  assert.equal(result.state, null); assert.equal(result.status.code, 'restore-failed');
  assert.equal(result.status.canSave, false); assert.equal(manager.load().state, null); assert.equal(calls, 1);
  assert.equal(manager.save(legacy).ok, false); assert.deepEqual(storage.writes, []);
  assert.equal(storage.map.get(keys[0]), storage.raw);
  assert.match(readFileSync(new URL('../src/main.js', import.meta.url), 'utf8'), /loaded\.status\.code === 'restore-failed'\) throw/);
});

test('invalid and future saves never reach injected gameplay; defaults restore OFF with exact history', () => {
  let calls = 0;
  for (const bad of [{ ...legacy, saveVersion: 3 }, { ...legacy, boat: {} }]) {
    const storage = memory(bad), manager = createSaveStorage({ getStorage: () => storage, gameplayFactory() { calls++; } });
    assert.equal(manager.load().state, null); assert.equal(manager.status.canSave, false);
    assert.equal(manager.save(legacy).ok, false); assert.deepEqual(storage.writes, []);
  }
  assert.equal(calls, 0);
  const original = createSaveData(createGameplay(), { savedAt });
  const restored = restoreSaveData(original);
  assert.deepEqual(createSaveData(restored, { savedAt }), original);
  bite(restored.fishing); restored.fishing.hook(); assert.equal(restored.fishing.state.fight.qte.enabled, false);
});
