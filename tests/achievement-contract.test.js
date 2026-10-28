import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createSaveData, validateSaveData, parseSaveData, serializeSaveData, restoreSaveData,
  tryRestoreSaveData, SaveDataError, SAVE_VERSION } from '../src/game/save-data.js';
import { validateCollectionData } from '../src/game/save-validation.js';
import { createSaveStorage, SAVE_STORAGE_KEYS } from '../src/game/save-storage.js';
import { NORMAL_ACHIEVEMENTS } from '../src/game/achievements.js';

const rawSlots = ['a', 'b'].map(slot => readFileSync(new URL(`./fixtures/saves/phase5b1a-legacy-slot-${slot}.json`, import.meta.url), 'utf8'));
const legacy = rawSlots.map(raw => JSON.parse(raw).data);
const clone = value => JSON.parse(JSON.stringify(value));
const now = Date.parse('2030-01-02T03:04:05.000Z');
const savedAt = new Date(now).toISOString();
const save = state => createSaveData(state, { savedAt });
const legacyIds = NORMAL_ACHIEVEMENTS.slice(0, 10).map(item => item.id);
const oldAwards = data => data.unlocked.filter(record => legacyIds.includes(record.id));
function rejects(data, path, code = 'invalid-data') {
  assert.throws(() => validateSaveData(data), error => error instanceof SaveDataError && error.code === code && error.path === path);
  assert.deepEqual(tryRestoreSaveData(JSON.stringify(data)), { ok: false, error: { code, path } });
}
function memory(raw = rawSlots) {
  const map = new Map(SAVE_STORAGE_KEYS.map((key, i) => [key, raw[i]])), writes = [];
  return { map, writes, fail: false,
    getItem(key) { return map.get(key) ?? null; },
    setItem(key, value) {
      if (this.fail) throw Object.assign(new Error('Full'), { name: 'QuotaExceededError' });
      writes.push({ key, value }); map.set(key, value);
    },
    removeItem() { throw new Error('Must not delete'); }, clear() { throw new Error('Must not clear'); },
  };
}

test('fixed pre-change canonical A/B bytes retain their hashes and exact old contract', () => {
  assert.equal(SAVE_VERSION, 1);
  assert.deepEqual(SAVE_STORAGE_KEYS, ['barb.save.v1.slotA', 'barb.save.v1.slotB']);
  assert.deepEqual(rawSlots.map(raw => createHash('sha256').update(raw).digest('hex')), [
    '99d6efd2be174cef0b7ad627e9f7d435706aad3540ab4fe759be7ef4b839a6de',
    '157bdfdd78993ce9a11226f0540fe6a2d9658c4b0e763194b1d61d668c8b1980',
  ]);
  assert.deepEqual(legacy.map(data => data.collection.equipment), [{ rodLevel: 3, reelLevel: 2 }, { rodLevel: 5, reelLevel: 5 }]);
  assert.equal(legacy[1].achievements.unlocked.length, 10);
  for (const [i, data] of legacy.entries()) {
    assert.equal(Object.hasOwn(data.achievements, 'contractVersion'), false);
    assert.deepEqual(validateSaveData(data), data);
    assert.deepEqual(parseSaveData(serializeSaveData(data)), data);
    const restored = restoreSaveData(data, { now: () => now });
    assert.deepEqual(restored.collection.catches, data.collection.catches);
    assert.deepEqual(restored.collection.wallet, data.collection.wallet);
    assert.deepEqual(restored.collection.equipment, data.collection.equipment);
    assert.deepEqual({ x: restored.boat.x, z: restored.boat.z, heading: restored.boat.heading }, data.boat);
    assert.equal(restored.clock.state.elapsedSeconds, data.clock.elapsedSeconds);
    assert.deepEqual(oldAwards(restored.achievements.snapshot), data.achievements.unlocked);
    const notices = []; restored.achievements.subscribe(batch => notices.push(batch));
    assert.deepEqual(restored.achievements.evaluate(), []);
    assert.deepEqual(notices, []);
    const added = restored.achievements.snapshot.unlocked.filter(record => !legacyIds.includes(record.id));
    assert.deepEqual(added, i === 0 ? [] : ['normal-rod-level-5', 'normal-reel-level-5'].map(id => ({ id, unlockedAt: savedAt })));
    assert.equal(save(restored).achievements.contractVersion, 2);
  }
});

test('legacy load never rewrites either raw slot; a failed migration save retains both normal generations', () => {
  const storage = memory(), manager = createSaveStorage({ getStorage: () => storage });
  const { state, status } = manager.load();
  assert.equal(status.phase, 'restored'); assert.equal(status.generation, 2);
  assert.equal(manager.load().state, state);
  assert.deepEqual([...storage.map.values()], rawSlots); assert.deepEqual(storage.writes, []);
  const data = save(state); assert.equal(data.achievements.contractVersion, 2);
  storage.fail = true;
  assert.equal(manager.save(data).ok, false); assert.equal(manager.status.code, 'quota-exceeded');
  assert.equal(manager.status.generation, 2);
  assert.deepEqual([...storage.map.values()], rawSlots);
  storage.fail = false; assert.equal(manager.save(data).ok, true);
  assert.equal(manager.status.generation, 3); assert.equal(storage.writes.length, 1);
  assert.equal(storage.map.get(SAVE_STORAGE_KEYS[1]), rawSlots[1]);
  const envelope = JSON.parse(storage.writes[0].value);
  assert.equal(envelope.storageVersion, 1); assert.equal(envelope.data.saveVersion, 1);
  assert.equal(envelope.data.achievements.contractVersion, 2);
  const reloaded = createSaveStorage({ getStorage: () => storage }).load();
  assert.equal(reloaded.status.generation, 3);
  assert.deepEqual(save(reloaded.state), data);
  assert.deepEqual(oldAwards(reloaded.state.achievements.snapshot), legacy[1].achievements.unlocked);
});

test('legacy achieved awards are mandatory and their old conditions cannot be repaired on restore', () => {
  for (const award of legacy[1].achievements.unlocked) {
    const data = clone(legacy[1]);
    data.achievements.unlocked = data.achievements.unlocked.filter(record => record.id !== award.id);
    rejects(data, `achievements.${award.id}`);
  }
  const impossible = clone(legacy[0]);
  impossible.achievements.unlocked.push({ id: 'normal-equipment-max', unlockedAt: savedAt });
  rejects(impossible, 'achievements.normal-equipment-max');
  const duplicate = clone(legacy[0]); duplicate.achievements.unlocked.push(duplicate.achievements.unlocked[0]);
  rejects(duplicate, `achievements.unlocked[${legacy[0].achievements.unlocked.length}].id`);
  const newId = clone(legacy[0]); newId.achievements.unlocked.push({ id: 'normal-rod-level-5', unlockedAt: savedAt });
  rejects(newId, `achievements.unlocked[${legacy[0].achievements.unlocked.length}].id`);
});

test('version 2 requires every earned old and new award; missing, duplicate, impossible and malformed awards fail closed', () => {
  const baseline = save(restoreSaveData(legacy[1], { now: () => now }));
  assert.equal(baseline.achievements.unlocked.length, 12);
  for (const award of baseline.achievements.unlocked) {
    const data = clone(baseline);
    data.achievements.unlocked = data.achievements.unlocked.filter(record => record.id !== award.id);
    rejects(data, `achievements.${award.id}`);
  }
  const duplicate = clone(baseline); duplicate.achievements.unlocked.push(duplicate.achievements.unlocked[10]);
  rejects(duplicate, 'achievements.unlocked[12].id');
  for (const unlockedAt of ['invalid', '2026-02-30T00:00:00Z', 123, null]) {
    const data = clone(baseline); data.achievements.unlocked[10].unlockedAt = unlockedAt;
    rejects(data, 'achievements.unlocked[10].unlockedAt');
  }
  const impossible = clone(baseline); impossible.achievements.unlocked.push({ id: 'normal-rod-level-10', unlockedAt: savedAt });
  rejects(impossible, 'achievements.normal-rod-level-10');
  const unknown = clone(baseline); unknown.achievements.unlocked[10].id = 'normal-future-award';
  rejects(unknown, 'achievements.unlocked[10].id');
  const missingDate = clone(baseline); delete missingDate.achievements.unlocked[10].unlockedAt;
  rejects(missingDate, 'achievements.unlocked[10].unlockedAt');
  const oldAndNew = clone(baseline); delete oldAndNew.achievements.contractVersion;
  rejects(oldAndNew, 'achievements.unlocked', 'input-too-large');
});

test('achievement version type errors and unknown versions retain distinct codes and cause paths', () => {
  for (const version of [undefined, null, '2', true, -1, 2.5, NaN, Infinity]) {
    const data = clone(legacy[0]); data.achievements.contractVersion = version;
    assert.throws(() => validateSaveData(data), error => error.code === 'invalid-data' && error.path === 'achievements.contractVersion');
  }
  for (const version of [0, 1, 3, 999]) {
    const data = clone(legacy[0]); data.achievements.contractVersion = version;
    rejects(data, 'achievements.contractVersion', 'unsupported-version');
  }
  const getter = clone(legacy[0]); let reads = 0;
  Object.defineProperty(getter.achievements, 'contractVersion', { get() { reads++; throw new Error('Must not run'); } });
  assert.throws(() => validateSaveData(getter), error => error.code === 'invalid-data' && error.path === 'achievements.contractVersion');
  assert.equal(reads, 0);
});

test('future achievement contracts protect both slots even when an old generation is still restorable', () => {
  const future = JSON.parse(rawSlots[1]); future.data.achievements.contractVersion = 3;
  const raw = [rawSlots[0], JSON.stringify(future)], storage = memory(raw);
  const manager = createSaveStorage({ getStorage: () => storage }), loaded = manager.load();
  assert.equal(loaded.status.code, 'unsupported-version'); assert.equal(loaded.status.canSave, false);
  assert.deepEqual(loaded.state.collection.equipment, legacy[0].collection.equipment);
  assert.equal(manager.save(save(loaded.state)).ok, false);
  assert.deepEqual([...storage.map.values()], raw); assert.deepEqual(storage.writes, []);
});

test('other-tab change during old-contract migration blocks all writes without losing either checkpoint', () => {
  const storage = memory(), manager = createSaveStorage({ getStorage: () => storage });
  const { state } = manager.load(); storage.map.set(SAVE_STORAGE_KEYS[0], rawSlots[0] + ' ');
  const before = [...storage.map]; assert.equal(manager.save(save(state)).ok, false);
  assert.equal(manager.status.phase, 'conflict'); assert.equal(manager.status.canSave, false);
  assert.deepEqual([...storage.map], before); assert.deepEqual(storage.writes, []);
});

test('canonical collection validation accepts every Lv.1–10 row before constructing or buying equipment', () => {
  for (let rodLevel = 1; rodLevel <= 10; rodLevel++) for (let reelLevel = 1; reelLevel <= 10; reelLevel++) {
    const data = clone(legacy[0].collection); data.equipment = { rodLevel, reelLevel };
    assert.deepEqual(validateCollectionData(data).equipment, data.equipment);
  }
  for (const kind of ['rod', 'reel']) for (const level of [0, 11, 1.5, '10']) {
    const data = clone(legacy[0].collection); data.equipment[`${kind}Level`] = level;
    assert.throws(() => validateCollectionData(data), error => error.code === 'invalid-data' && error.path === `collection.equipment.${kind}Level`);
  }
});

test('old Lv.5 → each newly purchased Lv.6–10 saves and reloads the complete new contract', () => {
  let state = restoreSaveData(legacy[1], { now: () => now });
  const c = state.collection;
  c.register({ schemaVersion: 1, id: 'new-funds', speciesId: 'black-bass', lengthCm: 50, weightKg: 1000, caughtAt: savedAt });
  assert.ok(c.sellUnassigned('new-funds'));
  const initial = c.wallet, history = c.catches; let spent = 0;
  for (let level = 6; level <= 10; level++) {
    for (const kind of ['rod', 'reel']) {
      const receipt = state.collection.purchaseUpgrade(kind, level - 1); assert.ok(receipt); spent += receipt.cost;
      const data = save(state), parsed = parseSaveData(serializeSaveData(data));
      assert.equal(data.saveVersion, 1); assert.equal(data.achievements.contractVersion, 2);
      const next = restoreSaveData(parsed, { now: () => { throw new Error('No newly earned awards on reload'); } });
      assert.deepEqual(save(next), data);
      assert.deepEqual(oldAwards(next.achievements.snapshot), legacy[1].achievements.unlocked);
      assert.deepEqual(next.collection.catches, history);
      assert.deepEqual(next.collection.wallet, { balance: initial.balance - spent, lifetimeSales: initial.lifetimeSales });
      const notices = []; next.achievements.subscribe(batch => notices.push(batch));
      assert.deepEqual(next.achievements.evaluate(), []); assert.deepEqual(notices, []);
      // The next new purchase may earn an award at the current event time.
      state.achievements.dispose(); next.achievements.dispose();
      state = restoreSaveData(parsed, { now: () => now });
    }
  }
  assert.equal(spent, 68200); assert.equal(state.achievements.unlockedCount, 15);
  assert.deepEqual(state.collection.equipment, { rodLevel: 10, reelLevel: 10 });
  const complete = save(state);
  for (const award of complete.achievements.unlocked) {
    const data = clone(complete);
    data.achievements.unlocked = data.achievements.unlocked.filter(record => record.id !== award.id);
    rejects(data, `achievements.${award.id}`);
  }
  const duplicate = clone(complete); duplicate.achievements.unlocked.push(duplicate.achievements.unlocked[14]);
  rejects(duplicate, 'achievements.unlocked', 'input-too-large');
  for (const kind of ['rod', 'reel']) {
    const data = clone(save(state)); delete data.achievements.contractVersion;
    data.achievements.unlocked = oldAwards(data.achievements);
    data.collection.equipment = { rodLevel: 5, reelLevel: 5, [`${kind}Level`]: 6 };
    rejects(data, `collection.equipment.${kind}Level`);
  }
});
