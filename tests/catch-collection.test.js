import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { createFishing, PHASE } from '../src/game/fishing.js';
import { FISH_SPECIES } from '../src/game/fish-species.js';

const record = (id, lengthCm = 40, speciesId = 'black-bass') => ({
  schemaVersion: 1, id, speciesId, lengthCm, weightKg: 1.1,
  caughtAt: '2026-01-01T12:00:00.000Z', disposition: 'unassigned',
  conditions: { depthM: 5, timeOfDay: 'day', lureId: 'worm', lurePosition: { x: 2, z: 3 } },
});

test('empty collection exposes the 12 species in specification order and a serializable snapshot', () => {
  const collection = createCatchCollection();
  assert.deepEqual(collection.encyclopedia.map(entry => entry.speciesId), FISH_SPECIES.map(fish => fish.id));
  assert.ok(collection.encyclopedia.every(entry => entry.count === 0 && entry.maxLengthCm === null));
  assert.deepEqual(collection.stored, []);
  assert.deepEqual(JSON.parse(JSON.stringify(collection.snapshot)), collection.snapshot);
});

test('discovery and maximum length update on capture independently of storage', () => {
  const collection = createCatchCollection();
  collection.register(record('a')); collection.register(record('b', 35));
  collection.register(record('c', 52)); collection.register(record('d', 20, 'bluegill'));
  const before = collection.encyclopedia;
  assert.deepEqual(before[0], { speciesId: 'black-bass', count: 3, maxLengthCm: 52 });
  assert.deepEqual(before[2], { speciesId: 'bluegill', count: 1, maxLengthCm: 20 });
  assert.equal(collection.stored.length, 0);
  collection.store('b'); collection.store('c');
  assert.deepEqual(collection.encyclopedia, before);
  assert.equal(collection.catches.length, 4); assert.equal(collection.stored.length, 2);
  assert.deepEqual(collection.snapshot.storedIds, ['b', 'c']);
});

test('duplicate registration and repeated storage of the same individual are idempotent', () => {
  const collection = createCatchCollection();
  const original = collection.register(record('same'));
  assert.equal(collection.register(record('same', 55, 'smallmouth-bass')), original);
  const stored = collection.store('same');
  assert.equal(collection.store('same'), stored);
  assert.equal(collection.register(original), stored);
  assert.equal(collection.catches.length, 1); assert.equal(collection.stored.length, 1);
  assert.equal(collection.encyclopedia[0].count, 1); assert.equal(collection.encyclopedia[1].count, 0);
  assert.equal(collection.store('missing'), null);
});

test('immutable replacement preserves all capture fields, old snapshots and environment ownership', () => {
  const collection = createCatchCollection(), input = record('a');
  const captured = collection.register(input), before = collection.snapshot;
  input.conditions.lurePosition.x = 999; input.lengthCm = 1;
  assert.equal(captured.conditions.lurePosition.x, 2); assert.equal(captured.lengthCm, 40);
  const stored = collection.store('a');
  assert.notEqual(stored, captured); assert.equal(captured.disposition, 'unassigned');
  assert.deepEqual(stored, { ...captured, disposition: 'stored' });
  assert.equal(before.catches[0], captured); assert.deepEqual(before.storedIds, []);
  assert.equal(stored.conditions, captured.conditions);
  for (const object of [stored, stored.conditions, stored.conditions.lurePosition, collection.catches, collection.stored, collection.snapshot, collection.encyclopedia[0]]) assert.ok(Object.isFrozen(object));
  assert.throws(() => { stored.disposition = 'sold'; }, TypeError);
  assert.deepEqual(JSON.parse(JSON.stringify(collection.snapshot)), collection.snapshot);
});

test('storage has no capacity limit and rejects malformed captures without changing statistics', () => {
  const collection = createCatchCollection();
  for (let i = 0; i < 1000; i++) { collection.register(record(`fish-${i}`)); collection.store(`fish-${i}`); }
  assert.equal(collection.stored.length, 1000); assert.equal(collection.encyclopedia[0].count, 1000);
  const before = collection.snapshot;
  for (const input of [null, {}, { ...record('bad'), speciesId: 'missing' }, { ...record('bad'), lengthCm: NaN }, { ...record('bad'), caughtAt: 'invalid' }]) assert.throws(() => collection.register(input), TypeError);
  assert.deepEqual(collection.snapshot, before);
});

test('landing registers immediately; closing stores once and returns to ready without reusing IDs', () => {
  const fishing = createFishing({ random: () => 0.5, now: () => 1000 });
  for (let i = 0; i < 2; i++) {
    fishing.prepare({ x: 0, z: 30 }, 0); fishing.aim(0, 180); fishing.cast();
    while ([PHASE.CAST, PHASE.LURE].includes(fishing.state.phase)) fishing.step(1 / 60);
    assert.equal(fishing.hook(), true);
    let held = false;
    for (let frame = 0; frame < 1800 && fishing.state.phase === PHASE.FIGHT; frame++) {
      if (fishing.state.tension < 0.4) held = true;
      if (fishing.state.tension > 0.75) held = false;
      fishing.reel(held); fishing.step(1 / 60);
    }
    assert.equal(fishing.state.phase, PHASE.LANDING); fishing.step(2);
    assert.equal(fishing.state.phase, PHASE.RESULT);
    const caught = fishing.state.catch;
    assert.equal(fishing.state.catches.length, i + 1);
    assert.equal(fishing.collection.stored.length, i);
    assert.equal(fishing.collection.encyclopedia.find(entry => entry.speciesId === caught.speciesId).count, i + 1);
    assert.equal(fishing.closeResult(), true); assert.equal(fishing.closeResult(), false);
    assert.equal(fishing.state.phase, PHASE.READY); assert.equal(fishing.state.catch, null);
    assert.equal(fishing.collection.stored.length, i + 1);
    assert.equal(caught.disposition, 'unassigned');
  }
  assert.equal(new Set(fishing.state.catches.map(item => item.id)).size, 2);
});
