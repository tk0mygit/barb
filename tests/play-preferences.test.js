import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayPreferences, validatePlayPreferences, DEFAULT_PLAY_PREFERENCES, PLAY_PREFERENCES_KEY } from '../src/game/play-preferences.js';
import { createGameplay } from '../src/game/gameplay.js';
import { createSaveData, serializeSaveData } from '../src/game/save-data.js';
import { createSaveStorage, SAVE_STORAGE_KEYS } from '../src/game/save-storage.js';
import { AUDIO_PREFERENCES_KEY } from '../src/audio/audio-preferences.js';

function memory() {
  const values = new Map(), writes = [];
  return { values, writes, getItem: key => values.get(key) ?? null,
    setItem(key, value) { values.set(key, value); writes.push(key); } };
}
const valid = { version: 1, dayNightSkip: true };

test('strict versioned boolean preferences; missing/corrupt/extra/getter data fail closed without repair', () => {
  const storage = memory();
  const getter = { version: 1 }; Object.defineProperty(getter, 'dayNightSkip', { get() { throw Error('must not execute'); } });
  for (const invalid of [null, true, [], {}, { version: 1 }, { ...valid, version: 2 }, { ...valid, dayNightSkip: 'true' },
    { ...valid, dayNightSkip: 1 }, { ...valid, extra: 1 }, { ...valid, [Symbol()]: 1 }, Object.assign(Object.create({}), valid), getter]) {
    assert.equal(validatePlayPreferences(invalid), null);
  }
  for (const raw of [null, '{', 'null', '[]', 'true', '{}', JSON.stringify({ ...valid, version: 0 }),
    JSON.stringify({ ...valid, extra: true }), ' '.repeat(129)]) {
    if (raw === null) storage.values.delete(PLAY_PREFERENCES_KEY); else storage.values.set(PLAY_PREFERENCES_KEY, raw);
    const store = createPlayPreferences({ getStorage: () => storage, eventTarget: null });
    assert.deepEqual(store.state, DEFAULT_PLAY_PREFERENCES); assert.equal(storage.getItem(PLAY_PREFERENCES_KEY), raw);
    store.dispose();
  }
  assert.deepEqual(storage.writes, []);
  const store = createPlayPreferences({ getStorage: () => storage, eventTarget: null });
  store.setDayNightSkip('true'); assert.deepEqual(storage.writes, []);
  store.setDayNightSkip(true); assert.deepEqual(store.state, valid); assert.ok(Object.isFrozen(store.state));
  assert.deepEqual(createPlayPreferences({ getStorage: () => storage, eventTarget: null }).state, valid);
  store.setDayNightSkip(false); assert.deepEqual(store.state, DEFAULT_PLAY_PREFERENCES);
});

test('SecurityError/QuotaExceededError/getter/read/write failures permit session toggles without escaping', () => {
  for (const getStorage of [() => { throw new DOMException('denied', 'SecurityError'); }, () => null,
    () => ({ getItem() { throw new DOMException('denied', 'SecurityError'); }, setItem() { throw Error('read-only'); } }),
    () => ({ getItem: () => null, setItem() { throw new DOMException('full', 'QuotaExceededError'); } })]) {
    const store = createPlayPreferences({ getStorage, eventTarget: null });
    assert.equal(store.state.dayNightSkip, false);
    store.setDayNightSkip(true); assert.equal(store.state.dayNightSkip, true);
    store.setDayNightSkip(false); assert.equal(store.state.dayNightSkip, false);
    store.dispose();
  }
});

test('external events re-read latest storage, synchronize clear/invalid/unavailable to OFF and unsubscribe', () => {
  const storage = memory(), target = new EventTarget();
  const store = createPlayPreferences({ getStorage: () => storage, eventTarget: target });
  const changes = [], unsubscribe = store.subscribe(state => changes.push(state.dayNightSkip));
  const event = key => { const e = new Event('storage'); e.key = key; target.dispatchEvent(e); };
  storage.setItem(PLAY_PREFERENCES_KEY, JSON.stringify(valid));
  event('unrelated'); assert.equal(store.state.dayNightSkip, false);
  event(PLAY_PREFERENCES_KEY); assert.equal(store.state.dayNightSkip, true);
  storage.values.set(PLAY_PREFERENCES_KEY, '{'); event(PLAY_PREFERENCES_KEY); assert.equal(store.state.dayNightSkip, false);
  storage.values.set(PLAY_PREFERENCES_KEY, JSON.stringify(valid)); event(PLAY_PREFERENCES_KEY);
  storage.values.clear(); event(null); assert.equal(store.state.dayNightSkip, false);
  assert.deepEqual(changes, [true, false, true, false]);
  unsubscribe(); store.setDayNightSkip(true); assert.equal(changes.length, 4);
  store.dispose(); storage.values.clear(); event(null); assert.equal(store.state.dayNightSkip, true);
});

test('preferences never change old saves, game-slot generations, conflict checks or the audio key', () => {
  const storage = memory(), state = createGameplay(), game = createSaveStorage({ getStorage: () => storage });
  const data = createSaveData(state, { savedAt: '2026-11-13T00:00:00Z' }), bytes = serializeSaveData(data);
  storage.values.set(AUDIO_PREFERENCES_KEY, '{"version":1,"enabled":true,"volume":67}');
  game.load(); game.save(data); game.save(data);
  const slots = SAVE_STORAGE_KEYS.map(key => storage.getItem(key)), generation = game.status.generation;
  const store = createPlayPreferences({ getStorage: () => storage, eventTarget: null });
  const count = storage.writes.length;
  store.setDayNightSkip(true); store.setDayNightSkip(false);
  assert.deepEqual(storage.writes.slice(count), [PLAY_PREFERENCES_KEY, PLAY_PREFERENCES_KEY]);
  assert.deepEqual(SAVE_STORAGE_KEYS.map(key => storage.getItem(key)), slots);
  assert.equal(game.status.generation, generation); assert.equal(game.checkForExternalChanges(), false);
  assert.equal(storage.getItem(AUDIO_PREFERENCES_KEY), '{"version":1,"enabled":true,"volume":67}');
  assert.equal(serializeSaveData(createSaveData(state, { savedAt: data.savedAt })), bytes);
  assert.deepEqual(data.settings, {});
});
