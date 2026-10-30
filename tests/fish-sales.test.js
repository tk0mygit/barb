import test from 'node:test';
import assert from 'node:assert/strict';
import { FISH_SPECIES } from '../src/game/fish-species.js';
import { calculateSalePrice, addMoney } from '../src/game/fish-sales.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { createFishing, PHASE } from '../src/game/fishing.js';
import { BUYER_LINES, pickBuyerLine } from '../src/game/buyer-lines.js';

const captured = (id, weightKg = 1.15, speciesId = 'catfish') => Object.freeze({
  schemaVersion: 1, id, speciesId, lengthCm: 50, weightKg, qteSuccessCount: 0, caughtAt: '2026-01-01T00:00:00.000Z', disposition: 'unassigned',
  conditions: Object.freeze({ depthM: 5, timeOfDay: 'night', lureId: 'worm', lurePosition: Object.freeze({ x: 2, z: 3 }) }),
});

test('all 12 species use existing per-kg prices with consistent half-up decimal rounding', () => {
  for (const fish of FISH_SPECIES) {
    assert.equal(calculateSalePrice({ speciesId: fish.id, weightKg: 1, qteSuccessCount: 0 }), fish.basePricePerKg);
    assert.equal(calculateSalePrice({ speciesId: fish.id, weightKg: 2, qteSuccessCount: 0 }), fish.basePricePerKg * 2);
    // Integer reference calculation over the hundredths produced by fishing.
    for (let hundredths = 1; hundredths <= 300; hundredths++) {
      assert.equal(calculateSalePrice({ speciesId: fish.id, weightKg: hundredths / 100, qteSuccessCount: 0 }), Math.floor((fish.basePricePerKg * hundredths + 50) / 100));
    }
  }
  assert.equal(calculateSalePrice(captured('a')), 104); // 90 * 1.15, not 103
  assert.equal(calculateSalePrice(captured('b', 1.145, 'black-bass')), 115);
  assert.equal(calculateSalePrice(captured('c', 1e-7)), 0);
  for (const weight of [0, -1, NaN, Infinity, '1', Number.MAX_VALUE]) assert.throws(() => calculateSalePrice(captured('bad', weight)), RangeError);
  assert.throws(() => calculateSalePrice(captured('bad', 1, 'missing')), RangeError);
  assert.equal(addMoney(Number.MAX_SAFE_INTEGER, 0), Number.MAX_SAFE_INTEGER);
  for (const values of [[Number.MAX_SAFE_INTEGER, 1], [-1, 1], [0.1, 1], [NaN, 0]]) assert.throws(() => addMoney(...values), RangeError);
});

test('immediate sale credits both balances once, preserves history and rejects resale/restorage', () => {
  const collection = createCatchCollection({ now: () => 1000 });
  assert.deepEqual(collection.wallet, { balance: 0, lifetimeSales: 0 });
  const record = collection.register(captured('one')), before = collection.snapshot;
  const receipt = collection.sellUnassigned('one');
  assert.deepEqual(receipt, { ids: ['one'], count: 1, total: 104, soldAt: '1970-01-01T00:00:01.000Z' });
  assert.deepEqual(collection.wallet, { balance: 104, lifetimeSales: 104 });
  assert.deepEqual(collection.catches[0], { ...record, disposition: 'sold', salePrice: 104, soldAt: receipt.soldAt });
  assert.equal(record.disposition, 'unassigned'); assert.equal(collection.catches[0].conditions, record.conditions);
  assert.deepEqual(before.wallet, { balance: 0, lifetimeSales: 0 });
  assert.equal(collection.sellUnassigned('one'), null); assert.equal(collection.sellStored(['one']), null);
  assert.equal(collection.store('one'), null); assert.equal(collection.sellUnassigned('missing'), null);
  assert.equal(collection.register(record), collection.catches[0]);
  assert.deepEqual(collection.encyclopedia, before.encyclopedia);
  assert.equal(collection.stored.length, 0); assert.equal(collection.catches.length, 1);
  assert.equal(collection.wallet.balance, 104);
  assert.ok(Object.isFrozen(receipt) && Object.isFrozen(receipt.ids) && Object.isFrozen(collection.wallet));
  assert.deepEqual(JSON.parse(JSON.stringify(collection.snapshot)), collection.snapshot);
});

test('stored sales require stored records; invalid or duplicate batch targets change nothing', () => {
  const collection = createCatchCollection();
  collection.register(captured('stored')); collection.store('stored'); collection.register(captured('pending'));
  const before = collection.snapshot;
  for (const ids of [[], ['pending'], ['stored', 'pending'], ['stored', 'missing'], ['stored', 'stored'], null]) {
    assert.equal(collection.sellStored(ids), null); assert.deepEqual(collection.snapshot, before);
  }
  assert.equal(collection.sellUnassigned('stored'), null);
  assert.equal(collection.sellStored(['stored']).total, 104);
  assert.equal(collection.stored.length, 0); assert.equal(collection.catches.length, 2);
  assert.equal(collection.catches[1].disposition, 'unassigned');
});

test('batch quote is read-only, sums individually rounded prices, and binds the confirmed IDs', () => {
  const collection = createCatchCollection();
  assert.equal(collection.quoteStored(), null);
  for (const id of ['a', 'b']) { collection.register(captured(id)); collection.store(id); }
  collection.register(captured('pending'));
  const before = collection.snapshot, quote = collection.quoteStored();
  assert.deepEqual(quote, { ids: ['a', 'b'], count: 2, total: 208 }); // not round(207)
  assert.deepEqual(collection.snapshot, before); // opening/cancelling confirmation
  collection.register(captured('later')); collection.store('later');
  const receipt = collection.sellStored(quote.ids);
  assert.equal(receipt.total, 208); assert.equal(receipt.count, 2);
  assert.deepEqual(collection.stored.map(record => record.id), ['later']);
  assert.equal(collection.sellStored(quote.ids), null);
  assert.deepEqual(collection.wallet, { balance: 208, lifetimeSales: 208 });
  const stale = collection.quoteStored(); collection.sellStored(['later']);
  assert.equal(collection.sellStored(stale.ids), null);
  assert.equal(collection.encyclopedia.find(entry => entry.speciesId === 'catfish').count, 4);
});

test('unsafe individual prices, batch sums, wallet totals and timestamps never partially commit', () => {
  const collection = createCatchCollection();
  for (const [id, kg] of [['large', 9e13], ['large2', 9e13], ['small', 1]]) {
    collection.register(captured(id, kg, 'black-bass')); collection.store(id);
  }
  let before = collection.snapshot;
  assert.equal(collection.quoteStored(), null);
  assert.equal(collection.sellStored(['large', 'large2', 'small']), null);
  assert.deepEqual(collection.snapshot, before);
  collection.sellStored(['large']); before = collection.snapshot;
  assert.equal(collection.sellStored(['large2', 'small']), null); assert.deepEqual(collection.snapshot, before);
  collection.register(captured('overflow', 1e300)); before = collection.snapshot;
  assert.equal(collection.sellUnassigned('overflow'), null); assert.deepEqual(collection.snapshot, before);
  const invalidClock = createCatchCollection({ now: () => NaN }); invalidClock.register(captured('clock'));
  before = invalidClock.snapshot;
  assert.equal(invalidClock.sellUnassigned('clock'), null); assert.deepEqual(invalidClock.snapshot, before);
});

test('buyer lines use an independent random source and never consume fishing Math.random', () => {
  for (let index = 0; index < BUYER_LINES.length; index++) assert.equal(pickBuyerLine(() => index / BUYER_LINES.length), BUYER_LINES[index]);
  assert.ok(new Set(BUYER_LINES).size >= 3);
  const previous = Math.random;
  try {
    Math.random = () => { throw new Error('Fishing RNG consumed'); };
    for (let i = 0; i < 20; i++) assert.ok(BUYER_LINES.includes(pickBuyerLine()));
  } finally { Math.random = previous; }
});

test('selling a real catch returns to ready; delayed close/store/sale attempts cannot credit twice', () => {
  const fishing = createFishing({ random: () => 0.5 });
  fishing.prepare({ x: 0, z: 30 }, 0); fishing.aim(0, 180); fishing.cast();
  for (let i = 0; i < 3000 && fishing.state.phase !== PHASE.BITE; i++) fishing.step(1 / 60);
  assert.equal(fishing.hook(), true);
  let held = false;
  for (let i = 0; i < 1800 && fishing.state.phase === PHASE.FIGHT; i++) {
    if (fishing.state.tension < 0.4) held = true;
    if (fishing.state.tension > 0.75) held = false;
    fishing.reel(held); fishing.step(1 / 60);
  }
  fishing.step(2); assert.equal(fishing.state.phase, PHASE.RESULT);
  const record = fishing.state.catch, stats = fishing.collection.encyclopedia;
  assert.equal(fishing.sellResult().total, calculateSalePrice(record));
  assert.equal(fishing.state.phase, PHASE.READY); assert.equal(fishing.state.catch, null);
  assert.equal(fishing.closeResult(), false); assert.equal(fishing.sellResult(), null);
  assert.equal(fishing.collection.store(record.id), null);
  assert.equal(fishing.collection.stored.length, 0);
  assert.equal(fishing.state.catches[0].disposition, 'sold');
  assert.equal(fishing.collection.wallet.balance, calculateSalePrice(record));
  assert.deepEqual(fishing.collection.encyclopedia, stats);
});
