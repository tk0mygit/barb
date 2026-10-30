import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { calculateSalePrice } from '../src/game/fish-sales.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { createAchievements } from '../src/game/achievements.js';
import { createSaveData, restoreSaveData, parseSaveData, serializeSaveData } from '../src/game/save-data.js';
import { createBoatState } from '../src/game/boat.js';
import { createGameClock } from '../src/game/game-clock.js';
import { PHASE } from '../src/game/fishing.js';
import { hookedFight } from './helpers/fight-replay.js';
import { operationSetup } from './helpers/qte-operations.js';
import { fishSpeciesSandbox } from './helpers/fish-species-sandbox.js';

const savedAt = '2026-10-31T00:00:00.000Z';
const capture = (id, base, qteSuccessCount) => ({ schemaVersion: 1, id, speciesId: 'black-bass',
  lengthCm: 40, weightKg: base === 0 ? 0.001 : base / 100, caughtAt: savedAt, qteSuccessCount });
const save = state => createSaveData(state, { savedAt });
function session(collection = createCatchCollection({ now: () => Date.parse(savedAt) })) {
  return { collection, achievements: createAchievements({ collection, now: () => Date.parse(savedAt) }),
    boat: createBoatState(), clock: createGameClock() };
}

test('24 prices: additive ten percentage points per success, half-up once, zero and minimum +1', () => {
  const matrix = [
    [0, [0, 0, 0, 0]], [1, [1, 2, 2, 2]], [14, [14, 15, 17, 18]],
    [25, [25, 28, 30, 33]], [100, [100, 110, 120, 130]], [1000, [1000, 1100, 1200, 1300]],
  ];
  assert.equal(calculateSalePrice.length, 1);
  for (const [base, expected] of matrix) {
    const records = expected.map((_, n) => capture(`${base}-${n}`, base, n));
    // map's index and array must never be interpreted as a success count.
    assert.deepEqual(records.map(calculateSalePrice), expected, `B=${base}`);
    assert.ok(records.every(record => !Object.hasOwn(record, 'salePrice')));
  }
  assert.notEqual(calculateSalePrice(capture('not-two-percent', 1000, 1)), 1020);
  assert.notEqual(calculateSalePrice(capture('not-compound', 1000, 2)), 1210);
  for (const [base, expected] of [[24, 26], [25, 28], [26, 29]])
    assert.equal(calculateSalePrice(capture('bonus-half', base, 1)), expected);
  // The original base itself rounds before the bonus: 24.4999 / 24.5 / 24.5001.
  for (const [weightKg, expected] of [[0.244999, 26], [0.245, 28], [0.245001, 28]])
    assert.equal(calculateSalePrice({ ...capture('base-half', 25, 1), weightKg }), expected);
});

test('invalid explicit counts, including undefined, reject; only live QTE-OFF registration may omit one', () => {
  const c = createCatchCollection(), original = c.register(capture('same', 100, 2));
  const before = c.snapshot;
  for (const n of [-1, 0.5, 4, NaN, Infinity, '1', null, undefined, true]) {
    assert.throws(() => calculateSalePrice(capture('bad', 100, n)), RangeError);
    assert.throws(() => c.register(capture('bad', 100, n)), TypeError);
    assert.throws(() => c.register(capture('same', 100, n)), TypeError);
    assert.deepEqual(c.snapshot, before);
  }
  assert.equal(c.register(capture('same', 100, 3)), original);
  const off = capture('off', 100, 0); delete off.qteSuccessCount;
  assert.throws(() => calculateSalePrice(off), RangeError);
  assert.equal(c.register(off).qteSuccessCount, 0);
});

test('BigInt final-price boundaries reject the next integer for all four counts without clamping', async t => {
  // A test-only unit-price species reaches each exact safe-integer boundary;
  // production species, prices and the public function interface are unchanged.
  const sandbox = await fishSpeciesSandbox(t);
  const path = join(sandbox.root, 'src/game/fish-species.js'), source = await readFile(path, 'utf8');
  const changed = source.replace('  basePricePerKg: 100,', '  basePricePerKg: 1,');
  assert.notEqual(source, changed); await writeFile(path, changed);
  const { calculateSalePrice: price } = await sandbox.load('fish-sales');
  const boundaries = [9007199254740991, 8188362958855446, 7505999378950826, 6928614811339224];
  for (const [qteSuccessCount, weightKg] of boundaries.entries()) {
    assert.equal(price({ speciesId: 'black-bass', weightKg, qteSuccessCount }), Number.MAX_SAFE_INTEGER);
    assert.throws(() => price({ speciesId: 'black-bass', weightKg: weightKg + 1, qteSuccessCount }), RangeError);
  }
});

test('quote, immediate, stored individual/bulk and restored sales use each rounded final price exactly once', () => {
  for (const route of ['immediate', 'individual', 'bulk', 'restored']) {
    let state = session();
    const expected = [28, 17, 2, 1300];
    [capture('half', 25, 1), capture('two', 14, 2), capture('min', 1, 3), capture('three', 1000, 3)]
      .forEach(record => { state.collection.register(record); if (route !== 'immediate') state.collection.store(record.id); });
    if (route === 'restored') state = restoreSaveData(parseSaveData(serializeSaveData(save(state))));
    const c = state.collection, ids = c.catches.map(record => record.id);
    assert.deepEqual(c.catches.map(calculateSalePrice), expected);
    if (route !== 'immediate') assert.equal(c.quoteStored().total, 1347);
    const receipts = route === 'bulk' ? [c.sellStored(ids)] : ids.map(id => route === 'immediate' ? c.sellUnassigned(id) : c.sellStored([id]));
    assert.equal(receipts.reduce((sum, receipt) => sum + receipt.total, 0), 1347);
    assert.deepEqual(c.catches.map(record => record.salePrice), expected);
    assert.deepEqual(c.wallet, { balance: 1347, lifetimeSales: 1347 });
    const before = c.snapshot;
    assert.equal(c.sellStored(ids), null); assert.equal(c.sellUnassigned(ids[0]), null);
    assert.deepEqual(c.snapshot, before);
    assert.deepEqual(save(restoreSaveData(save(state))), save(state));
  }
  const c = createCatchCollection();
  for (const id of ['a', 'b']) { c.register(capture(id, 25, 1)); c.store(id); }
  assert.equal(c.quoteStored().total, 56); // Round 2.5 to 3 per fish, not round 5 once.
  assert.equal(c.sellStored(['a', 'b']).total, 56);
});

test('batch overflow, separate wallet/lifetime overflow, invalid IDs and sold mixing leave all state/awards untouched', () => {
  for (const mode of ['batch', 'wallet', 'lifetime', 'price']) {
    const state = session(), c = state.collection;
    if (mode === 'wallet' || mode === 'lifetime') {
      c.register(capture('income', 8e15, 0)); c.sellUnassigned('income');
      if (mode === 'lifetime') {
        // Historical balance may legitimately be below lifetime income.
        const data = structuredClone(save(state)); data.collection.wallet.balance = 0;
        state.achievements.dispose(); Object.assign(state, restoreSaveData(data));
      }
    }
    const live = state.collection;
    const values = mode === 'batch' ? [capture('a', 4e15, 3), capture('b', 4e15, 3)]
      : mode === 'price' ? [capture('a', 8e15, 3), capture('b', 25, 1)] : [capture('a', 1e15, 3), capture('b', 25, 1)];
    values.forEach(record => { live.register(record); live.store(record.id); });
    const before = live.snapshot, awards = state.achievements.snapshot; let changes = 0;
    live.subscribe(() => changes++);
    assert.equal(live.sellStored(['a', 'b']), null);
    assert.equal(live.snapshot.catches, before.catches); assert.equal(live.wallet, before.wallet);
    assert.deepEqual(state.achievements.snapshot, awards); assert.equal(changes, 0);
  }
  const state = session(), c = state.collection;
  for (const id of ['stored', 'sold', 'pending']) c.register(capture(id, 25, 1));
  c.store('stored'); c.sellUnassigned('sold');
  const before = c.snapshot, awards = state.achievements.snapshot;
  for (const ids of [['stored', 'stored'], ['stored', 'sold'], ['stored', 'pending'], ['stored', 'missing'], ['stored', null], ['stored', ,], 'stored', []]) {
    assert.equal(c.sellStored(ids), null); assert.deepEqual(c.snapshot, before); assert.deepEqual(state.achievements.snapshot, awards);
  }
});

test('sales achievement uses final bonus-inclusive income and preserves its event timestamp on restore', () => {
  const state = session(), c = state.collection;
  c.register(capture('income', 9000, 0)); c.sellUnassigned('income');
  c.register(capture('bonus', 770, 3));
  assert.equal(state.achievements.entries.find(e => e.id === 'normal-sales-10000').unlocked, false);
  assert.equal(c.sellUnassigned('bonus').total, 1001);
  assert.equal(c.wallet.lifetimeSales, 10001);
  const award = state.achievements.snapshot.unlocked.find(e => e.id === 'normal-sales-10000');
  assert.deepEqual(award, { id: 'normal-sales-10000', unlockedAt: savedAt });
  const restored = restoreSaveData(save(state), { now: () => { throw new Error('Must retain dates'); } });
  assert.deepEqual(restored.achievements.snapshot, state.achievements.snapshot);
  assert.deepEqual(restored.collection.wallet, c.wallet);
});

test('only landed domain successes 0..3 register once, across 30/60/144fps; stale/duplicate results add nothing', () => {
  for (const fps of [30, 60, 144]) for (const successes of [0, 1, 2, 3]) {
    let f, index = 0; const tokens = [], resolved = [];
    ({ f } = hookedFight({ speciesId: 'alligator-gar', size: 'max', rod: 10, reel: 10, startDistance: 4.51 }, {
      qte: { enabled: true, selectOperation: () => 'tap' },
      onFightEvent(event) {
        if (event.type === 'qte-warning') {
          const token = event.fight.qte.token, n = event.fight.qte.successes;
          assert.equal(f.state.catches.length, 0);
          for (const stale of tokens) assert.equal(f.submitQteResult(stale, true), false);
          tokens.push(token);
          assert.equal(f.submitQteResult(token, index++ < successes, event.fight.qte.deadlineSeconds), true);
          assert.equal(f.submitQteResult(token, true, event.fight.qte.deadlineSeconds), false);
          assert.equal(f.state.fight.qte.successes, n, 'queued result is not a commit');
        }
        if (event.type === 'qte-resolved') resolved.push(event.fight);
      },
    }));
    for (let i = 0; i < fps * 120 && f.state.phase === PHASE.FIGHT; i++) {
      f.reel(f.state.tension < .65); f.step(1 / fps);
    }
    assert.equal(f.state.phase, PHASE.LANDING, `fps=${fps}, n=${successes}`);
    assert.equal(f.state.catches.length, 0); assert.equal(resolved.length, 3);
    assert.ok(resolved.filter(s => s.qte.successes > 0).every(s => ['normal', 'arm'].includes(s.mode)));
    f.step(2);
    assert.equal(f.state.phase, PHASE.RESULT); assert.equal(f.state.catch.qteSuccessCount, successes);
    const record = f.state.catch; assert.ok(Object.isFrozen(record));
    for (const token of tokens) assert.equal(f.submitQteResult(token, true), false);
    f.step(5); assert.equal(f.state.catch, record); assert.equal(f.state.catches.length, 1);
    f.closeResult(); assert.equal(f.collection.catches[0].qteSuccessCount, successes);
    assert.equal(f.closeResult(), false);
  }
  const { f } = hookedFight();
  assert.equal(f.state.fight.qte.enabled, false);
  for (let i = 0; i < 7200 && f.state.phase === PHASE.FIGHT; i++) { f.reel(f.state.tension < .65); f.step(1 / 60); }
  f.step(2); assert.equal(f.state.catch.qteSuccessCount, 0);
});

test('preview success is provisional; cancellation, stale tokens and a lost fish never create a catch', () => {
  const s = operationSetup({ operation: 'tap' }); s.activate();
  for (const at of [610, 710, 810]) { s.send('pointerdown', at); s.send('pointerup', at + 20); }
  assert.equal(s.delivery.preview().success, true);
  assert.equal(s.f.state.fight.qte.successes, 0); assert.equal(s.f.state.catches.length, 0);
  const old = s.f.state.fight.qte.token;
  s.f.pauseFight(); assert.equal(s.f.submitQteResult(old, true), false);
  s.f.resumeFight(); assert.equal(s.f.submitQteResult(old, true), false);
  assert.equal(s.f.abortFight(), true); assert.equal(s.f.state.catches.length, 0);
  const { f } = hookedFight(); f.reel(true); f.step(120);
  assert.equal(f.state.catches.length, 0);
});
