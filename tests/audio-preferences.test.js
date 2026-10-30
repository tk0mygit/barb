import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_PREFERENCES_KEY, DEFAULT_AUDIO_PREFERENCES, createAudioPreferences, validateAudioPreferences } from '../src/audio/audio-preferences.js';
import { createSaveStorage, SAVE_STORAGE_KEYS } from '../src/game/save-storage.js';
import { createSaveData, serializeSaveData, restoreSaveData } from '../src/game/save-data.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { createAchievements } from '../src/game/achievements.js';
import { createBoatState } from '../src/game/boat.js';
import { createGameClock } from '../src/game/game-clock.js';
import { sampleAudioMix } from '../src/audio/audio-mix.js';

function memory() {
  const values = new Map(), writes = [];
  return { values, writes, getItem: key => values.get(key) ?? null, setItem(key, value) { values.set(key, value); writes.push(key); } };
}
const valid = { version: 1, enabled: true, volume: 67 };

test('strict preferences, safe OFF defaults, load never writes/repairs, explicit changes only', () => {
  const storage = memory(), store = createAudioPreferences({ getStorage: () => storage });
  assert.deepEqual(store.load(), { preferences: DEFAULT_AUDIO_PREFERENCES, persistence: 'default' });
  assert.deepEqual(storage.writes, []);
  const getter = { version: 1, enabled: true }; Object.defineProperty(getter, 'volume', { get() { throw Error('must not run'); } });
  for (const invalid of [null, [], true, {}, { ...valid, version: 2 }, { ...valid, enabled: 1 },
    { ...valid, enabled: 'true' }, { ...valid, volume: '40' }, { ...valid, volume: 100.1 }, { ...valid, volume: -1 },
    { ...valid, volume: 101 }, { ...valid, volume: Infinity }, { ...valid, volume: NaN }, { ...valid, extra: {} },
    Object.assign(Object.create({}), valid), getter, { ...valid, [Symbol('extra')]: 1 }]) {
    assert.equal(validateAudioPreferences(invalid), null); assert.equal(store.save(invalid), 'invalid');
  }
  for (const raw of ['{', 'null', '[]', '{"version":1,"enabled":true}', JSON.stringify({ ...valid, volume: 200 }), ' '.repeat(257)]) {
    storage.values.set(AUDIO_PREFERENCES_KEY, raw);
    assert.deepEqual(store.load(), { preferences: DEFAULT_AUDIO_PREFERENCES, persistence: 'invalid' });
    assert.equal(storage.values.get(AUDIO_PREFERENCES_KEY), raw);
  }
  assert.deepEqual(storage.writes, []);
  assert.equal(store.save(valid), 'saved');
  assert.deepEqual(createAudioPreferences({ getStorage: () => storage }).load(), { preferences: valid, persistence: 'loaded' });
  assert.deepEqual(storage.writes, [AUDIO_PREFERENCES_KEY]);
  for (const volume of [0, 100]) assert.ok(validateAudioPreferences({ ...valid, volume }));
});

test('storage property access, read and write failures are isolated', () => {
  for (const getStorage of [() => { throw Error('SecurityError'); }, () => null,
    () => ({ getItem() { throw Error('denied'); } })]) {
    const store = createAudioPreferences({ getStorage });
    assert.deepEqual(store.load(), { preferences: DEFAULT_AUDIO_PREFERENCES, persistence: 'unavailable' });
    assert.equal(store.save(valid), 'failed');
  }
  const store = createAudioPreferences({ getStorage: () => ({ getItem: () => JSON.stringify(valid), setItem() { throw Error('QuotaExceededError'); } }) });
  assert.deepEqual(store.load().preferences, valid); assert.equal(store.save(valid), 'failed');
});

test('canonical game saves stay byte-identical across audio changes, including slots, generations and conflict checks', () => {
  const collection = createCatchCollection(), achievements = createAchievements({ collection });
  const storage = memory(), preferences = createAudioPreferences({ getStorage: () => storage });
  const state = { collection, achievements, boat: createBoatState(), clock: createGameClock(undefined, { elapsedSeconds: 906 }) };
  const data = createSaveData(state, { savedAt: '2026-10-23T00:00:00Z' });
  const original = serializeSaveData(data), game = createSaveStorage({ getStorage: () => storage });
  game.load(); assert.equal(game.save(data).ok, true); assert.equal(game.save(data).ok, true);
  const slots = SAVE_STORAGE_KEYS.map(key => storage.getItem(key));
  preferences.save(valid); assert.equal(game.checkForExternalChanges(), false);
  assert.deepEqual(SAVE_STORAGE_KEYS.map(key => storage.getItem(key)), slots);
  const reread = createSaveStorage({ getStorage: () => storage }).load();
  assert.equal(reread.status.generation, 2); assert.equal(reread.status.phase, 'restored');
  assert.deepEqual(sampleAudioMix(reread.state.clock.state), sampleAudioMix(state.clock.state));
  assert.equal(serializeSaveData(createSaveData(restoreSaveData(data), { savedAt: data.savedAt })), original);
  assert.equal(game.save(data).ok, true); assert.equal(game.status.generation, 3);
  assert.deepEqual(data.settings, {}); assert.equal(data.saveVersion, 2);
  storage.values.set(SAVE_STORAGE_KEYS[0], 'external change'); assert.equal(game.checkForExternalChanges(), true);
  preferences.save({ ...valid, enabled: false }); assert.equal(game.status.phase, 'conflict');
});
