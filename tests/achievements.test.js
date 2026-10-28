import test from 'node:test';
import assert from 'node:assert/strict';
import { createAchievements, NORMAL_ACHIEVEMENTS } from '../src/game/achievements.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { FISH_SPECIES } from '../src/game/fish-species.js';
import { createFishing, PHASE } from '../src/game/fishing.js';

const record = (id, extra = {}) => ({ schemaVersion: 1, id, speciesId: 'black-bass', lengthCm: 40,
  weightKg: 1, caughtAt: '2026-01-01T00:00:00.000Z', ...extra });
const entry = (achievements, id) => achievements.entries.find(item => item.id === `normal-${id}`);
function setup() {
  const collection = createCatchCollection({ now: () => 1000 });
  const achievements = createAchievements({ collection, now: () => 2000 });
  const batches = [];
  achievements.subscribe(awards => batches.push(awards.map(item => item.id)));
  return { collection, achievements, batches };
}
function income(collection, amount) {
  const id = `income-${collection.catches.length}`;
  collection.register(record(id, { weightKg: amount / 100 }));
  return collection.sellUnassigned(id);
}

test('new session is 0 / 15 with stable immutable definitions and canonical zero progress', () => {
  const { collection, achievements } = setup();
  assert.equal(NORMAL_ACHIEVEMENTS.length, 15);
  assert.equal(new Set(NORMAL_ACHIEVEMENTS.map(item => item.id)).size, 15);
  assert.equal(achievements.unlockedCount, 0);
  assert.ok(achievements.entries.every(item => !item.unlocked && item.unlockedAt === null));
  assert.equal(entry(achievements, 'catch-10').progress.value, 0);
  assert.equal(entry(achievements, 'length-100').progress.value, 0);
  assert.deepEqual(achievements.snapshot, { contractVersion: 2, unlocked: [] });
  assert.equal(collection.snapshot.schemaVersion, 1);
  assert.equal('achievements' in collection.snapshot, false);
});

test('first landing unlocks before disposition; duplicate registration, storage and resale do not add catches or awards', () => {
  const { collection, achievements, batches } = setup();
  const captured = collection.register(record('one'));
  assert.equal(entry(achievements, 'first-catch').unlocked, true);
  assert.equal(collection.stored.length, 0);
  collection.register({ ...captured, lengthCm: 120, speciesId: 'arowana' });
  collection.store('one'); collection.store('one'); collection.sellStored(['one']);
  assert.equal(collection.sellStored(['one']), null);
  assert.equal(entry(achievements, 'catch-10').progress.value, 1);
  assert.equal(entry(achievements, 'species-5').progress.value, 1);
  assert.equal(entry(achievements, 'length-100').unlocked, false);
  assert.deepEqual(batches, [['normal-first-catch']]);
});

for (const target of [10, 50, 100]) test(`capture threshold ${target - 1} → ${target} uses >= and unlocks once`, () => {
  const { collection, achievements, batches } = setup();
  for (let i = 1; i < target; i++) collection.register(record(String(i)));
  assert.equal(entry(achievements, `catch-${target}`).unlocked, false);
  collection.register(record(String(target)));
  assert.equal(entry(achievements, `catch-${target}`).unlocked, true);
  collection.register(record('above'));
  assert.equal(batches.flat().filter(id => id === `normal-catch-${target}`).length, 1);
  assert.equal(entry(achievements, `catch-${target}`).progress.value, target + 1);
});

for (const target of [5, 12]) test(`encyclopedia discovery threshold ${target - 1} → ${target}`, () => {
  const { collection, achievements } = setup();
  for (let i = 0; i < target - 1; i++) collection.register(record(String(i), { speciesId: FISH_SPECIES[i].id }));
  collection.register(record('same-species'));
  assert.equal(entry(achievements, `species-${target}`).unlocked, false);
  collection.register(record('new-species', { speciesId: FISH_SPECIES[target - 1].id }));
  assert.equal(entry(achievements, `species-${target}`).unlocked, true);
  assert.equal(entry(achievements, `species-${target}`).progress.value, target);
});

test('99.9cm stays locked despite heavy weight, 100.0cm unlocks regardless of weight', () => {
  const { collection, achievements } = setup();
  collection.register(record('short', { lengthCm: 99.9, weightKg: 1000 }));
  assert.equal(entry(achievements, 'length-100').unlocked, false);
  collection.register(record('long', { lengthCm: 100, weightKg: 0.01 }));
  assert.equal(entry(achievements, 'length-100').unlocked, true);
  assert.equal(entry(achievements, 'length-100').progress.value, 100);
});

for (const path of ['immediate', 'individual', 'bulk']) test(`${path} sales cross 9,999 → 10,000, and spending preserves lifetime achievement`, () => {
  const { collection, achievements } = setup();
  income(collection, 9999);
  assert.equal(entry(achievements, 'sales-10000').unlocked, false);
  if (path === 'bulk') {
    for (const id of ['a', 'b']) { collection.register(record(id, { weightKg: 0.01 })); collection.store(id); }
    collection.sellStored(collection.quoteStored().ids);
  } else {
    collection.register(record('last', { weightKg: 0.01 }));
    if (path === 'immediate') collection.sellUnassigned('last');
    else { collection.store('last'); collection.sellStored(['last']); }
  }
  const value = path === 'bulk' ? 10001 : 10000;
  assert.equal(collection.wallet.lifetimeSales, value);
  assert.equal(entry(achievements, 'sales-10000').unlocked, true);
  const unlockedAt = entry(achievements, 'sales-10000').unlockedAt;
  collection.purchaseUpgrade('rod', 1);
  assert.equal(collection.wallet.balance, value - 300);
  assert.equal(entry(achievements, 'sales-10000').progress.value, value);
  assert.equal(entry(achievements, 'sales-10000').unlockedAt, unlockedAt);
});

for (const kind of ['rod', 'reel']) test(`${kind} alone reaching Lv.2 unlocks first upgrade`, () => {
  const { collection, achievements, batches } = setup();
  income(collection, 300);
  assert.equal(entry(achievements, 'first-upgrade').unlocked, false);
  collection.purchaseUpgrade(kind, 1);
  assert.equal(entry(achievements, 'first-upgrade').unlocked, true);
  assert.deepEqual(batches.at(-1), ['normal-first-upgrade']);
});

test('one Lv.5 stays locked, both Lv.5 unlock maximum equipment', () => {
  const { collection, achievements } = setup(); income(collection, 13000);
  for (let level = 1; level < 5; level++) collection.purchaseUpgrade('rod', level);
  assert.equal(entry(achievements, 'equipment-max').unlocked, false);
  for (let level = 1; level < 4; level++) collection.purchaseUpgrade('reel', level);
  assert.equal(entry(achievements, 'equipment-max').unlocked, false);
  collection.purchaseUpgrade('reel', 4);
  assert.equal(entry(achievements, 'equipment-max').unlocked, true);
  assert.deepEqual(entry(achievements, 'equipment-max').progress, { value: 5, target: 5, rodLevel: 5, reelLevel: 5 });
});

test('equipment maximum checks each level even if a supplied view has a sum of 10', () => {
  const collection = { ...createCatchCollection(), equipment: { rodLevel: 6, reelLevel: 4 } };
  const achievements = createAchievements({ collection });
  assert.equal(entry(achievements, 'equipment-max').unlocked, false);
});

test('first capture and 100cm unlock together; 100th capture and 12th discovery unlock together', () => {
  const { collection, achievements, batches } = setup();
  collection.register(record('big', { lengthCm: 100 }));
  assert.deepEqual(batches[0], ['normal-first-catch', 'normal-length-100']);
  for (let i = 1; i < 99; i++) collection.register(record(String(i), { speciesId: FISH_SPECIES[i % 11].id }));
  collection.register(record('hundred', { speciesId: FISH_SPECIES[11].id }));
  assert.deepEqual(batches.at(-1), ['normal-catch-100', 'normal-species-12']);
  assert.equal(achievements.unlockedCount, 7);
});

test('failed purchases/sales, quote and cancel-like reads do not emit changes or unlock', () => {
  const { collection, achievements, batches } = setup();
  let changes = 0; collection.subscribe(() => changes++);
  assert.equal(collection.purchaseUpgrade('rod', 1), null);
  assert.equal(collection.sellUnassigned('missing'), null);
  assert.equal(collection.sellStored([]), null);
  assert.equal(achievements.unlockedCount, 0); assert.equal(changes, 0);
  income(collection, 9999);
  collection.register(record('last', { weightKg: 0.01 })); collection.store('last');
  const before = changes, beforeAwards = batches.length;
  collection.quoteStored(); collection.getUpgradeStatus('rod');
  assert.equal(collection.sellUnassigned('last'), null);
  assert.equal(collection.sellStored(['last', 'missing']), null);
  assert.equal(collection.sellStored(['last', 'last']), null);
  assert.equal(collection.purchaseUpgrade('rod', 2), null);
  assert.equal(collection.purchaseUpgrade('unknown', 1), null);
  assert.equal(changes, before); assert.equal(batches.length, beforeAwards);
  assert.equal(entry(achievements, 'sales-10000').unlocked, false);
  assert.equal(entry(achievements, 'first-upgrade').unlocked, false);
});

test('reevaluation and duplicate registration preserve ISO unlock time; immutable snapshots do not expose mutable state', () => {
  let time = 1000;
  const collection = createCatchCollection();
  const achievements = createAchievements({ collection, now: () => time });
  const empty = achievements.snapshot;
  collection.register(record('a'));
  const snapshot = achievements.snapshot, entries = achievements.entries;
  time = 99999; assert.deepEqual(achievements.evaluate(), []); collection.register(record('a'));
  collection.register(record('b', { lengthCm: 100 }));
  assert.equal(entry(achievements, 'first-catch').unlockedAt, '1970-01-01T00:00:01.000Z');
  assert.equal(entry(achievements, 'length-100').unlockedAt, '1970-01-01T00:01:39.999Z');
  assert.deepEqual(empty, { contractVersion: 2, unlocked: [] }); assert.equal(snapshot.unlocked.length, 1);
  for (const object of [NORMAL_ACHIEVEMENTS, ...NORMAL_ACHIEVEMENTS, snapshot, snapshot.unlocked, snapshot.unlocked[0], entries, entries[0], entries[0].progress]) assert.ok(Object.isFrozen(object));
  assert.throws(() => { snapshot.unlocked[0].unlockedAt = 'bad'; }, TypeError);
  assert.throws(() => { entries[0].progress.value = 1234; }, TypeError);
  const json = JSON.parse(JSON.stringify(achievements.snapshot));
  assert.deepEqual(json, achievements.snapshot); json.unlocked.length = 0;
  assert.equal(achievements.unlockedCount, 2);
});

test('presentation errors cannot lose simultaneous awards or break committed collection changes', () => {
  const { collection, achievements } = setup();
  const errors = [], original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    achievements.subscribe(() => { throw new Error('display unavailable'); });
    let seen; achievements.subscribe(awards => { seen = awards; });
    collection.subscribe(() => { throw new Error('other display unavailable'); });
    assert.equal(collection.register(record('big', { lengthCm: 100 })).id, 'big');
    assert.equal(seen.length, 2); assert.equal(achievements.unlockedCount, 2);
    assert.equal(errors.length, 2); assert.deepEqual(achievements.evaluate(), []);
  } finally { console.error = original; }
});

test('subscriptions can be removed, manager disposed, and a new session starts empty', () => {
  const { collection, achievements, batches } = setup();
  let calls = 0; const unsubscribe = collection.subscribe(() => calls++);
  collection.register(record('one')); unsubscribe(); collection.store('one');
  assert.equal(calls, 1);
  achievements.dispose(); collection.register(record('big', { lengthCm: 100 }));
  assert.deepEqual(batches, [['normal-first-catch']]);
  const next = setup(); assert.equal(next.achievements.unlockedCount, 0);
  assert.equal(next.collection.catches.length, 0); assert.deepEqual(next.achievements.snapshot, { contractVersion: 2, unlocked: [] });
});

test('fishing.step landing registers and unlocks without an animation/UI loop', () => {
  const fishing = createFishing({ random: () => 0.1 });
  const achievements = createAchievements({ collection: fishing.collection });
  fishing.prepare({ x: 0, z: 30 }, 0); fishing.aim(0, 180); fishing.cast();
  for (let i = 0; i < 3000 && fishing.state.phase !== PHASE.BITE; i++) fishing.step(1 / 60);
  assert.equal(fishing.hook(), true);
  for (let i = 0; i < 1800 && fishing.state.phase === PHASE.FIGHT; i++) {
    fishing.reel(fishing.state.tension < 0.65); fishing.step(1 / 60);
  }
  fishing.step(2); assert.equal(fishing.state.phase, PHASE.RESULT);
  assert.equal(entry(achievements, 'first-catch').unlocked, true);
  assert.equal(fishing.collection.catches.length, 1);
});

test('exactly five specified equipment definitions append after the immutable legacy prefix', () => {
  assert.equal(NORMAL_ACHIEVEMENTS.slice(0, 10).length, 10);
  assert.deepEqual(NORMAL_ACHIEVEMENTS.slice(10), [
    { id: 'normal-rod-level-5', name: 'ロッドLv.5', description: 'ロッドをLv.5以上に強化する。', metric: 'rod-level', target: 5 },
    { id: 'normal-reel-level-5', name: 'リールLv.5', description: 'リールをLv.5以上に強化する。', metric: 'reel-level', target: 5 },
    { id: 'normal-rod-level-10', name: 'ロッドLv.10', description: 'ロッドをLv.10に強化する。', metric: 'rod-level', target: 10 },
    { id: 'normal-reel-level-10', name: 'リールLv.10', description: 'リールをLv.10に強化する。', metric: 'reel-level', target: 10 },
    { id: 'normal-equipment-level-10', name: '両装備Lv.10', description: 'ロッドとリールの両方をLv.10にする。', metric: 'equipment-max', target: 10 },
  ]);
});

test('individual Lv.5/10 thresholds, old both-Lv.5 and new both-Lv.10 awards unlock once in committed batches', () => {
  let time = 1000;
  const collection = createCatchCollection(), achievements = createAchievements({ collection, now: () => time });
  income(collection, 81200);
  const batches = [], observedCounts = [];
  achievements.subscribe(awards => { batches.push(awards.map(item => item.id)); observedCounts.push(achievements.unlockedCount); });
  for (let level = 2; level <= 10; level++) {
    time += 1000;
    for (const kind of ['rod', 'reel']) {
      assert.equal(entry(achievements, `${kind}-level-${level <= 5 ? 5 : 10}`).unlocked, false);
      const before = batches.length;
      assert.ok(collection.purchaseUpgrade(kind, level - 1));
      if (level === 5 || level === 10) {
        assert.equal(entry(achievements, `${kind}-level-${level}`).unlocked, true);
        assert.equal(entry(achievements, `${kind}-level-${level}`).unlockedAt, new Date(time).toISOString());
        const expected = kind === 'reel' ? level === 5
          ? ['normal-equipment-max', 'normal-reel-level-5']
          : ['normal-reel-level-10', 'normal-equipment-level-10'] : [`normal-rod-level-${level}`];
        assert.deepEqual(batches.at(-1), expected);
      } else if (level !== 2 || kind !== 'rod') assert.equal(batches.length, before);
      assert.deepEqual(achievements.evaluate(), []);
    }
    if (level > 5) assert.equal(entry(achievements, 'equipment-max').unlockedAt, '1970-01-01T00:00:05.000Z');
  }
  assert.deepEqual(batches.flat(), ['normal-first-upgrade', 'normal-rod-level-5', 'normal-equipment-max',
    'normal-reel-level-5', 'normal-rod-level-10', 'normal-reel-level-10', 'normal-equipment-level-10']);
  assert.equal(new Set(batches.flat()).size, 7);
  assert.equal(observedCounts.at(-1), achievements.unlockedCount);
  assert.deepEqual(collection.wallet, { balance: 0, lifetimeSales: 81200 });
});

test('each new equipment condition uses >= and both-Lv.10 requires both independently', () => {
  for (const [rodLevel, reelLevel] of [[4, 4], [5, 4], [4, 5], [6, 5], [9, 9], [10, 9], [9, 10], [10, 10], [11, 12]]) {
    const collection = { ...createCatchCollection(), equipment: { rodLevel, reelLevel } };
    const achievements = createAchievements({ collection, now: () => 1000 });
    for (const target of [5, 10]) for (const kind of ['rod', 'reel']) {
      assert.equal(entry(achievements, `${kind}-level-${target}`).unlocked, (kind === 'rod' ? rodLevel : reelLevel) >= target);
    }
    assert.equal(entry(achievements, 'equipment-level-10').unlocked, rodLevel >= 10 && reelLevel >= 10);
    assert.equal(entry(achievements, 'equipment-max').unlocked, rodLevel >= 5 && reelLevel >= 5);
    assert.deepEqual(achievements.evaluate(), []);
  }
});
