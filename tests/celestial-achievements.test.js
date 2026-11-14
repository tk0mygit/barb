import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameplay } from '../src/game/gameplay.js';
import { NORMAL_ACHIEVEMENTS } from '../src/game/achievements.js';
import { createSaveData, parseSaveData, validateSaveData, serializeSaveData, restoreSaveData } from '../src/game/save-data.js';
import { createSaveStorage, SAVE_STORAGE_KEYS as keys } from '../src/game/save-storage.js';

const base = '65021907bf06f5a0f765af9ea18dc5f91d43289b', date = '2026-11-14T01:02:03.000Z';
const save = game => createSaveData(game, { savedAt: date });
let directory, source, oldSave, oldStorage, oldDefinitions;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'barb-sky5-source-'));
  execFileSync('tar', ['-xf', '-', '-C', directory], { input: execFileSync('git', ['archive', base, 'src/game', 'src/world', 'package.json']) });
  const load = name => import(pathToFileURL(join(directory, `src/game/${name}.js`)).href);
  oldSave = await load('save-data'); oldStorage = await load('save-storage'); oldDefinitions = (await load('achievements')).NORMAL_ACHIEVEMENTS;
  const game = (await load('gameplay')).createGameplay({ now: () => 1000 });
  const { FISH_SPECIES } = await load('fish-species');
  for (let i = 0; i < 100; i++) {
    const id = `old-${i}`;
    game.collection.register({ schemaVersion: 1, id, speciesId: FISH_SPECIES[i % 36].id, lengthCm: 100,
      weightKg: i === 0 ? 100000 : 1, qteSuccessCount: i % 4, caughtAt: date });
    game.collection.sellUnassigned(id);
  }
  for (const kind of ['rod', 'reel']) for (let level = 1; level < 10; level++) assert(game.collection.purchaseUpgrade(kind, level));
  game.clock.step(123456789 * 360 + 270);
  source = oldSave.createSaveData(game, { savedAt: date });
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

function memory(raw) {
  const map = new Map(keys.flatMap((key, i) => raw[i] == null ? [] : [[key, raw[i]]])), writes = [];
  return { map, writes, getItem: key => map.get(key) ?? null,
    setItem(key, value) { writes.push(key); map.set(key, value); } };
}
const envelope = (generation, data) => JSON.stringify({ storageVersion: 1, generation, data });

test('19 definitions append exact names/descriptions after all 17 unchanged source definitions', () => {
  assert.equal(NORMAL_ACHIEVEMENTS.length, 19); assert.deepEqual(NORMAL_ACHIEVEMENTS.slice(0, 17), oldDefinitions);
  assert.deepEqual(NORMAL_ACHIEVEMENTS.slice(17), [
    { id: 'normal-aurora-observed', name: 'レクイエム', description: '稀な天体イベントを観測する。', metric: 'observation', target: 1 },
    { id: 'normal-meteor-observed', name: '星に願いを', description: '非常に稀な天体イベントを観測する。', metric: 'observation', target: 1 },
  ]);
});

test('actual contract5 source validates/parses unchanged, restores/serializes to6, retaining all 17 dates with no inferred observations', () => {
  assert.equal(source.achievements.contractVersion, 5); assert.equal(source.achievements.unlocked.length, 17);
  const raw = JSON.stringify(source), expected = { ...source, achievements: { ...source.achievements, contractVersion: 6 } };
  assert.deepEqual(validateSaveData(source), source); assert.deepEqual(parseSaveData(raw), source);
  const game = restoreSaveData(source, { now: () => { throw Error('No manufactured dates'); } });
  assert.deepEqual(save(game), expected); assert.deepEqual(parseSaveData(serializeSaveData(source)), expected);
  assert.equal(JSON.stringify(source), raw);
  const notices = []; game.achievements.subscribe(batch => notices.push(batch));
  assert.deepEqual(game.achievements.evaluate(), []); assert.deepEqual(notices, []);
  assert.deepEqual(game.achievements.entries.slice(17).map(row => [row.unlocked, row.progress.value]), [[false, 0], [false, 0]]);
  assert.deepEqual(save(restoreSaveData(expected)), expected);
});

test('only explicit whitelisted observation events unlock, once each, and restore without notification/date changes', () => {
  let now = Date.parse(date); const game = restoreSaveData(source, { now: () => now }), notices = [];
  game.achievements.subscribe(batch => notices.push(batch));
  for (const kind of [undefined, null, 0, '', 'Aurora', 'stars', 'toString', {}, 'normal-aurora-observed']) assert.deepEqual(game.achievements.recordObservation(kind), []);
  for (const kind of ['aurora', 'meteor']) {
    const batch = game.achievements.recordObservation(kind); assert.equal(batch.length, 1);
    assert.deepEqual(batch[0].progress, { value: 1, target: 1 });
    assert.equal(batch[0].unlockedAt, new Date(now).toISOString());
    now += 10000; assert.deepEqual(game.achievements.recordObservation(kind), []);
  }
  assert.equal(game.achievements.unlockedCount, 19); assert.equal(notices.length, 2);
  const checkpoint = save(game), restored = restoreSaveData(parseSaveData(serializeSaveData(checkpoint)), { now: () => { throw Error('No replay'); } });
  restored.achievements.subscribe(() => { throw Error('Must not replay'); });
  assert.deepEqual(restored.achievements.evaluate(), []); assert.deepEqual(restored.achievements.recordObservation('aurora'), []);
  assert.deepEqual(save(restored), checkpoint);
  game.achievements.dispose(); assert.deepEqual(game.achievements.recordObservation('meteor'), []);
});

test('contract6 permits either observation independently but strictly rejects every missing/false legacy award and malformed new history', () => {
  for (const kinds of [[], ['aurora'], ['meteor'], ['aurora', 'meteor']]) {
    const game = restoreSaveData(source); for (const kind of kinds) game.achievements.recordObservation(kind);
    const data = save(game); assert.deepEqual(validateSaveData(data), data);
    for (const award of source.achievements.unlocked) {
      const bad = structuredClone(data); bad.achievements.unlocked = bad.achievements.unlocked.filter(row => row.id !== award.id);
      assert.throws(() => validateSaveData(bad), error => error.code === 'invalid-data' && error.path === `achievements.${award.id}`);
    }
  }
  const empty = save(createGameplay());
  for (const record of [{ id: 'normal-aurora-observed', unlockedAt: '2026-02-30T00:00:00Z' },
    { id: 'normal-meteor-observed', unlockedAt: '2026-11-14T00:00:00+09:00' }, { id: 'normal-aurora-observed' },
    { id: 'unknown', unlockedAt: date }]) {
    const bad = structuredClone(empty); bad.achievements.unlocked.push(record);
    assert.throws(() => validateSaveData(bad), error => error.code === 'invalid-data');
  }
  for (const id of ['normal-aurora-observed', 'normal-meteor-observed']) {
    const bad = structuredClone(empty); bad.achievements.unlocked.push({ id, unlockedAt: date }, { id, unlockedAt: date });
    assert.throws(() => validateSaveData(bad), error => error.code === 'invalid-data');
    const old = structuredClone(source); old.achievements.unlocked.push({ id, unlockedAt: date });
    assert.throws(() => validateSaveData(old));
  }
  const falseLegacy = structuredClone(empty); falseLegacy.achievements.unlocked.push({ id: 'normal-catch-10', unlockedAt: date });
  assert.throws(() => validateSaveData(falseLegacy), error => error.path === 'achievements.normal-catch-10');
});

test('contract5 two-slot load is read-only; canonical6 commit updates only inactive generation; old client/future/conflict protect raw bytes', () => {
  for (const active of [0, 1]) for (const other of [null, '{broken', envelope(8, source)]) {
    const raw = [other, other]; raw[active] = envelope(9, source);
    const storage = memory(raw), manager = createSaveStorage({ getStorage: () => storage }), loaded = manager.load();
    assert.equal(loaded.status.canSave, true); assert.deepEqual(storage.writes, []); assert.deepEqual(keys.map(storage.getItem), raw);
    const checkpoint = save(loaded.state); assert.equal(manager.save(checkpoint).ok, true);
    assert.deepEqual(storage.writes, [keys[1 - active]]); assert.equal(storage.getItem(keys[active]), raw[active]);
    const committed = JSON.parse(storage.getItem(keys[1 - active])); assert.equal(committed.generation, 10); assert.equal(committed.data.achievements.contractVersion, 6);
    const old = oldStorage.createSaveStorage({ getStorage: () => storage });
    assert.equal(old.load().status.code, 'unsupported-version'); assert.equal(old.save(source).ok, false);
    assert.throws(() => oldSave.validateSaveData(checkpoint), e => e.code === 'unsupported-version');
    const before = keys.map(storage.getItem); storage.map.set(keys[active], raw[active] + ' ');
    assert.equal(manager.save(checkpoint).ok, false); assert.equal(manager.status.code, 'external-change');
    assert.equal(storage.getItem(keys[1 - active]), before[1 - active]);
    const future = structuredClone(checkpoint); future.achievements.contractVersion = 7; future.extra = {};
    storage.map.set(keys[active], envelope(20, future)); const preserved = keys.map(storage.getItem);
    const protectedManager = createSaveStorage({ getStorage: () => storage }); assert.equal(protectedManager.load().status.code, 'unsupported-version');
    assert.equal(protectedManager.save(checkpoint).ok, false); assert.deepEqual(keys.map(storage.getItem), preserved);
  }
});
