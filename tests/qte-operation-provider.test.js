import test from 'node:test';
import assert from 'node:assert/strict';
import { createQteOperationProvider } from '../src/game/qte-operation-provider.js';
import { hookedFight } from './helpers/fight-replay.js';

const identity = { fightId: 1, speciesId: 'black-bass', lengthCm: 42.5 };
test('provider v1 seed and immutable operation/direction golden vector; repeated selection is pure', () => {
  const p = createQteOperationProvider(identity), again = createQteOperationProvider({ ...identity });
  assert.equal(p.seed, 1583149326); assert.equal(p.seedKey, '["barb-qte-v1",1,"black-bass",425]');
  assert.deepEqual(p.descriptors.map(d => [d.operation, d.direction]), [['flick', 'left'], ['tap', null], ['swipe', 'right'], ['target', null]]);
  assert.deepEqual(p.descriptors, again.descriptors);
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.descriptors) && p.descriptors.every(Object.isFrozen));
  for (let i = 0; i < 4; i++) { assert.equal(p.getDescriptor(i), p.getDescriptor(i)); assert.equal(p.selectOperation({ index: i, difficulty: {} }), p.getDescriptor(i).operation); }
  for (const changes of [{ fightId: 2 }, { speciesId: 'bluegill' }, { lengthCm: 42.6 }]) assert.notEqual(createQteOperationProvider({ ...identity, ...changes }).seed, p.seed);
  assert.equal(createQteOperationProvider({ ...identity, speciesId: 'e\u0301' }).seedKey, createQteOperationProvider({ ...identity, speciesId: '\u00e9' }).seedKey);
  assert.notEqual(createQteOperationProvider({ ...identity, speciesId: 'black-bass ' }).seedKey, p.seedKey);
  for (const index of [-1, .5, 4, NaN]) assert.throws(() => p.getDescriptor(index), /index/);
  for (const changes of [{ fightId: 0 }, { fightId: 1.5 }, { speciesId: '' }, { lengthCm: 42.51 }, { lengthCm: Infinity }, { lengthCm: -1 }])
    assert.throws(() => createQteOperationProvider({ ...identity, ...changes }));
});
test('fixed multi-identity diagnostic reaches 24 permutations and four directions without repeat in a fight', t => {
  const counts = new Map(), directions = new Map();
  for (let fightId = 1; fightId <= 24000; fightId++) {
    const p = createQteOperationProvider({ ...identity, fightId, lengthCm: 20 + fightId % 600 / 10 });
    const key = p.descriptors.map(d => d.operation).join(','); counts.set(key, (counts.get(key) ?? 0) + 1);
    assert.equal(new Set(p.descriptors.slice(0, 3).map(d => d.operation)).size, 3);
    for (const d of p.descriptors.filter(d => d.direction)) directions.set(d.direction, (directions.get(d.direction) ?? 0) + 1);
    assert.ok(p.seed > 0);
  }
  assert.equal(counts.size, 24); assert.equal(directions.size, 4);
  const frequencies = [...counts.values()], chiSquared = frequencies.reduce((sum, n) => sum + (n - 1000) ** 2 / 1000, 0);
  // Fixed-seed diagnostic, not a proof of device input or mathematical RNG quality.
  assert.ok(chiSquared < 80, `fixed diagnostic chi-square=${chiSquared}`);
  t.diagnostic(JSON.stringify({ samples: 24000, permutations: counts.size, min: Math.min(...frequencies), max: Math.max(...frequencies), chiSquared,
    directions: Object.fromEntries(directions) }));
});
test('provider adds no fishing RNG calls, changes no encounter and survives pause without reselection', () => {
  const p = createQteOperationProvider({ fightId: 1, speciesId: 'alligator-gar', lengthCm: 300 });
  const a = hookedFight(), b = hookedFight({}, { qte: { enabled: false, selectOperation: p.selectOperation } });
  assert.deepEqual(a.f.state.encounter, b.f.state.encounter);
  for (let i = 0; i < 120; i++) { a.f.step(1 / 60); b.f.step(1 / 60); }
  assert.equal(a.calls(), b.calls());
  for (const key of ['distance', 'tension', 'normalSeconds', 'rngCalls']) assert.equal(a.f.state.fight[key], b.f.state.fight[key]);
  const { f, calls } = hookedFight({ speciesId: 'alligator-gar', size: 'max', rod: 10, reel: 10, startDistance: 4.51 },
    { qte: { enabled: true, delivery: 'finite', selectOperation: p.selectOperation } });
  f.reel(true); while (f.state.fight.mode === 'normal') f.step(1 / 60);
  const descriptor = p.getDescriptor(f.state.fight.qte.token.index), n = calls();
  f.pauseFight(); for (let i = 0; i < 100; i++) { f.step(.25); p.getDescriptor(0); } f.resumeFight();
  assert.equal(p.getDescriptor(0), descriptor); assert.equal(f.state.fight.qte.operation, descriptor.operation); assert.equal(calls(), n);
});
