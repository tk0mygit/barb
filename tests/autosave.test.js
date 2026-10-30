import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutosave, AUTOSAVE_TIMING } from '../src/game/autosave.js';
import { createSaveData, parseSaveData, restoreSaveData } from '../src/game/save-data.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { createAchievements, NORMAL_ACHIEVEMENTS } from '../src/game/achievements.js';
import { createBoatState } from '../src/game/boat.js';
import { createGameClock } from '../src/game/game-clock.js';
import { PHASE } from '../src/game/fishing.js';
import { createSaveStorage, SAVE_STORAGE_KEYS } from '../src/game/save-storage.js';

const timestamp = '2026-10-23T00:00:00.000Z';
const record = (id, extra = {}) => ({ schemaVersion: 1, id, speciesId: 'black-bass',
  lengthCm: 40, weightKg: 1, qteSuccessCount: 0, caughtAt: timestamp, ...extra });
function session() {
  const collection = createCatchCollection({ now: () => Date.parse(timestamp) });
  return { collection, achievements: createAchievements({ collection, now: () => Date.parse(timestamp) }),
    boat: createBoatState(), clock: createGameClock() };
}
function timers() {
  let elapsed = 0, id = 0;
  const pending = new Map();
  const add = (callback, delay, interval = 0) => {
    const handle = ++id;
    pending.set(handle, { callback, at: elapsed + delay, interval });
    return handle;
  };
  return {
    schedule: (callback, ms) => add(callback, ms), cancel: handle => pending.delete(handle),
    repeat: (callback, ms) => add(callback, ms, ms), cancelRepeat: handle => pending.delete(handle),
    monotonicNow: () => elapsed, now: () => Date.parse(timestamp) + elapsed,
    get pending() { return pending.size; },
    advance(ms) {
      const end = elapsed + ms;
      for (;;) {
        const next = [...pending].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        const [handle, timer] = next;
        elapsed = timer.at;
        if (timer.interval) timer.at += timer.interval;
        else pending.delete(handle);
        timer.callback();
      }
      elapsed = end;
    },
  };
}
function memoryStorage(phase = 'empty') {
  const listeners = new Set(), writes = [];
  let current = { phase, code: null, canSave: !['protected', 'conflict', 'unavailable'].includes(phase),
    savedAt: phase === 'restored' ? timestamp : null, restoredFromBackup: phase === 'backup', generation: 0 };
  const emit = () => { for (const listener of listeners) listener(current); };
  return {
    writes, fail: null, failPhase: 'failed', duringSave: null,
    get status() { return current; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    save(data) {
      if (this.fail) {
        current = { ...current, phase: this.failPhase, code: this.fail };
        emit(); return { ok: false, status: current };
      }
      const parsed = parseSaveData(JSON.stringify(data));
      writes.push(parsed);
      this.duringSave?.();
      current = { ...current, phase: 'saved', code: null, generation: current.generation + 1, savedAt: data.savedAt };
      emit(); return { ok: true, status: current };
    },
    checkForExternalChanges() {
      current = { ...current, phase: 'conflict', code: 'external-change', canSave: false };
      emit(); return true;
    },
  };
}
function setup({ phase = 'empty', state = session() } = {}) {
  const storage = memoryStorage(phase), time = timers();
  const autosave = createAutosave({ state, storage, ...time });
  return { state, storage, time, autosave };
}
function income(collection, id = 'income') {
  collection.register(record(id, { weightKg: 100 }));
  collection.sellUnassigned(id);
}

test('no save, subscriptions or scheduled work before initialization explicitly starts autosave', () => {
  const { state, storage, time, autosave } = setup();
  income(state.collection); state.clock.step(50); autosave.markProgress();
  assert.equal(autosave.flush().skipped, true);
  time.advance(60000);
  assert.equal(storage.writes.length, 0); assert.equal(time.pending, 0);
  assert.equal(autosave.status.started, false);
  autosave.dispose(); autosave.start();
  assert.equal(time.pending, 0);
});

test('first play is visibly unsaved until a real successful checkpoint; unchanged restored state does not write', () => {
  const fresh = setup(); fresh.autosave.start();
  assert.equal(fresh.autosave.status.phase, 'dirty');
  assert.equal(fresh.storage.writes.length, 0);
  fresh.time.advance(19999); assert.equal(fresh.storage.writes.length, 0);
  fresh.time.advance(1); assert.equal(fresh.storage.writes.length, 1);
  assert.equal(fresh.autosave.status.phase, 'saved');
  fresh.time.advance(40000); assert.equal(fresh.storage.writes.length, 1);
  const restored = setup({ phase: 'restored' }); restored.autosave.start();
  assert.equal(restored.autosave.status.phase, 'restored');
  restored.time.advance(60000); assert.equal(restored.storage.writes.length, 0);
});

test('catch, storage, immediate sale and purchase batch after synchronous achievement evaluation', () => {
  const { state, storage, time, autosave } = setup(); autosave.start();
  const c = state.collection;
  c.register(record('stored')); c.store('stored');
  income(c); assert.ok(c.purchaseUpgrade('rod', 1));
  assert.equal(storage.writes.length, 0);
  time.advance(249); assert.equal(storage.writes.length, 0);
  time.advance(1); assert.equal(storage.writes.length, 1);
  const data = storage.writes[0];
  assert.equal(data.collection.catches.length, 2);
  assert.equal(data.collection.catches[0].disposition, 'stored');
  assert.equal(data.collection.catches[1].disposition, 'sold');
  assert.equal(data.collection.wallet.balance, 9700);
  assert.equal(data.collection.equipment.rodLevel, 2);
  assert.deepEqual(data.achievements, state.achievements.snapshot);
  assert.ok(data.achievements.unlocked.some(item => item.id === 'normal-first-upgrade'));
  assert.equal(autosave.status.dirty, false);
});

for (const kind of ['individual', 'bulk']) test(`${kind} stored-fish sales save while the animation loop is paused`, () => {
  const { state, storage, time, autosave } = setup(); autosave.start();
  for (const id of ['a', 'b']) { state.collection.register(record(id)); state.collection.store(id); }
  time.advance(250);
  if (kind === 'individual') state.collection.sellStored(['a']);
  else state.collection.sellStored(state.collection.quoteStored().ids);
  time.advance(1000);
  assert.equal(storage.writes.length, 2);
  assert.equal(storage.writes[1].collection.wallet.balance, kind === 'individual' ? 100 : 200);
  assert.equal(storage.writes[1].collection.catches.filter(item => item.disposition === 'sold').length, kind === 'individual' ? 1 : 2);
});

test('failed sales and purchases do not request saves', () => {
  const { state, storage, time, autosave } = setup({ phase: 'restored' }); autosave.start();
  assert.equal(state.collection.sellStored(['missing']), null);
  assert.equal(state.collection.sellUnassigned('missing'), null);
  assert.equal(state.collection.purchaseUpgrade('rod', 1), null);
  time.advance(60000);
  assert.equal(storage.writes.length, 0); assert.equal(autosave.status.dirty, false);
});

test('boat and clock progress stay cheap per frame and write at the 20-second interval only when changed', () => {
  const { state, storage, time, autosave } = setup({ phase: 'restored' }); autosave.start();
  let notices = 0; autosave.subscribe(() => notices++);
  for (let frame = 0; frame < 1200; frame++) {
    state.clock.step(1 / 60); state.boat.x += 0.001;
    autosave.markProgress(); time.advance(1000 / 60);
  }
  time.advance(0.00001);
  assert.equal(storage.writes.length, 1);
  assert.ok(Math.abs(storage.writes[0].clock.elapsedSeconds - 20) < 1e-8);
  assert.ok(Math.abs(storage.writes[0].boat.x - 1.2) < 1e-8);
  assert.ok(notices <= 3, `${notices} status notifications during 1200 frames`);
  time.advance(40000); assert.equal(storage.writes.length, 1);
  state.boat.heading = 1; autosave.markProgress();
  time.advance(20000); assert.equal(storage.writes.length, 2);
});

test('lifecycle flush bypasses batching and captures progress even without a frame mark', () => {
  const { state, storage, time, autosave } = setup({ phase: 'restored' }); autosave.start();
  state.collection.register(record('result'));
  state.clock.step(12); Object.assign(state.boat, { x: 5, heading: 2 });
  assert.equal(autosave.flush().ok, true);
  assert.equal(storage.writes.length, 1);
  assert.equal(storage.writes[0].collection.catches[0].disposition, 'unassigned');
  assert.equal(storage.writes[0].clock.elapsedSeconds, 12);
  assert.equal(storage.writes[0].boat.x, 5);
  assert.equal(autosave.flush().skipped, true);
  time.advance(250); assert.equal(storage.writes.length, 1);
});

for (const phase of [PHASE.CAST, PHASE.BITE, PHASE.FIGHT, PHASE.LANDING]) {
  test(`automatic event checkpoints defer during ${phase} and save at the next safe state`, () => {
    const state = session(); state.fishing = { state: { phase } };
    const { storage, time, autosave } = setup({ state, phase: 'restored' }); autosave.start();
    state.collection.register(record('pending'));
    time.advance(250); assert.equal(storage.writes.length, 0);
    time.advance(5000); assert.equal(storage.writes.length, 0);
    assert.equal(autosave.status.dirty, true);
    state.fishing.state.phase = PHASE.RESULT;
    time.advance(1000);
    assert.equal(storage.writes.length, 1);
    assert.equal(storage.writes[0].collection.catches.length, 1);
    assert.equal(autosave.status.dirty, false);
  });
}

test('periodic progress defers during a fight but lifecycle flush remains synchronous', () => {
  const state = session(); state.fishing = { state: { phase: PHASE.FIGHT } };
  const { storage, time, autosave } = setup({ state, phase: 'restored' }); autosave.start();
  state.clock.step(20); state.boat.x = 2; autosave.markProgress();
  time.advance(20000); assert.equal(storage.writes.length, 0);
  time.advance(1000); assert.equal(storage.writes.length, 0);
  assert.equal(autosave.flush().ok, true);
  assert.equal(storage.writes.length, 1); assert.equal(storage.writes[0].clock.elapsedSeconds, 20);
  time.advance(1000); assert.equal(storage.writes.length, 1);
});

test('periodic retry saves pending fight progress within one second after returning to READY', () => {
  const state = session(); state.fishing = { state: { phase: PHASE.FIGHT } };
  const { storage, time, autosave } = setup({ state, phase: 'restored' }); autosave.start();
  state.clock.step(20); autosave.markProgress(); time.advance(20000);
  assert.equal(storage.writes.length, 0);
  state.fishing.state.phase = PHASE.READY; time.advance(1000);
  assert.equal(storage.writes.length, 1); assert.equal(autosave.status.phase, 'saved');
});

test('aiming does not indefinitely hold an important transaction checkpoint', () => {
  const state = session(); state.fishing = { state: { phase: PHASE.AIM } };
  const { storage, time, autosave } = setup({ state, phase: 'restored' }); autosave.start();
  state.collection.register(record('pending')); time.advance(250);
  assert.equal(storage.writes.length, 1);
});

test('failed save retains dirty progress and retries without falsely displaying saved', () => {
  const { state, storage, time, autosave } = setup(); autosave.start();
  storage.fail = 'quota-exceeded'; income(state.collection);
  time.advance(250);
  assert.equal(autosave.status.phase, 'failed'); assert.equal(autosave.status.code, 'quota-exceeded');
  assert.equal(autosave.status.dirty, true); assert.equal(storage.writes.length, 0);
  storage.fail = null; time.advance(19750);
  assert.equal(storage.writes.length, 1); assert.equal(storage.writes[0].collection.wallet.balance, 10000);
  assert.equal(autosave.status.phase, 'saved'); assert.equal(autosave.status.dirty, false);
});

test('new transactions can retry a failed checkpoint before the periodic timer', () => {
  const { state, storage, time, autosave } = setup(); autosave.start();
  storage.fail = 'write-failed'; state.collection.register(record('one')); time.advance(250);
  storage.fail = null; state.collection.store('one'); time.advance(1000);
  assert.equal(storage.writes.length, 1);
  assert.equal(storage.writes[0].collection.catches[0].disposition, 'stored');
});

test('retryable access denial stays visibly unavailable rather than looking merely unsaved', () => {
  const { state, storage, time, autosave } = setup(); autosave.start();
  storage.fail = 'access-denied'; storage.failPhase = 'unavailable';
  state.collection.register(record('one')); time.advance(250);
  assert.equal(autosave.status.phase, 'unavailable');
  assert.equal(autosave.status.canSave, true); assert.equal(autosave.status.dirty, true);
  state.collection.store('one');
  assert.equal(autosave.status.phase, 'unavailable');
  storage.fail = null; time.advance(1000);
  assert.equal(storage.writes.length, 1); assert.equal(autosave.status.phase, 'saved');
});

for (const phase of ['protected', 'unavailable', 'conflict']) test(`${phase} storage is never overwritten by the new in-memory session`, () => {
  const { state, storage, time, autosave } = setup({ phase }); autosave.start();
  income(state.collection); state.clock.step(10); autosave.markProgress();
  assert.equal(autosave.flush().ok, false); time.advance(60000);
  assert.equal(storage.writes.length, 0); assert.equal(autosave.status.phase, phase);
  assert.equal(autosave.status.dirty, true);
});

test('external update stops pending writes and warns through the same status subscription', () => {
  const { state, storage, time, autosave } = setup({ phase: 'restored' }); autosave.start();
  state.collection.register(record('old-tab'));
  let status; autosave.subscribe(next => { status = next; });
  assert.equal(autosave.checkForExternalChanges(), true);
  time.advance(60000);
  assert.equal(storage.writes.length, 0); assert.equal(status.phase, 'conflict');
  assert.equal(status.dirty, true);
});

test('backup recovery stays visible while dirty and after successful saves', () => {
  const { state, storage, time, autosave } = setup({ phase: 'backup' }); autosave.start();
  assert.equal(autosave.status.phase, 'backup');
  state.collection.register(record('one'));
  assert.equal(autosave.status.phase, 'dirty'); assert.equal(autosave.status.restoredFromBackup, true);
  time.advance(250); assert.equal(storage.writes.length, 1);
  assert.equal(autosave.status.phase, 'saved'); assert.equal(autosave.status.restoredFromBackup, true);
});

test('continuous changes have a fixed deadline and at most one automatic write per second', () => {
  const { state, storage, time, autosave } = setup({ phase: 'restored' }); autosave.start();
  for (let i = 0; i < 40; i++) { state.collection.register(record(`fish-${i}`)); time.advance(100); }
  assert.equal(storage.writes.length, 4);
  assert.equal(storage.writes[0].collection.catches.length, 3);
  time.advance(1000);
  assert.equal(storage.writes.length, 5);
  assert.equal(storage.writes.at(-1).collection.catches.length, 40);
  const milliseconds = storage.writes.map(data => Date.parse(data.savedAt));
  assert.ok(milliseconds.slice(1).every((value, i) => value - milliseconds[i] >= AUTOSAVE_TIMING.minAttemptMs));
});

test('periodic saving obeys the automatic attempt limit after a recent event checkpoint', () => {
  const { state, storage, time, autosave } = setup({ phase: 'restored' }); autosave.start();
  time.advance(19600); state.collection.register(record('one')); time.advance(250);
  state.clock.step(1); autosave.markProgress(); time.advance(150);
  assert.equal(storage.writes.length, 1); assert.equal(autosave.status.dirty, true);
  time.advance(20000); assert.equal(storage.writes.length, 2);
});

test('wall-clock reversal cannot delay a transaction indefinitely or change generation logic', () => {
  const state = session(), storage = memoryStorage('restored'), time = timers();
  let wall = Date.parse(timestamp);
  const autosave = createAutosave({ state, storage, ...time, now: () => wall }); autosave.start();
  state.collection.register(record('one')); time.advance(250);
  wall -= 86400000; state.collection.store('one'); time.advance(1000);
  assert.equal(storage.writes.length, 2);
  assert.ok(storage.writes[1].savedAt < storage.writes[0].savedAt);
});

test('a collection change during storage write leaves the newer revision pending', () => {
  const { state, storage, time, autosave } = setup({ phase: 'restored' }); autosave.start();
  state.collection.register(record('one'));
  storage.duringSave = () => { storage.duringSave = null; state.collection.store('one'); };
  time.advance(250);
  assert.equal(storage.writes.length, 1);
  assert.equal(storage.writes[0].collection.catches[0].disposition, 'unassigned');
  assert.equal(autosave.status.phase, 'dirty');
  time.advance(1000);
  assert.equal(storage.writes.length, 2);
  assert.equal(storage.writes[1].collection.catches[0].disposition, 'stored');
  assert.equal(autosave.status.dirty, false);
});

test('boat/clock mutation and nested flush during save never acknowledge stale state as current', () => {
  const { state, storage, time, autosave } = setup(); autosave.start();
  storage.duringSave = () => {
    storage.duringSave = null; state.clock.step(5); state.boat.x = 10;
    assert.equal(autosave.flush().skipped, true);
  };
  autosave.flush();
  assert.equal(storage.writes.length, 1); assert.equal(storage.writes[0].boat.x, 0);
  assert.equal(autosave.status.dirty, true);
  time.advance(20000);
  assert.equal(storage.writes.length, 2); assert.equal(storage.writes[1].boat.x, 10);
  assert.equal(storage.writes[1].clock.elapsedSeconds, 5);
});

test('invalid live state never reaches storage and can recover once the state is valid', () => {
  const { state, storage, time, autosave } = setup(); autosave.start();
  state.boat.x = Infinity; autosave.markProgress();
  assert.equal(autosave.flush().ok, false);
  assert.equal(storage.writes.length, 0); assert.equal(autosave.status.phase, 'failed');
  state.boat.x = 0; time.advance(20000);
  assert.equal(storage.writes.length, 1); assert.equal(autosave.status.phase, 'saved');
});

test('disposing cancels timers and subscriptions, and cannot accidentally restart', () => {
  const { state, storage, time, autosave } = setup(); autosave.start(); autosave.start();
  state.collection.register(record('one')); assert.equal(time.pending, 2);
  autosave.dispose(); autosave.dispose(); assert.equal(time.pending, 0);
  state.collection.store('one'); state.clock.step(50); autosave.markProgress();
  autosave.start(); autosave.flush(); time.advance(60000);
  assert.equal(storage.writes.length, 0); assert.equal(time.pending, 0);
});

test('real storage integration preserves committed money, equipment, awards and progress across startup', () => {
  const values = new Map();
  const local = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const storage = createSaveStorage({ getStorage: () => local });
  assert.equal(storage.load().state, null);
  const state = session(), time = timers(), autosave = createAutosave({ state, storage, ...time });
  autosave.start(); income(state.collection);
  state.collection.register(record('reserve')); state.collection.store('reserve');
  state.collection.purchaseUpgrade('rod', 1);
  Object.assign(state.boat, { x: 10, z: 20, heading: 2 }); state.clock.step(30);
  autosave.markProgress(); time.advance(250);
  assert.equal(autosave.status.phase, 'saved');
  const restored = createSaveStorage({ getStorage: () => local }).load().state;
  assert.deepEqual(restored.collection.snapshot, state.collection.snapshot);
  assert.deepEqual(restored.achievements.snapshot, state.achievements.snapshot);
  assert.deepEqual(restored.boat, { x: 10, z: 20, heading: 2, mode: 'sailing', speed: 0 });
  assert.equal(restored.clock.state.elapsedSeconds, 30);
  assert.ok(restored.collection.sellStored(['reserve']));
  assert.ok(restored.collection.purchaseUpgrade('reel', 1));
});

test('real storage pre-write generation check stops an old tab even without a storage event', () => {
  const values = new Map();
  const local = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const originalStorage = createSaveStorage({ getStorage: () => local }); originalStorage.load();
  const oldState = session(), time = timers();
  const autosave = createAutosave({ state: oldState, storage: originalStorage, ...time });
  autosave.start(); income(oldState.collection); time.advance(250);
  const otherStorage = createSaveStorage({ getStorage: () => local });
  const otherState = otherStorage.load().state;
  assert.ok(otherState.collection.purchaseUpgrade('rod', 1));
  assert.equal(otherStorage.save(createSaveData(otherState)).ok, true);
  const remoteCheckpoint = SAVE_STORAGE_KEYS.map(key => values.get(key));
  oldState.collection.register(record('old-catch')); time.advance(1000);
  assert.equal(autosave.status.phase, 'conflict'); assert.equal(autosave.status.dirty, true);
  assert.deepEqual(SAVE_STORAGE_KEYS.map(key => values.get(key)), remoteCheckpoint);
  assert.equal(createSaveStorage({ getStorage: () => local }).load().state.collection.equipment.rodLevel, 2);
});

test('large-history measurement: 20,000 records are assembled only at checkpoint, with bounded write count', t => {
  const base = JSON.parse(JSON.stringify(createSaveData(session(), { savedAt: timestamp })));
  base.collection.catches = Array.from({ length: 20000 }, (_, i) => ({ ...record(`large-${i}`), disposition: 'stored' }));
  base.achievements.unlocked = NORMAL_ACHIEVEMENTS.filter(item => item.metric === 'catches')
    .map(item => ({ id: item.id, unlockedAt: timestamp }));
  const state = restoreSaveData(base), { storage, time, autosave } = setup({ state, phase: 'restored' });
  autosave.start();
  const progressStart = performance.now();
  for (let frame = 0; frame < 1200; frame++) { state.clock.step(1 / 60); autosave.markProgress(); }
  const progressMs = performance.now() - progressStart;
  assert.equal(storage.writes.length, 0);
  const saveStart = performance.now(); time.advance(20000);
  const saveMs = performance.now() - saveStart;
  assert.equal(storage.writes.length, 1); assert.equal(storage.writes[0].collection.catches.length, 20000);
  time.advance(20000); assert.equal(storage.writes.length, 1);
  t.diagnostic(`20,000 catches: 1200 progress marks ${progressMs.toFixed(1)} ms total; one assembly + validate/serialize/readback ${saveMs.toFixed(1)} ms; 1 write, 0 per-frame JSON snapshots`);
});
