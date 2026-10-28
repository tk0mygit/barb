import test from 'node:test';
import assert from 'node:assert/strict';
import { EQUIPMENT_LEVELS, getEquipmentLevel, getNextEquipmentLevel } from '../src/game/equipment.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { createFishing } from '../src/game/fishing.js';

const record = (id, weightKg = 3) => ({
  schemaVersion: 1, id, speciesId: 'black-bass', lengthCm: 50, weightKg,
  caughtAt: '2026-01-01T00:00:00.000Z', disposition: 'unassigned',
  conditions: { depthM: 5, timeOfDay: 'day', lureId: 'worm', lurePosition: { x: 2, z: 3 } },
});
// Fund purchases through the existing public sale API, never a wallet setter.
function fund(collection, amount) {
  const id = `income-${collection.catches.length}`;
  collection.register(record(id, amount / 100));
  assert.equal(collection.sellUnassigned(id).total, amount);
}
function unchanged(collection, operation) {
  const before = collection.snapshot;
  assert.equal(operation(), null);
  assert.deepEqual(collection.snapshot, before);
  assert.equal(collection.wallet, before.wallet);
  assert.equal(collection.equipment, before.equipment);
  assert.equal(collection.catches, before.catches);
}

test('both equipment tables have the specified Lv.1-relative values and unchanged 6500 legacy cost', () => {
  const expected = [
    [1, 0, 0, 1, 1, 1], [2, 300, 2, 0.96, 1.06, 1.04],
    [3, 800, 4, 0.92, 1.12, 1.08], [4, 1800, 6, 0.88, 1.18, 1.12],
    [5, 3600, 8, 0.84, 1.24, 1.16],
    [6, 4200, 12, 0.79, 1.33, 1.22], [7, 5200, 16, 0.74, 1.43, 1.28],
    [8, 6500, 20, 0.69, 1.54, 1.34], [9, 8200, 24, 0.64, 1.65, 1.40],
    [10, 10000, 28, 0.59, 1.77, 1.46],
  ];
  const bonuses = { 6: [1.02, 1.10, 1.03], 7: [1.04, 1.20, 1.06], 8: [1.06, 1.30, 1.09],
    9: [1.08, 1.40, 1.12], 10: [1.10, 1.50, 1.15] };
  for (const [level, cost, castDistanceBonusM, tensionMultiplier, reelSpeedMultiplier, tensionReliefMultiplier] of expected) {
    const bonus = bonuses[level];
    assert.deepEqual(getEquipmentLevel('rod', level), { level, cost, castDistanceBonusM, tensionMultiplier,
      ...(bonus ? { tierMultipliers: { Common: 1, Uncommon: bonus[0], Rare: bonus[1] } } : {}) });
    assert.deepEqual(getEquipmentLevel('reel', level), { level, cost, reelSpeedMultiplier, tensionReliefMultiplier,
      ...(bonus ? { largeFishAssistMultiplier: bonus[2] } : {}) });
    for (const kind of ['rod', 'reel']) {
      assert.equal(getNextEquipmentLevel(kind, level), level === 10 ? null : getEquipmentLevel(kind, level + 1));
    }
  }
  assert.ok(Object.isFrozen(EQUIPMENT_LEVELS));
  for (const levels of Object.values(EQUIPMENT_LEVELS)) {
    assert.equal(levels.length, 10);
    assert.equal(levels.slice(0, 5).reduce((sum, row) => sum + row.cost, 0), 6500);
    assert.equal(levels.slice(5).reduce((sum, row) => sum + row.cost, 0), 34100);
    assert.equal(levels.reduce((sum, row) => sum + row.cost, 0), 40600);
    assert.ok(Object.isFrozen(levels));
    assert.ok(levels.every(row => Object.isFrozen(row) && Number.isSafeInteger(row.cost) && row.cost >= 0));
    assert.throws(() => { levels[1].cost = 0; }, TypeError);
    assert.throws(() => levels.push({ level: 6, cost: 0 }), TypeError);
  }
});

test('initial equipment, next-level status and snapshots are read-only and JSON-compatible', () => {
  const collection = createCatchCollection(), before = collection.snapshot;
  assert.deepEqual(collection.equipment, { rodLevel: 1, reelLevel: 1 });
  assert.deepEqual(collection.wallet, { balance: 0, lifetimeSales: 0 });
  for (const kind of ['rod', 'reel']) {
    const status = collection.getUpgradeStatus(kind);
    assert.deepEqual(status, { kind, currentLevel: 1, next: getEquipmentLevel(kind, 2), canPurchase: false, reason: 'insufficient-funds' });
    assert.ok(Object.isFrozen(status));
    assert.throws(() => { status.next.cost = 0; }, TypeError);
  }
  assert.deepEqual(collection.snapshot, before); // queries never update state
  assert.equal(before.schemaVersion, 1);
  assert.equal(before.equipment, collection.equipment);
  assert.ok(Object.isFrozen(before) && Object.isFrozen(before.equipment));
  assert.throws(() => { collection.equipment.rodLevel = 5; }, TypeError);
  assert.throws(() => { collection.equipment = { rodLevel: 5, reelLevel: 5 }; }, TypeError);
  assert.deepEqual(JSON.parse(JSON.stringify(before)), before);
});

test('interleaved upgrades reach Lv.5 independently for 13000 without changing lifetime sales', () => {
  const collection = createCatchCollection(); fund(collection, 13000);
  const before = collection.snapshot;
  let spent = 0;
  for (let level = 2; level <= 5; level++) {
    for (const kind of ['rod', 'reel']) {
      const status = collection.getUpgradeStatus(kind), other = kind === 'rod' ? 'reelLevel' : 'rodLevel';
      const otherLevel = collection.equipment[other];
      assert.equal(status.canPurchase, true); assert.equal(status.reason, null);
      assert.equal(status.next.level, level);
      const receipt = collection.purchaseUpgrade(kind, level - 1);
      assert.deepEqual(receipt, { kind, previousLevel: level - 1, level, cost: status.next.cost });
      assert.ok(Object.isFrozen(receipt));
      spent += receipt.cost;
      assert.deepEqual(collection.wallet, { balance: 13000 - spent, lifetimeSales: 13000 });
      assert.equal(collection.equipment[`${kind}Level`], level);
      assert.equal(collection.equipment[other], otherLevel);
    }
  }
  assert.equal(spent, 13000);
  fund(collection, 1000); // Lv.5 now quotes Lv.6 but still cannot overspend.
  for (const kind of ['rod', 'reel']) {
    assert.deepEqual(collection.getUpgradeStatus(kind), { kind, currentLevel: 5, next: getEquipmentLevel(kind, 6), canPurchase: false, reason: 'insufficient-funds' });
    unchanged(collection, () => collection.purchaseUpgrade(kind, 5));
  }
  assert.deepEqual(before.equipment, { rodLevel: 1, reelLevel: 1 });
  assert.equal(before.wallet.balance, 13000);
  assert.equal(collection.catches[0], before.catches[0]);
});

test('each target level accepts the exact remaining cost and leaves a zero balance', () => {
  for (const kind of ['rod', 'reel']) for (let target = 2; target <= 10; target++) {
    const collection = createCatchCollection();
    const total = [0, 0, 300, 1100, 2900, 6500, 10700, 15900, 22400, 30600, 40600][target];
    fund(collection, total);
    for (let current = 1; current < target - 1; current++) assert.ok(collection.purchaseUpgrade(kind, current));
    assert.equal(collection.wallet.balance, getEquipmentLevel(kind, target).cost);
    assert.ok(collection.purchaseUpgrade(kind, target - 1));
    assert.deepEqual(collection.wallet, { balance: 0, lifetimeSales: total });
  }
});

test('zero and insufficient balances reject atomically; a later sale refreshes eligibility', () => {
  for (const kind of ['rod', 'reel']) {
    const collection = createCatchCollection();
    unchanged(collection, () => collection.purchaseUpgrade(kind, 1));
    fund(collection, 299);
    const oldStatus = collection.getUpgradeStatus(kind);
    assert.equal(oldStatus.canPurchase, false);
    unchanged(collection, () => collection.purchaseUpgrade(kind, 1));
    fund(collection, 1);
    assert.equal(oldStatus.canPurchase, false); // detached snapshot remains unchanged
    assert.equal(collection.getUpgradeStatus(kind).canPurchase, true);
    assert.equal(collection.purchaseUpgrade(kind, 1).cost, 300);
    assert.equal(collection.wallet.balance, 0);
  }
});

test('invalid kinds/levels, omitted levels, skips and stale requests never spend money', () => {
  const collection = createCatchCollection(); fund(collection, 13000);
  for (const kind of [undefined, null, '', 'Rod', 'rodLevel', '__proto__', 'constructor', 0, {}, ['rod'], Symbol('rod')]) {
    assert.equal(getEquipmentLevel(kind, 1), null);
    assert.equal(getNextEquipmentLevel(kind, 1), null);
    assert.equal(collection.getUpgradeStatus(kind), null);
    unchanged(collection, () => collection.purchaseUpgrade(kind, 1));
  }
  for (const level of [undefined, null, 0, -1, 11, 1.5, '1', true, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1n, {}, new Number(1)]) {
    assert.equal(getEquipmentLevel('rod', level), null);
    assert.equal(getNextEquipmentLevel('rod', level), null);
    unchanged(collection, () => collection.purchaseUpgrade('rod', level));
  }
  unchanged(collection, () => collection.purchaseUpgrade('rod'));
  unchanged(collection, () => collection.purchaseUpgrade('rod', 2));
  // Extra caller-provided price arguments have no authority over table costs.
  assert.equal(collection.purchaseUpgrade('rod', 1, 0).cost, 300);
  assert.equal(collection.wallet.balance, 12700);
  unchanged(collection, () => collection.purchaseUpgrade('rod', 1));
  unchanged(collection, () => collection.purchaseUpgrade('rod', 3));
});

test('queued duplicate requests spend once; refreshed requests can buy the next level', async () => {
  const collection = createCatchCollection(); fund(collection, 2000);
  const results = await Promise.all(Array.from({ length: 10 }, () => Promise.resolve().then(() => collection.purchaseUpgrade('rod', 1))));
  assert.equal(results.filter(Boolean).length, 1);
  assert.deepEqual(collection.wallet, { balance: 1700, lifetimeSales: 2000 });
  assert.deepEqual(collection.equipment, { rodLevel: 2, reelLevel: 1 });
  assert.equal(collection.purchaseUpgrade('rod', 2).cost, 800);
  assert.deepEqual(collection.wallet, { balance: 900, lifetimeSales: 2000 });
});

test('large safe-integer balances retain exact spending and independent lifetime sales', () => {
  const collection = createCatchCollection(); fund(collection, 9000000000000000);
  assert.equal(collection.purchaseUpgrade('reel', 1).cost, 300);
  assert.deepEqual(collection.wallet, { balance: 8999999999999700, lifetimeSales: 9000000000000000 });
  assert.ok(Number.isSafeInteger(collection.wallet.balance));
});

test('purchases preserve capture/storage/sale records and statistics; all sale paths still credit correctly', () => {
  const collection = createCatchCollection(); fund(collection, 1000);
  collection.register(record('stored')); collection.store('stored');
  collection.register(record('pending'));
  const before = collection.snapshot;
  collection.purchaseUpgrade('rod', 1);
  assert.equal(collection.catches, before.catches);
  assert.deepEqual(collection.stored, before.catches.filter(item => item.disposition === 'stored'));
  assert.deepEqual(collection.encyclopedia, before.encyclopedia);
  assert.equal(collection.sellUnassigned('pending').total, 300);
  assert.equal(collection.sellStored(['stored']).total, 300);
  for (const id of ['bulk-a', 'bulk-b']) { collection.register(record(id)); collection.store(id); }
  assert.equal(collection.sellStored(collection.quoteStored().ids).total, 600);
  assert.deepEqual(collection.wallet, { balance: 1900, lifetimeSales: 2200 });
  assert.deepEqual(collection.equipment, { rodLevel: 2, reelLevel: 1 });
  assert.equal(collection.stored.length, 0);
  assert.equal(collection.encyclopedia[0].count, 5);
  assert.equal(collection.encyclopedia[0].maxLengthCm, 50);
  assert.ok(collection.catches.every(item => item.schemaVersion === 1 && item.disposition === 'sold' && item.conditions.depthM === 5));
  unchanged(collection, () => collection.sellStored(['stored']));
  unchanged(collection, () => collection.store('stored'));
  assert.deepEqual(JSON.parse(JSON.stringify(collection.snapshot)), collection.snapshot);
});

test('Lv.5 reel improves retrieval without changing base settings or rod tension', () => {
  const collection = createCatchCollection(); fund(collection, 13000);
  for (let level = 1; level < 5; level++) collection.purchaseUpgrade('reel', level);
  const upgraded = createFishing({ collection, random: () => 0.5 });
  const baseline = createFishing({ random: () => 0.5 });
  assert.deepEqual(upgraded.settings, baseline.settings);
  for (const fishing of [upgraded, baseline]) {
    fishing.prepare({ x: 0, z: 30 }, 0); fishing.aim(0, 180); fishing.cast();
    for (let i = 0; i < 3000 && fishing.state.phase !== 'bite'; i++) fishing.step(1 / 60);
    assert.equal(fishing.hook(), true);
    fishing.reel(true); fishing.step(0.5);
  }
  const remaining = 32 - upgraded.state.distance, original = 32 - baseline.state.distance;
  assert.ok(Math.abs(remaining - original * 1.24) < 1e-12);
  assert.equal(upgraded.state.tension, baseline.state.tension);
});

test('every new single-level improvement exceeds the largest legacy improvement for all four performances', t => {
  const metrics = [
    ['cast distance', EQUIPMENT_LEVELS.rod.map(row => 32 + row.castDistanceBonusM), false, 0.0625, 1 / 14],
    ['tension suppression', EQUIPMENT_LEVELS.rod.map(row => row.tensionMultiplier), true, 1 / 22, 5 / 84],
    ['reel speed', EQUIPMENT_LEVELS.reel.map(row => row.reelSpeedMultiplier), false, 0.06, 1 / 14],
    ['tension relief', EQUIPMENT_LEVELS.reel.map(row => row.tensionReliefMultiplier), false, 0.04, 3 / 70],
  ];
  for (const [name, values, decreasing, expectedOld, expectedNew] of metrics) {
    const rates = values.slice(1).map((next, i) => decreasing ? (values[i] - next) / values[i] : next / values[i] - 1);
    const oldMaximum = Math.max(...rates.slice(0, 4)), newMinimum = Math.min(...rates.slice(4));
    assert.ok(newMinimum > oldMaximum, name);
    assert.ok(Math.abs(oldMaximum - expectedOld) < 1e-12, name);
    assert.ok(Math.abs(newMinimum - expectedNew) < 1e-12, name);
    t.diagnostic(`${name}: legacy max ${(oldMaximum * 100).toFixed(3)}% < new min ${(newMinimum * 100).toFixed(3)}%`);
  }
});

test('interleaved Lv.1–10 purchases cost exactly 81200, reject stale/duplicate requests and terminate at Lv.10', async () => {
  const collection = createCatchCollection(); fund(collection, 82200);
  const history = collection.catches; let spent = 0;
  for (let level = 2; level <= 10; level++) for (const kind of ['rod', 'reel']) {
    const other = kind === 'rod' ? 'reelLevel' : 'rodLevel', otherLevel = collection.equipment[other];
    const requests = await Promise.all(Array.from({ length: 3 }, () => Promise.resolve().then(() => collection.purchaseUpgrade(kind, level - 1))));
    assert.equal(requests.filter(Boolean).length, 1);
    assert.deepEqual(requests[0], { kind, previousLevel: level - 1, level, cost: getEquipmentLevel(kind, level).cost });
    spent += requests[0].cost;
    assert.deepEqual(collection.wallet, { balance: 82200 - spent, lifetimeSales: 82200 });
    assert.equal(collection.equipment[other], otherLevel);
    unchanged(collection, () => collection.purchaseUpgrade(kind, level - 1));
    assert.equal(collection.catches, history);
  }
  assert.equal(spent, 81200);
  for (const kind of ['rod', 'reel']) {
    assert.deepEqual(collection.getUpgradeStatus(kind), { kind, currentLevel: 10, next: null, canPurchase: false, reason: 'max-level' });
    unchanged(collection, () => collection.purchaseUpgrade(kind, 10));
    assert.equal(getEquipmentLevel(kind, 11), null); assert.equal(getNextEquipmentLevel(kind, 10), null);
  }
});

test('each Lv.6–10 purchase rejects a one-unit shortage and succeeds after the final unit is sold', () => {
  for (const kind of ['rod', 'reel']) for (let target = 6; target <= 10; target++) {
    const collection = createCatchCollection();
    const total = EQUIPMENT_LEVELS[kind].slice(0, target).reduce((sum, row) => sum + row.cost, 0);
    fund(collection, total - 1);
    for (let current = 1; current < target - 1; current++) assert.ok(collection.purchaseUpgrade(kind, current));
    unchanged(collection, () => collection.purchaseUpgrade(kind, target - 1));
    fund(collection, 1); assert.ok(collection.purchaseUpgrade(kind, target - 1));
    assert.deepEqual(collection.wallet, { balance: 0, lifetimeSales: total });
  }
});
