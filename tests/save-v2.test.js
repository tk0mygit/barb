import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSaveData, validateSaveData, parseSaveData, serializeSaveData, restoreSaveData } from '../src/game/save-data.js';
import { validateCollectionData } from '../src/game/save-validation.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { createSaveStorage, SAVE_STORAGE_KEYS as KEYS } from '../src/game/save-storage.js';
import { createAutosave } from '../src/game/autosave.js';
import { NORMAL_ACHIEVEMENTS } from '../src/game/achievements.js';

const BASE_SHA = '927a21d356003802df96a28b64d795964542488c';
const savedAt = '2026-10-31T00:00:00.000Z', clone = structuredClone;
const save = state => createSaveData(state, { savedAt });
const envelope = (generation, data, storageVersion = 1) => JSON.stringify({ storageVersion, generation, data });
const withoutCounts = records => records.map(({ qteSuccessCount, ...record }) => record);
let root, oldSave, oldStorage, v1;

before(async () => {
  // Execute the actual pre-V2 sources, rather than emulating the old version
  // guard. No fixtures or production sources are modified by this archive.
  root = await mkdtemp(join(tmpdir(), 'barb-save-v1-'));
  const archive = execFileSync('git', ['archive', '--format=tar', BASE_SHA, 'src/game', 'src/world', 'package.json']);
  execFileSync('tar', ['-xf', '-', '-C', root], { input: archive });
  const load = name => import(pathToFileURL(join(root, `src/game/${name}.js`)).href);
  oldSave = await load('save-data'); oldStorage = await load('save-storage');
  const { createCatchCollection: collectionFactory } = await load('catch-collection');
  const { createAchievements } = await load('achievements');
  const { createBoatState } = await load('boat'), { createGameClock } = await load('game-clock');
  const collection = collectionFactory({ now: () => Date.parse(savedAt) });
  const achievements = createAchievements({ collection, now: () => Date.parse(savedAt) });
  for (const [id, weightKg] of [['sold', 10], ['stored', .25], ['pending', .14]]) {
    collection.register({ schemaVersion: 1, id, speciesId: 'black-bass', lengthCm: 40, weightKg, caughtAt: '2026-10-30T00:00:00Z' });
    if (id === 'sold') collection.sellUnassigned(id);
    if (id === 'stored') collection.store(id);
  }
  v1 = clone(oldSave.createSaveData({ collection, achievements, boat: createBoatState(), clock: createGameClock() }, { savedAt }));
  // A legal historical price need not match today's quotation. Both source
  // runtimes must preserve it and the wallet/award timestamps byte for byte.
  v1.collection.catches[0].salePrice = 777;
  v1.collection.catches[0].soldAt = '1970-01-01T00:00:01Z';
  v1.collection.wallet = { balance: 777, lifetimeSales: 777 };
  assert.equal(oldSave.SAVE_VERSION, 1); assert.deepEqual(oldSave.validateSaveData(v1), v1);
});
after(async () => { if (root) await rm(root, { recursive: true, force: true }); });

function memory(raw = []) {
  const map = new Map(KEYS.flatMap((key, i) => raw[i] == null ? [] : [[key, raw[i]]])), writes = [];
  return { map, writes,
    getItem(key) { return map.get(key) ?? null; },
    setItem(key, value) { writes.push(key); map.set(key, value); },
    removeItem() { throw new Error('No deletion'); }, clear() { throw new Error('No reset'); },
  };
}
function open(raw, factory = createSaveStorage) {
  const storage = memory(raw), manager = factory({ getStorage: () => storage });
  return { storage, manager, loaded: manager.load() };
}
const v2 = () => parseSaveData(serializeSaveData(v1));
const invalid = error => error.code === 'invalid-data';

test('V1 wire APIs remain strictly V1; only complete validation permits canonical V2 migration', () => {
  const before = clone(v1);
  assert.deepEqual(validateSaveData(v1), before);
  assert.deepEqual(parseSaveData(JSON.stringify(v1)), before);
  const canonical = v2(); assert.equal(canonical.saveVersion, 2);
  assert.deepEqual(withoutCounts(canonical.collection.catches), v1.collection.catches);
  assert.ok(canonical.collection.catches.every(record => record.qteSuccessCount === 0 && Object.isFrozen(record)));
  const restored = restoreSaveData(v1, { now: () => { throw new Error('No invented dates'); } });
  assert.deepEqual(withoutCounts(restored.collection.catches), v1.collection.catches.map(record =>
    record.disposition === 'unassigned' ? { ...record, disposition: 'stored' } : record));
  assert.deepEqual(restored.collection.wallet, v1.collection.wallet);
  assert.deepEqual(restored.achievements.snapshot, v1.achievements);
  const data = save(restored);
  assert.equal(data.saveVersion, 2); assert.equal(restored.collection.snapshot.schemaVersion, 1);
  assert.ok(data.collection.catches.every(record => record.schemaVersion === 1));
  assert.deepEqual(save(restoreSaveData(data)), data);
  assert.equal(serializeSaveData(parseSaveData(serializeSaveData(data))), serializeSaveData(data));
  assert.deepEqual(v1, before);
});

test('V1 exact old schema rejects explicit counts and all old corruption before supplementing anything', () => {
  const corruptions = [d => { d.collection.catches[1].qteSuccessCount = 0; },
    d => { d.collection.catches[1].qteSuccessCount = undefined; },
    d => { d.collection.catches[1].unknown = {}; }, d => { delete d.collection.catches[1].weightKg; },
    d => { d.collection.catches[1].caughtAt = 'bad'; }, d => { d.collection.wallet.balance = 778; },
    d => { d.achievements.unlocked = []; }, d => { d.boat.z = Infinity; }];
  for (const mutate of corruptions) {
    const bad = clone(v1); mutate(bad); const before = clone(bad);
    for (const api of [validateSaveData, restoreSaveData, serializeSaveData]) assert.throws(() => api(bad), invalid);
    assert.deepEqual(bad, before);
  }
  assert.throws(() => createCatchCollection({ initialData: v1.collection }), invalid);
  assert.throws(() => validateCollectionData(v1.collection), invalid);
  assert.ok(createCatchCollection({ initialData: v2().collection }).catches.every(record => record.qteSuccessCount === 0));
});

test('V2 count is mandatory on every disposition in direct object, JSON and slot APIs; unknown fields reject', () => {
  for (const index of [0, 1, 2]) for (const n of ['missing', -1, .5, 4, NaN, Infinity, '1', null, undefined, true]) {
    const bad = clone(v2());
    if (n === 'missing') delete bad.collection.catches[index].qteSuccessCount;
    else bad.collection.catches[index].qteSuccessCount = n;
    assert.throws(() => validateSaveData(bad), invalid);
    assert.throws(() => restoreSaveData(bad), invalid);
    assert.throws(() => validateCollectionData(bad.collection), invalid);
    assert.throws(() => parseSaveData(JSON.stringify(bad)), invalid);
    const raw = envelope(2, bad), good = envelope(1, v1), { manager, storage, loaded } = open([good, raw]);
    assert.equal(loaded.status.phase, 'backup'); assert.equal(loaded.status.generation, 1);
    assert.deepEqual(storage.writes, []); assert.deepEqual([...storage.map.values()], [good, raw]);
    assert.equal(manager.save(bad).ok, false); assert.deepEqual([...storage.map.values()], [good, raw]);
  }
  for (const index of [0, 1, 2]) {
    const bad = clone(v2()); bad.collection.catches[index].future = { nested: [] };
    assert.throws(() => validateSaveData(bad), invalid);
  }
  const bad = clone(v2()); let getterCalls = 0;
  Object.defineProperty(bad.collection.catches[1], 'qteSuccessCount', { get() { getterCalls++; throw new Error('No getters'); } });
  assert.throws(() => validateSaveData(bad), invalid); assert.equal(getterCalls, 0);
});

test('first V2 save writes only the inactive slot for V1-only and all A/B mixed-version orders', () => {
  for (const versions of [[1, null], [null, 1], [1, 1], [1, 2], [2, 1], [2, 2]]) {
    for (const active of [0, 1].filter(i => versions[i] !== null)) {
      const raw = versions.map((version, i) => version === null ? null : envelope(i === active ? 7 : 6, version === 1 ? v1 : v2()));
      const { manager, storage, loaded } = open(raw);
      assert.equal(loaded.status.generation, 7); assert.deepEqual(storage.writes, []);
      assert.deepEqual(KEYS.map(key => storage.getItem(key)), raw);
      const before = loaded.state.collection.snapshot, awards = loaded.state.achievements.snapshot;
      assert.equal(manager.load().state, loaded.state); assert.deepEqual(storage.writes, []);
      assert.equal(manager.save(save(loaded.state)).ok, true);
      assert.deepEqual(storage.writes, [KEYS[1 - active]]);
      assert.equal(storage.getItem(KEYS[active]), raw[active]);
      const written = JSON.parse(storage.getItem(KEYS[1 - active]));
      assert.equal(written.generation, 8); assert.equal(written.storageVersion, 1); assert.equal(written.data.saveVersion, 2);
      assert.deepEqual(loaded.state.collection.snapshot, before); assert.deepEqual(loaded.state.achievements.snapshot, awards);
      const reloaded = createSaveStorage({ getStorage: () => storage }).load();
      assert.equal(reloaded.status.generation, 8); assert.deepEqual(save(reloaded.state), save(loaded.state));
    }
  }
});

test('actual old application treats V2 as unsupported and protects both raw generations', () => {
  for (const raw of [[envelope(1, v1), envelope(2, v2())], [envelope(2, v2()), envelope(1, v1)], [envelope(2, v2()), null]]) {
    assert.throws(() => oldSave.validateSaveData(v2()), e => e.code === 'unsupported-version' && e.path === 'saveVersion');
    const { manager, storage, loaded } = open(raw, oldStorage.createSaveStorage);
    assert.equal(loaded.status.canSave, false); assert.equal(loaded.status.code, 'unsupported-version');
    assert.equal(Boolean(loaded.state), raw.some(value => value && JSON.parse(value).data.saveVersion === 1));
    const before = [...storage.map]; assert.equal(manager.save(v1).ok, false);
    assert.deepEqual([...storage.map], before); assert.deepEqual(storage.writes, []);
  }
});

test('unknown future versions protect a readable V1/V2 backup regardless of order or generation', () => {
  for (const version of [1, 2]) for (const active of [0, 1]) for (const future of [
    envelope(1, { saveVersion: 3, future: [] }), envelope(99, v2(), 3),
  ]) {
    const raw = [future, future]; raw[active] = envelope(7, version === 1 ? v1 : v2());
    const { manager, storage, loaded } = open(raw), before = [...storage.map];
    assert.equal(loaded.status.code, 'unsupported-version'); assert.equal(loaded.status.canSave, false);
    assert.ok(loaded.state); assert.equal(manager.save(save(loaded.state)).ok, false);
    assert.deepEqual([...storage.map], before); assert.deepEqual(storage.writes, []);
  }
});

test('corrupt fallback, two invalid slots, same generation and final generation retain the old protections', () => {
  const valid = envelope(8, v1);
  const backup = open([valid, '{broken']);
  assert.equal(backup.loaded.status.phase, 'backup'); assert.deepEqual(backup.storage.writes, []);
  assert.equal(backup.manager.save(save(backup.loaded.state)).ok, true);
  assert.deepEqual(backup.storage.writes, [KEYS[1]]); assert.equal(backup.storage.getItem(KEYS[0]), valid);
  for (const raw of [['{broken', 'null'], [envelope(8, v1), envelope(8, v2())], [envelope(Number.MAX_SAFE_INTEGER, v1), valid]]) {
    const { manager, storage, loaded } = open(raw), before = [...storage.map];
    assert.equal(loaded.status.canSave, false);
    assert.equal(manager.save(v2()).ok, false); assert.deepEqual([...storage.map], before); assert.deepEqual(storage.writes, []);
  }
  const final = open([envelope(Number.MAX_SAFE_INTEGER - 1, v1), null]);
  assert.equal(final.manager.save(save(final.loaded.state)).ok, true);
  assert.equal(final.manager.status.generation, Number.MAX_SAFE_INTEGER);
  const before = [...final.storage.map]; assert.equal(final.manager.save(v2()).ok, false);
  assert.deepEqual([...final.storage.map], before); assert.deepEqual(final.storage.writes, [KEYS[1]]);
});

test('migration failures preserve every raw byte, domain, wallet, award and generation before a single-slot retry', () => {
  for (const name of ['QuotaExceededError', 'SecurityError', 'StorageUnavailableError', 'Error']) {
    const { manager, storage, loaded } = open([envelope(8, v1), envelope(9, v1)]);
    const before = [...storage.map], history = loaded.state.collection.snapshot, awards = loaded.state.achievements.snapshot;
    const set = storage.setItem; storage.setItem = () => { throw Object.assign(new Error('Injected'), { name }); };
    assert.equal(manager.save(save(loaded.state)).ok, false); assert.equal(manager.status.generation, 9);
    assert.deepEqual([...storage.map], before); assert.deepEqual(storage.writes, []);
    assert.deepEqual(loaded.state.collection.snapshot, history); assert.deepEqual(loaded.state.achievements.snapshot, awards);
    storage.setItem = set; assert.equal(manager.save(save(loaded.state)).ok, true);
    assert.deepEqual(storage.writes, [KEYS[0]]); assert.equal(storage.getItem(KEYS[1]), before[1][1]);
  }
  const raw = [envelope(8, v1), envelope(9, v1)], storage = memory(raw), get = storage.getItem;
  storage.getItem = key => { if (key === KEYS[1]) throw Object.assign(new Error('Denied'), { name: 'SecurityError' }); return get(key); };
  const manager = createSaveStorage({ getStorage: () => storage });
  assert.equal(manager.load().status.canSave, false); assert.equal(manager.save(v2()).ok, false);
  assert.deepEqual(KEYS.map(key => storage.map.get(key)), raw); assert.deepEqual(storage.writes, []);
  const absent = createSaveStorage({ getStorage: () => null });
  assert.equal(absent.load().status.canSave, false); assert.equal(absent.save(v2()).ok, false);
});

test('a byte change from another tab during migration blocks writing without adopting its checkpoint', () => {
  for (const external of [raw => raw + ' ', () => envelope(8, v2()), () => '{corrupt', () => null]) {
    const { manager, storage, loaded } = open([envelope(8, v1), envelope(9, v1)]);
    const changed = external(storage.getItem(KEYS[0]));
    if (changed === null) storage.map.delete(KEYS[0]); else storage.map.set(KEYS[0], changed);
    const before = [...storage.map], history = loaded.state.collection.snapshot;
    assert.equal(manager.save(save(loaded.state)).ok, false); assert.equal(manager.status.code, 'external-change');
    assert.equal(manager.load().state, loaded.state); assert.equal(manager.save(v2()).ok, false);
    assert.deepEqual([...storage.map], before); assert.deepEqual(storage.writes, []);
    assert.deepEqual(loaded.state.collection.snapshot, history);
  }
});

test('20,000 legitimate V1 fish migrate without load writes or history truncation; quota failure keeps the source', () => {
  const data = clone(v1);
  data.collection.catches = Array.from({ length: 20000 }, (_, i) => ({ ...v1.collection.catches[1], id: `legacy-${i}` }));
  data.collection.wallet = { balance: 0, lifetimeSales: 0 };
  data.achievements.unlocked = NORMAL_ACHIEVEMENTS.filter(item => item.metric === 'catches').map(item => ({ id: item.id, unlockedAt: savedAt }));
  const raw = envelope(4, data), { manager, storage, loaded } = open([raw]);
  assert.equal(loaded.state.collection.catches.length, 20000);
  assert.ok(loaded.state.collection.catches.every(record => record.qteSuccessCount === 0));
  assert.deepEqual(storage.writes, []); assert.equal(storage.getItem(KEYS[0]), raw);
  storage.setItem = () => { throw Object.assign(new Error('Full'), { name: 'QuotaExceededError' }); };
  assert.equal(manager.save(save(loaded.state)).ok, false);
  assert.equal(storage.getItem(KEYS[0]), raw); assert.equal(storage.getItem(KEYS[1]), null);
  assert.equal(manager.status.generation, 4); assert.equal(loaded.state.collection.catches.length, 20000);
});

test('autosave leaves V1 load untouched, then saves the bonus-inclusive sale as V2 without losing the active source', () => {
  const { manager, storage, loaded } = open([envelope(8, v1), envelope(9, v1)]), raw = storage.getItem(KEYS[1]);
  const autosave = createAutosave({ state: loaded.state, storage: manager, now: () => Date.parse(savedAt),
    schedule: () => 1, cancel: () => {}, repeat: () => 2, cancelRepeat: () => {} });
  autosave.start(); assert.deepEqual(storage.writes, []); assert.equal(autosave.status.dirty, false);
  const c = loaded.state.collection;
  c.register({ schemaVersion: 1, id: 'new', speciesId: 'black-bass', lengthCm: 40, weightKg: .25, caughtAt: savedAt, qteSuccessCount: 1 });
  assert.equal(c.sellUnassigned('new').total, 28); assert.equal(autosave.status.dirty, true);
  assert.equal(autosave.flush().ok, true); assert.equal(autosave.status.dirty, false);
  assert.deepEqual(storage.writes, [KEYS[0]]); assert.equal(storage.getItem(KEYS[1]), raw);
  const data = JSON.parse(storage.getItem(KEYS[0])).data;
  assert.equal(data.saveVersion, 2); assert.equal(data.collection.wallet.lifetimeSales, 805);
  assert.equal(data.collection.catches.at(-1).salePrice, 28);
  assert.deepEqual(data.achievements, loaded.state.achievements.snapshot);
  autosave.dispose();
});
