import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaveStorage, SAVE_STORAGE_KEYS } from '../src/game/save-storage.js';
import { createSaveData, restoreSaveData } from '../src/game/save-data.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { createAchievements } from '../src/game/achievements.js';
import { createBoatState } from '../src/game/boat.js';
import { createGameClock } from '../src/game/game-clock.js';

const savedAt = '2026-10-23T00:00:00.000Z';
function fresh(seconds = 0, timestamp = savedAt) {
  const collection = createCatchCollection();
  const state = { collection, achievements: createAchievements({ collection }), boat: createBoatState(), clock: createGameClock() };
  state.clock.step(seconds);
  return createSaveData(state, { savedAt: timestamp });
}
const envelope = (generation, data = fresh(), extra = {}) => JSON.stringify({ storageVersion: 1, generation, data, ...extra });
function memory(initial = {}) {
  const map = new Map(Object.entries(initial)), writes = [], reads = [];
  return { map, writes, reads,
    getItem(key) { reads.push(key); return map.get(key) ?? null; },
    setItem(key, value) { writes.push({ key, value }); map.set(key, value); },
    removeItem() { throw new Error('Must not delete'); },
    clear() { throw new Error('Must not clear'); },
  };
}
function open(storage = memory()) {
  const manager = createSaveStorage({ getStorage: () => storage });
  const loaded = manager.load();
  return { manager, loaded, storage };
}
const namedError = name => Object.assign(new Error('Injected storage failure'), { name });

test('first play reads only owned slots, stays empty, and does not write before first save', () => {
  const { manager, loaded, storage } = open(memory({ unrelated: 'keep' }));
  assert.equal(loaded.state, null); assert.equal(manager.status.phase, 'empty');
  assert.equal(manager.status.canSave, true); assert.equal(manager.status.savedAt, null);
  assert.deepEqual(storage.reads, SAVE_STORAGE_KEYS); assert.deepEqual(storage.writes, []);
  assert.equal(storage.map.get('unrelated'), 'keep');
});

test('two slots alternate monotonically and never overwrite the current successful checkpoint', () => {
  const { manager, storage } = open();
  for (let i = 1; i <= 4; i++) {
    const previousIndex = i === 1 ? null : (i - 2) % 2;
    const previous = previousIndex === null ? null : storage.map.get(SAVE_STORAGE_KEYS[previousIndex]);
    assert.equal(manager.save(fresh(i)).ok, true);
    assert.equal(manager.status.phase, 'saved'); assert.equal(manager.status.generation, i);
    const written = storage.writes.at(-1);
    assert.equal(written.key, SAVE_STORAGE_KEYS[(i - 1) % 2]);
    assert.equal(JSON.parse(written.value).generation, i);
    if (previous !== null) assert.equal(storage.map.get(SAVE_STORAGE_KEYS[previousIndex]), previous);
  }
  assert.equal(JSON.parse(storage.map.get(SAVE_STORAGE_KEYS[0])).generation, 3);
  assert.equal(JSON.parse(storage.map.get(SAVE_STORAGE_KEYS[1])).generation, 4);
});

test('reload restores latest complete domains and chooses generation despite reversed OS times', () => {
  const older = fresh(10, '2030-01-01T00:00:00Z'), newer = fresh(20, '2000-01-01T00:00:00Z');
  const storage = memory({ [SAVE_STORAGE_KEYS[0]]: envelope(9, older), [SAVE_STORAGE_KEYS[1]]: envelope(10, newer) });
  const { manager, loaded } = open(storage);
  assert.equal(loaded.state.clock.state.elapsedSeconds, 20);
  assert.equal(loaded.state.fishing.collection, loaded.state.collection);
  assert.equal(loaded.state.fishing.state.phase, 'ready');
  assert.equal(loaded.state.boat.speed, 0); assert.equal(loaded.state.boat.mode, 'sailing');
  assert.equal(manager.status.generation, 10); assert.equal(manager.status.savedAt, newer.savedAt);
  assert.equal(manager.status.phase, 'restored'); assert.deepEqual(storage.writes, []);
});

test('a single valid slot is restored without labeling it a damaged backup', () => {
  for (const key of SAVE_STORAGE_KEYS) {
    const { manager, loaded } = open(memory({ [key]: envelope(5, fresh(12)) }));
    assert.equal(loaded.state.clock.state.elapsedSeconds, 12);
    assert.equal(manager.status.phase, 'restored'); assert.equal(manager.status.restoredFromBackup, false);
  }
});

for (const broken of ['{broken', 'null', '[]', 'true', '{}', '{"storageVersion":1,"generation":12,"data":{}}']) {
  test(`damaged newest slot falls back without mutation: ${broken}`, () => {
    const good = envelope(11, fresh(11));
    const storage = memory({ [SAVE_STORAGE_KEYS[0]]: good, [SAVE_STORAGE_KEYS[1]]: broken });
    const { manager, loaded } = open(storage);
    assert.equal(loaded.state.clock.state.elapsedSeconds, 11); assert.equal(manager.status.phase, 'backup');
    assert.equal(manager.status.restoredFromBackup, true); assert.deepEqual(storage.writes, []);
    assert.equal(manager.save(fresh(12)).ok, true);
    assert.equal(storage.map.get(SAVE_STORAGE_KEYS[0]), good);
    assert.equal(JSON.parse(storage.map.get(SAVE_STORAGE_KEYS[1])).generation, 12);
    assert.equal(manager.status.restoredFromBackup, true);
  });
}

test('all damaged slots protect their exact bytes throughout attempted saves and repeated load', () => {
  const storage = memory({ [SAVE_STORAGE_KEYS[0]]: '{bad', [SAVE_STORAGE_KEYS[1]]: 'bad' });
  const before = [...storage.map]; const { manager, loaded } = open(storage);
  assert.equal(loaded.state, null); assert.equal(manager.status.phase, 'protected'); assert.equal(manager.status.canSave, false);
  assert.equal(manager.save(fresh()).ok, false); assert.equal(manager.load().state, null);
  assert.deepEqual([...storage.map], before); assert.deepEqual(storage.writes, []);
});

for (const version of [0, 2, 99]) {
  for (const field of ['storageVersion', 'saveVersion']) {
    test(`unsupported ${field} ${version} never writes over either slot`, () => {
      const future = field === 'storageVersion' ? envelope(10, fresh(), { storageVersion: version })
        : envelope(10, { saveVersion: version, future: 'unknown' });
      const storage = memory({ [SAVE_STORAGE_KEYS[0]]: envelope(9, fresh(9)), [SAVE_STORAGE_KEYS[1]]: future });
      const before = [...storage.map]; const { manager, loaded } = open(storage);
      assert.equal(loaded.state.clock.state.elapsedSeconds, 9);
      assert.equal(manager.status.phase, 'protected'); assert.equal(manager.status.code, 'unsupported-version');
      assert.equal(manager.save(fresh(10)).ok, false); assert.deepEqual([...storage.map], before);
      assert.deepEqual(storage.writes, []);
    });
  }
}

test('unsupported data without any compatible candidate starts read-only memory play', () => {
  const { manager, loaded, storage } = open(memory({ [SAVE_STORAGE_KEYS[0]]: envelope(1, { saveVersion: 2 }) }));
  assert.equal(loaded.state, null); assert.equal(manager.status.code, 'unsupported-version');
  assert.equal(manager.save(fresh()).ok, false); assert.deepEqual(storage.writes, []);
});

for (const generation of [0, -1, 1.5, '2', null, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid generation ${generation} is rejected rather than repaired`, () => {
    const raw = envelope(generation); const { manager, loaded, storage } = open(memory({ [SAVE_STORAGE_KEYS[0]]: raw }));
    assert.equal(loaded.state, null); assert.equal(manager.status.phase, 'protected');
    assert.equal(manager.save(fresh()).ok, false); assert.equal(storage.map.get(SAVE_STORAGE_KEYS[0]), raw);
  });
}

test('duplicate generations are ambiguous even with identical payloads and remain protected', () => {
  for (const data of [fresh(), fresh(99)]) {
    const storage = memory({ [SAVE_STORAGE_KEYS[0]]: envelope(2), [SAVE_STORAGE_KEYS[1]]: envelope(2, data) });
    const before = [...storage.map]; const { manager, loaded } = open(storage);
    assert.equal(loaded.state, null); assert.equal(manager.status.code, 'duplicate-generation');
    assert.equal(manager.save(fresh()).ok, false); assert.deepEqual([...storage.map], before);
  }
});

test('maximum safe generation restores for play but cannot wrap or overwrite either slot', () => {
  const storage = memory({ [SAVE_STORAGE_KEYS[0]]: envelope(Number.MAX_SAFE_INTEGER, fresh(42)) });
  const { manager, loaded } = open(storage);
  assert.equal(loaded.state.clock.state.elapsedSeconds, 42); assert.equal(manager.status.code, 'generation-exhausted');
  assert.equal(manager.status.canSave, false); assert.equal(manager.save(fresh()).ok, false); assert.deepEqual(storage.writes, []);
});

test('generation boundary writes the last exact safe integer, then refuses another save', () => {
  const { manager, storage } = open(memory({ [SAVE_STORAGE_KEYS[1]]: envelope(Number.MAX_SAFE_INTEGER - 1) }));
  assert.equal(manager.save(fresh(1)).ok, true);
  assert.equal(JSON.parse(storage.map.get(SAVE_STORAGE_KEYS[0])).generation, Number.MAX_SAFE_INTEGER);
  assert.equal(manager.status.canSave, false); assert.equal(manager.status.phase, 'protected');
  assert.equal(manager.status.code, 'generation-exhausted'); assert.equal(manager.save(fresh(2)).ok, false);
  assert.equal(storage.writes.length, 1);
});

test('unknown envelope keys and incomplete metadata cannot masquerade as a valid save', () => {
  for (const raw of [envelope(1, fresh(), { ignored: true }), JSON.stringify(fresh()), '{"generation":1,"data":{}}']) {
    const { manager, loaded, storage } = open(memory({ [SAVE_STORAGE_KEYS[0]]: raw }));
    assert.equal(loaded.state, null); assert.equal(manager.save(fresh()).ok, false); assert.deepEqual(storage.writes, []);
  }
});

for (const name of ['SecurityError', 'QuotaExceededError', 'Error']) {
  test(`write ${name} preserves both previous slots and retries without skipping generations`, () => {
    const storage = memory({ [SAVE_STORAGE_KEYS[0]]: envelope(1), [SAVE_STORAGE_KEYS[1]]: envelope(2, fresh(2)) });
    const { manager } = open(storage); const before = [...storage.map];
    const write = storage.setItem; storage.setItem = () => { throw namedError(name); };
    assert.equal(manager.save(fresh(3)).ok, false); assert.notEqual(manager.status.phase, 'saved');
    assert.equal(manager.status.canSave, true); assert.equal(manager.status.generation, 2); assert.equal(manager.status.savedAt, savedAt);
    assert.equal(manager.status.code, name === 'SecurityError' ? 'access-denied' : name === 'QuotaExceededError' ? 'quota-exceeded' : 'storage-write-failed');
    assert.deepEqual([...storage.map], before);
    storage.setItem = write; assert.equal(manager.save(fresh(4)).ok, true);
    assert.equal(manager.status.phase, 'saved'); assert.equal(manager.status.code, null); assert.equal(manager.status.generation, 3);
    assert.equal(storage.map.get(SAVE_STORAGE_KEYS[1]), before[1][1]);
  });
}

test('localStorage property access throwing never escapes and cannot silently replace unknown existing data', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw namedError('SecurityError'); } });
  try {
    const manager = createSaveStorage(); assert.equal(manager.load().state, null);
    assert.equal(manager.status.phase, 'unavailable'); assert.equal(manager.status.code, 'access-denied');
    assert.equal(manager.save(fresh()).ok, false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

for (const storage of [null, undefined, {}, { getItem() {} }]) {
  test(`absent/incomplete storage ${JSON.stringify(storage)} stays memory-only`, () => {
    const manager = createSaveStorage({ getStorage: () => storage });
    assert.equal(manager.load().state, null); assert.equal(manager.status.phase, 'unavailable');
    assert.equal(manager.status.canSave, false); assert.equal(manager.save(fresh()).ok, false);
  });
}

test('startup read error even after the first successful key read does not permit a write', () => {
  const storage = memory({ [SAVE_STORAGE_KEYS[0]]: envelope(3) }); const read = storage.getItem;
  storage.getItem = function (key) { if (key === SAVE_STORAGE_KEYS[1]) throw namedError('SecurityError'); return read.call(this, key); };
  const { manager, loaded } = open(storage);
  assert.equal(loaded.state, null); assert.equal(manager.status.canSave, false); assert.equal(manager.save(fresh()).ok, false);
  storage.getItem = read; assert.equal(manager.save(fresh()).ok, false); assert.deepEqual(storage.writes, []);
});

test('generic startup read failure is unavailable until reload instead of falsely advertising retry', () => {
  const storage = memory(); storage.getItem = () => { throw new Error('Read failed'); };
  const { manager, loaded } = open(storage);
  assert.equal(loaded.state, null); assert.equal(manager.status.phase, 'unavailable');
  assert.equal(manager.status.code, 'storage-read-failed'); assert.equal(manager.status.canSave, false);
});

test('read or property access failure after valid loading is retryable without a false success', () => {
  const storage = memory({ [SAVE_STORAGE_KEYS[0]]: envelope(1) }); let error = null;
  const manager = createSaveStorage({ getStorage: () => { if (error) throw error; return storage; } }); manager.load();
  error = namedError('SecurityError'); assert.equal(manager.save(fresh(2)).ok, false);
  assert.equal(manager.status.canSave, true); assert.equal(manager.status.generation, 1);
  error = null; const read = storage.getItem; storage.getItem = () => { throw new Error('Read failed'); };
  assert.equal(manager.checkForExternalChanges(), false); assert.equal(manager.status.phase, 'failed');
  assert.equal(manager.status.code, 'storage-read-failed'); assert.equal(manager.status.canSave, true);
  storage.getItem = read; assert.equal(manager.save(fresh(3)).ok, true); assert.equal(manager.status.generation, 2);
});

test('invalid candidate cannot write over any valid data and subsequent valid save still works', () => {
  const { manager, storage } = open(memory({ [SAVE_STORAGE_KEYS[0]]: envelope(1) })); const before = [...storage.map];
  const data = JSON.parse(JSON.stringify(fresh())); data.achievements.unlocked.push({ id: 'normal-first-catch', unlockedAt: savedAt });
  assert.equal(manager.save(data).ok, false); assert.equal(manager.status.code, 'invalid-data');
  assert.deepEqual([...storage.map], before); assert.equal(manager.status.generation, 1);
  assert.equal(manager.save(fresh(2)).ok, true); assert.equal(manager.status.generation, 2);
});

test('corrupt collection and achievement mismatch rejects the whole candidate and leaves source bytes untouched', () => {
  const data = JSON.parse(JSON.stringify(fresh())); data.collection.wallet.balance = 100;
  const raw = envelope(2, data), storage = memory({ [SAVE_STORAGE_KEYS[0]]: raw });
  const { manager, loaded } = open(storage);
  assert.equal(loaded.state, null); assert.equal(manager.status.phase, 'protected');
  assert.equal(storage.map.get(SAVE_STORAGE_KEYS[0]), raw); assert.deepEqual(storage.writes, []);
});

test('an unexpected domain reconstruction failure keeps the valid save unchanged and disables writes', () => {
  const raw = envelope(2, fresh(42)), storage = memory({ [SAVE_STORAGE_KEYS[0]]: raw });
  const descriptor = Object.getOwnPropertyDescriptor(Date, 'now');
  Object.defineProperty(Date, 'now', { configurable: true, get() { throw new Error('Injected constructor environment failure'); } });
  try {
    const { manager, loaded } = open(storage);
    assert.equal(loaded.state, null); assert.equal(manager.status.phase, 'protected');
    assert.equal(manager.status.code, 'restore-failed'); assert.equal(manager.status.canSave, false);
    assert.equal(storage.map.get(SAVE_STORAGE_KEYS[0]), raw); assert.deepEqual(storage.writes, []);
  } finally { Object.defineProperty(Date, 'now', descriptor); }
});

for (const external of ['new-generation', 'same-generation', 'deletion', 'corruption']) {
  test(`other-tab ${external} is caught at preflight and blocks all stale saves`, () => {
    const storage = memory({ [SAVE_STORAGE_KEYS[0]]: envelope(1) }); const { manager } = open(storage);
    if (external === 'deletion') storage.map.delete(SAVE_STORAGE_KEYS[0]);
    else storage.map.set(SAVE_STORAGE_KEYS[0], external === 'corruption' ? '{broken' : envelope(external === 'new-generation' ? 2 : 1, fresh(99)));
    const before = [...storage.map]; assert.equal(manager.save(fresh(2)).ok, false);
    assert.equal(manager.status.phase, 'conflict'); assert.equal(manager.status.canSave, false);
    assert.equal(manager.save(fresh(3)).ok, false); assert.deepEqual([...storage.map], before); assert.deepEqual(storage.writes, []);
  });
}

test('storage-event check catches changes while idle and cannot be reset by calling load again', () => {
  const storage = memory(); const { manager } = open(storage);
  storage.map.set(SAVE_STORAGE_KEYS[1], envelope(1, fresh(99)));
  assert.equal(manager.checkForExternalChanges(), true); assert.equal(manager.status.phase, 'conflict');
  assert.equal(manager.load().state, null); assert.equal(manager.status.phase, 'conflict'); assert.equal(manager.save(fresh()).ok, false);
});

test('unchanged checkpoints and unrelated keys do not create spurious conflicts', () => {
  const { manager, storage } = open(); storage.map.set('another-app', 'content');
  assert.equal(manager.checkForExternalChanges(), false); assert.equal(manager.save(fresh()).ok, true);
  assert.equal(storage.map.get('another-app'), 'content'); assert.equal(manager.checkForExternalChanges(), false);
});

test('two independent managers cannot silently overwrite the one that saved first', () => {
  const storage = memory(); const first = open(storage).manager, second = open(storage).manager;
  assert.equal(second.save(fresh(20)).ok, true); const before = [...storage.map];
  assert.equal(first.save(fresh(10)).ok, false); assert.equal(first.status.phase, 'conflict'); assert.deepEqual([...storage.map], before);
});

test('status subscriptions receive immutable results only after storage success, and unsubscribe', () => {
  const storage = memory(), manager = createSaveStorage({ getStorage: () => storage }); const statuses = [];
  const unsubscribe = manager.subscribe(status => { assert.ok(Object.isFrozen(status)); statuses.push(status.phase); });
  manager.load(); manager.save(fresh()); unsubscribe(); manager.save(fresh(2));
  assert.deepEqual(statuses, ['empty', 'saved']); assert.equal(manager.status.generation, 2);
});

test('a broken status subscriber cannot turn an atomic write into a reported failure', () => {
  const storage = memory(), manager = createSaveStorage({ getStorage: () => storage }); const notifications = [];
  const originalError = console.error; const logged = []; console.error = (...args) => logged.push(args);
  try {
    manager.subscribe(() => { throw new Error('Presentation failed'); });
    manager.subscribe(status => notifications.push(status.phase));
    assert.equal(manager.load().status.phase, 'empty'); assert.equal(manager.save(fresh()).ok, true);
    assert.deepEqual(notifications, ['empty', 'saved']); assert.equal(logged.length, 2);
    assert.equal(storage.writes.length, 1); assert.equal(manager.status.phase, 'saved');
  } finally { console.error = originalError; }
});

test('deep hostile unknown fields are rejected before recursive serialization', () => {
  const body = JSON.stringify(fresh()).replace('"settings":{}', '"settings":' + '['.repeat(20000) + '0' + ']'.repeat(20000));
  const raw = '{"storageVersion":1,"generation":1,"data":' + body + '}';
  const { manager, loaded, storage } = open(memory({ [SAVE_STORAGE_KEYS[0]]: raw }));
  assert.equal(loaded.state, null); assert.equal(manager.status.phase, 'protected');
  assert.equal(manager.save(fresh()).ok, false); assert.deepEqual(storage.writes, []);
});

test('a mutable candidate changing inside setItem cannot change the reported snapshot timestamp', () => {
  const data = JSON.parse(JSON.stringify(fresh())); const storage = memory(); const write = storage.setItem;
  storage.setItem = function (key, value) { data.savedAt = '2030-01-01T00:00:00Z'; write.call(this, key, value); };
  const { manager } = open(storage); assert.equal(manager.save(data).ok, true);
  assert.equal(manager.status.savedAt, savedAt); assert.equal(JSON.parse(storage.writes[0].value).data.savedAt, savedAt);
});

test('save cannot run before load, and restore never changes a saved unassigned fish in storage', () => {
  const data = fresh(), state = restoreSaveData(data);
  state.collection.register({ schemaVersion: 1, id: 'pending', speciesId: 'black-bass', lengthCm: 40, weightKg: 1, caughtAt: savedAt });
  const pending = createSaveData(state, { savedAt }), raw = envelope(4, pending);
  const storage = memory({ [SAVE_STORAGE_KEYS[0]]: raw }), manager = createSaveStorage({ getStorage: () => storage });
  assert.equal(manager.save(data).ok, false); assert.deepEqual(storage.reads, []);
  const restored = manager.load().state;
  assert.equal(restored.collection.stored.length, 1); assert.equal(restored.collection.catches[0].disposition, 'stored');
  assert.equal(storage.map.get(SAVE_STORAGE_KEYS[0]), raw); assert.equal(JSON.parse(raw).data.collection.catches[0].disposition, 'unassigned');
});
