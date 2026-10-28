import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLightingSave, LIGHTING_SAVE_BASE_SHA } from './helpers/lighting-save.js';
import { createSaveData, restoreSaveData } from '../src/game/save-data.js';
import { createSaveStorage, SAVE_STORAGE_KEYS } from '../src/game/save-storage.js';
import { sampleDayNight } from '../src/world/day-night.js';

test('lighting fixture comes from the pinned old main and both actual save runtimes restore identical clocks/boats', async t => {
  const root = await mkdtemp(join(tmpdir(), 'barb-lighting-save-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archive = execFileSync('git', ['archive', '--format=tar', LIGHTING_SAVE_BASE_SHA, 'src/game', 'src/world', 'package.json']);
  execFileSync('tar', ['-xf', '-', '-C', root], { input: archive });
  const oldSave = await import(pathToFileURL(join(root, 'src/game/save-data.js')).href);
  const oldStorage = await import(pathToFileURL(join(root, 'src/game/save-storage.js')).href);
  const oldClock = await import(pathToFileURL(join(root, 'src/game/game-clock.js')).href);
  for (const seconds of [0, 90, 176, 178, 180, 210, 270, 630, 898, 932, 3971 * 360 + 270]) {
    const data = createLightingSave(seconds);
    assert.deepEqual(data.achievements, { unlocked: [] });
    assert.deepEqual(oldSave.validateSaveData(data), data);
    assert.deepEqual(oldSave.createSaveData(oldSave.restoreSaveData(data), { savedAt: data.savedAt }), data);
    const raw = JSON.stringify({ storageVersion: 1, generation: 1, data });
    for (const factory of [oldStorage.createSaveStorage, createSaveStorage]) {
      const slots = new Map([[SAVE_STORAGE_KEYS[0], raw]]), writes = [];
      const manager = factory({ getStorage: () => ({ getItem: key => slots.get(key) ?? null,
        setItem: (key, value) => { writes.push(key); slots.set(key, value); } }) });
      const { state, status } = manager.load();
      assert.equal(status.phase, 'restored'); assert.equal(status.canSave, true);
      assert.deepEqual(state.clock.state, oldClock.createGameClock(undefined, { elapsedSeconds: seconds }).state);
      assert.deepEqual(state.boat, { ...data.boat, mode: 'sailing', speed: 0 });
      assert.deepEqual([...slots.values()], [raw]); assert.deepEqual(writes, []);
      state.achievements.dispose();
    }
  }
  const night = createLightingSave(270), restored = restoreSaveData(night);
  const current = createSaveData(restored, { savedAt: night.savedAt });
  assert.equal(current.achievements.contractVersion, 2);
  assert.throws(() => oldSave.restoreSaveData(current), error => error.code === 'invalid-data' && error.path === 'achievements');
  assert.equal(sampleDayNight(restored.clock.state).ambientIntensity, 0.65);
  assert.equal(sampleDayNight(oldClock.createGameClock().state).ambientIntensity, 1.525);
  assert.deepEqual(createSaveData(restoreSaveData(current), { savedAt: night.savedAt }), current);
  // The fixed input never acquires the current serializer's discriminator.
  assert.deepEqual(night.achievements, { unlocked: [] });
});
