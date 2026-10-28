import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaveData, validateSaveData, serializeSaveData, parseSaveData, restoreSaveData,
  tryRestoreSaveData, SaveDataError, SAVE_LIMITS } from '../src/game/save-data.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { createAchievements, NORMAL_ACHIEVEMENTS } from '../src/game/achievements.js';
import { createBoatState, isNavigableBoatPosition, stepBoat } from '../src/game/boat.js';
import { createGameClock } from '../src/game/game-clock.js';
import { createFishing, PHASE } from '../src/game/fishing.js';
import { FISH_SPECIES } from '../src/game/fish-species.js';
import { LAKE, shoreRadius } from '../src/world/config.js';

const savedAt = '2026-10-23T00:00:00.000Z';
const caughtAt = '2026-10-22T00:00:00.000Z';
const future = Date.parse('2027-01-01T00:00:00.000Z');
const record = (id, extra = {}) => ({ schemaVersion: 1, id, speciesId: 'black-bass', lengthCm: 40,
  weightKg: 1, caughtAt, ...extra });
const clone = value => JSON.parse(JSON.stringify(value));
function session() {
  const collection = createCatchCollection({ now: () => Date.parse(savedAt) });
  return { collection, achievements: createAchievements({ collection, now: () => Date.parse(savedAt) }),
    boat: createBoatState(), clock: createGameClock() };
}
const save = state => createSaveData(state, { savedAt });
const fresh = () => save(session());
function funded() {
  const state = session();
  state.collection.register(record('fund', { weightKg: 1000 })); state.collection.sellUnassigned('fund');
  return state;
}
function rejects(data, code = 'invalid-data') {
  assert.throws(() => validateSaveData(data), error => error instanceof SaveDataError && error.code === code);
}
function land(fishing) {
  assert.equal(fishing.prepare({ x: 0, z: 30 }, 0), true); fishing.aim(0, 180); fishing.cast();
  for (let i = 0; i < 3000 && fishing.state.phase !== PHASE.BITE; i++) fishing.step(1 / 60);
  assert.equal(fishing.hook(), true);
  for (let i = 0; i < 1800 && fishing.state.phase === PHASE.FIGHT; i++) {
    fishing.reel(fishing.state.tension < 0.65); fishing.step(1 / 60);
  }
  assert.equal(fishing.state.phase, PHASE.LANDING); fishing.step(2);
  assert.equal(fishing.state.phase, PHASE.RESULT);
}

test('initial versioned envelope, JSON and domain round trips preserve the existing snapshot schemas', () => {
  const state = session(), data = save(state);
  assert.deepEqual(data, { saveVersion: 1, savedAt,
    collection: { catches: [], wallet: { balance: 0, lifetimeSales: 0 }, equipment: { rodLevel: 1, reelLevel: 1 } },
    achievements: { contractVersion: 2, unlocked: [] }, boat: { x: 0, z: 30, heading: 0 }, clock: { elapsedSeconds: 0 }, settings: {} });
  const parsed = parseSaveData(serializeSaveData(data));
  assert.deepEqual(parsed, data); assert.notEqual(parsed, data);
  const restored = restoreSaveData(parsed);
  assert.deepEqual(save(restored), data); assert.deepEqual(restored.collection.snapshot, state.collection.snapshot);
  assert.equal(restored.collection.snapshot.schemaVersion, 1);
  assert.equal(restored.fishing.collection, restored.collection);
  assert.equal(restored.boat.mode, 'sailing'); assert.equal(restored.fishing.state.phase, PHASE.READY);
  assert.equal(restored.achievements.unlockedCount, 0);
});

test('save and restored domains are detached, deeply immutable, and never alter live state or old snapshots', () => {
  const state = funded(); state.collection.register(record('stored')); state.collection.store('stored');
  const data = save(state), before = state.collection.snapshot, input = clone(data);
  const validated = validateSaveData(input), restored = restoreSaveData(input);
  input.collection.catches[0].weightKg = 999; input.boat.x = 123;
  input.achievements.unlocked[0].unlockedAt = 'bad';
  assert.deepEqual(save(restored), data); assert.deepEqual(validated, data);
  restored.collection.sellStored(['stored']); restored.collection.purchaseUpgrade('rod', 1);
  assert.equal(state.collection.snapshot.catches, before.catches);
  assert.deepEqual(state.collection.snapshot, before); assert.deepEqual(data, save(state));
  for (const object of [data, data.collection, data.collection.catches, data.collection.catches[0], data.collection.wallet,
    data.collection.equipment, data.achievements, data.achievements.unlocked, data.achievements.unlocked[0], data.boat, data.clock, data.settings]) {
    assert.ok(Object.isFrozen(object));
  }
  assert.throws(() => { data.collection.catches[0].weightKg = 0; }, TypeError);
});

test('all 12 species, repeats, statistics, index, sales and unassigned rescue rebuild from catches only', () => {
  const state = session(), c = state.collection;
  FISH_SPECIES.forEach((fish, i) => {
    c.register(record(`fish-${i}`, { speciesId: fish.id, lengthCm: fish.maxLengthCm }));
    if (i % 3 === 0) c.sellUnassigned(`fish-${i}`);
    if (i % 3 === 1) c.store(`fish-${i}`);
  });
  c.register(record('repeat', { lengthCm: 52 })); c.store('repeat');
  const data = save(state), original = clone(data), { collection: restored, achievements } = restoreSaveData(data);
  assert.deepEqual(data, original);
  assert.equal('storedIds' in data.collection, false); assert.equal('encyclopedia' in data.collection, false);
  assert.deepEqual(restored.encyclopedia, c.encyclopedia);
  assert.equal(restored.encyclopedia[0].count, 2); assert.equal(restored.encyclopedia[0].maxLengthCm, 55);
  assert.equal(restored.stored.length, 9); assert.equal(restored.catches.length, 13);
  assert.ok(restored.catches.every(item => item.disposition !== 'unassigned'));
  assert.deepEqual(restored.catches.filter(item => item.disposition === 'sold'), c.catches.filter(item => item.disposition === 'sold'));
  assert.deepEqual(restored.wallet, c.wallet); assert.deepEqual(achievements.entries, state.achievements.entries);
  assert.equal(restored.register(record('fish-0')).disposition, 'sold');
  assert.equal(restored.catches.length, 13); assert.equal(restored.store('fish-0'), null);
  assert.equal(restored.sellUnassigned('fish-2'), null); // rescued and accessible through storage
  const quote = restored.quoteStored(); assert.equal(quote.count, 9);
  assert.equal(restored.sellStored(['fish-2']).count, 1);
  const newCatch = restored.register(record('new'));
  assert.equal(newCatch.disposition, 'unassigned'); assert.ok(restored.store('new'));
  restored.register(record('immediate')); assert.ok(restored.sellUnassigned('immediate'));
  assert.equal(restored.encyclopedia[0].count, 4);
});

for (let rodLevel = 1; rodLevel <= 10; rodLevel++) for (let reelLevel = 1; reelLevel <= 10; reelLevel++) {
  test(`restore rod Lv.${rodLevel} / reel Lv.${reelLevel}, then purchase and sell with lifetime income intact`, () => {
    const state = funded(), c = state.collection;
    for (const [kind, target] of [['rod', rodLevel], ['reel', reelLevel]]) {
      for (let level = 1; level < target; level++) assert.ok(c.purchaseUpgrade(kind, level));
    }
    const data = save(state), { collection } = restoreSaveData(data);
    assert.deepEqual(collection.equipment, { rodLevel, reelLevel }); assert.deepEqual(collection.wallet, c.wallet);
    for (const [kind, level] of [['rod', rodLevel], ['reel', reelLevel]]) {
      const status = collection.getUpgradeStatus(kind); assert.equal(status.currentLevel, level);
      assert.equal(collection.purchaseUpgrade(kind, level)?.level ?? null, level === 10 ? null : level + 1);
    }
    assert.equal(collection.wallet.lifetimeSales, 100000);
    collection.register(record('after')); assert.equal(collection.sellUnassigned('after').total, 100);
    assert.equal(collection.wallet.lifetimeSales, 100100);
  });
}

test('old ten and individual Lv.5 IDs/timestamps/progress restore before evaluation, silently and without wall-time reads', () => {
  const state = funded();
  for (let i = 1; i < 100; i++) state.collection.register(record(`fish-${i}`, {
    speciesId: FISH_SPECIES[i % 12].id, lengthCm: i === 1 ? 100 : 40,
  }));
  for (const kind of ['rod', 'reel']) for (let level = 1; level < 5; level++) state.collection.purchaseUpgrade(kind, level);
  const data = save(state); assert.equal(data.achievements.unlocked.length, 12);
  assert.deepEqual(new Set(data.achievements.unlocked.map(item => item.id)), new Set(NORMAL_ACHIEVEMENTS.slice(0, 12).map(item => item.id)));
  let wallReads = 0;
  const restored = restoreSaveData(data, { now: () => { wallReads++; return future; } });
  assert.equal(wallReads, 0); assert.deepEqual(restored.achievements.entries, state.achievements.entries);
  assert.deepEqual(restored.achievements.snapshot, data.achievements);
  const notices = []; restored.achievements.subscribe(awards => notices.push(awards));
  assert.deepEqual(restored.achievements.evaluate(), []);
  restored.collection.store('fish-1'); restored.collection.sellStored(['fish-2']);
  restored.collection.register(record('later')); assert.deepEqual(notices, []);
  assert.equal(wallReads, 1); // sale only
  assert.deepEqual(restored.achievements.snapshot, data.achievements);
});

test('restored awards never notify again; new achievements use the new event time and notify once', () => {
  const state = session();
  for (let i = 0; i < 9; i++) state.collection.register(record(String(i)));
  const restored = restoreSaveData(save(state), { now: () => future });
  const notices = []; restored.achievements.subscribe(awards => notices.push(...awards));
  assert.deepEqual(restored.achievements.evaluate(), []);
  restored.collection.register(record('tenth'));
  assert.deepEqual(notices.map(item => item.id), ['normal-catch-10']);
  assert.equal(notices[0].unlockedAt, new Date(future).toISOString());
  assert.equal(restored.achievements.snapshot.unlocked[0].unlockedAt, savedAt);
  restored.collection.register(record('tenth')); restored.achievements.evaluate(); assert.equal(notices.length, 1);
});

test('reject both directions of achievement/history contradiction rather than inventing dates', () => {
  const state = session(); state.collection.register(record('one'));
  const missing = clone(save(state)); missing.achievements.unlocked = []; rejects(missing);
  const impossible = clone(fresh()); impossible.achievements.unlocked = [{ id: 'normal-first-catch', unlockedAt: savedAt }]; rejects(impossible);
  const duplicate = clone(save(state)); duplicate.achievements.unlocked.push(duplicate.achievements.unlocked[0]); rejects(duplicate);
  for (const [id, unlockedAt] of [['missing', savedAt], ['normal-first-catch', '2026-02-30T00:00:00Z']]) {
    const bad = clone(save(state)); bad.achievements.unlocked[0] = { id, unlockedAt }; rejects(bad);
  }
});

test('JSON errors and unsupported versions have distinct stable error contracts', () => {
  assert.deepEqual(tryRestoreSaveData('{broken'), { ok: false, error: { code: 'invalid-json', path: 'json' } });
  for (const version of [0, 2, 999]) {
    const data = { saveVersion: version, futureField: [] };
    const result = tryRestoreSaveData(JSON.stringify(data));
    assert.equal(result.error.code, 'unsupported-version');
  }
  assert.equal(tryRestoreSaveData(serializeSaveData(fresh())).ok, true);
  for (const json of ['null', '[]', 'true', '123', '"text"', '{}', '{"saveVersion":1e400}']) assert.equal(tryRestoreSaveData(json).error.code, 'invalid-data');
  assert.throws(() => tryRestoreSaveData(serializeSaveData(fresh()), null), TypeError); // programming error, not player corruption
});

test('every required envelope and domain field is mandatory', () => {
  const state = funded(); state.collection.register(record('stored')); state.collection.store('stored');
  const baseline = save(state);
  const paths = [[], ['collection'], ['collection', 'wallet'], ['collection', 'equipment'], ['boat'], ['clock'],
    ['achievements'], ['collection', 'catches', 0], ['achievements', 'unlocked', 0]];
  for (const path of paths) {
    const object = path.reduce((value, key) => value[key], baseline);
    for (const key of Object.keys(object)) {
      if (path.join('.') === 'achievements' && key === 'contractVersion') continue; // Legacy contract has no discriminator.
      if (path.join('.') === 'collection.catches.0' && ['salePrice', 'soldAt'].includes(key)) continue;
      const data = clone(baseline); const target = path.reduce((value, key) => value[key], data); delete target[key];
      rejects(data);
    }
  }
});

const corruptions = [
  ['non-finite balance', d => { d.collection.wallet.balance = Infinity; }],
  ['unsafe currency', d => { d.collection.wallet.balance = Number.MAX_SAFE_INTEGER + 1; }],
  ['negative currency', d => { d.collection.wallet.lifetimeSales = -1; }],
  ['fraction currency', d => { d.collection.wallet.balance = 0.5; }],
  ['wallet mismatch', d => { d.collection.wallet.lifetimeSales++; }],
  ['balance above lifetime', d => { d.collection.wallet.balance = d.collection.wallet.lifetimeSales + 1; }],
  ...[0, 11, 1.5, '2', NaN].map(value => [`rod ${value}`, d => { d.collection.equipment.rodLevel = value; }]),
  ...[0, 11, 1.5, '2', Infinity].map(value => [`reel ${value}`, d => { d.collection.equipment.reelLevel = value; }]),
  ['record version', d => { d.collection.catches[0].schemaVersion = 2; }],
  ['empty catch ID', d => { d.collection.catches[0].id = ' '; }],
  ['duplicate catch ID', d => { d.collection.catches.push(d.collection.catches[0]); }],
  ['unknown species', d => { d.collection.catches[0].speciesId = 'missing'; }],
  ...[0, -1, NaN, Infinity, '40'].map(value => [`length ${value}`, d => { d.collection.catches[0].lengthCm = value; }]),
  ...[0, -1, NaN, Infinity, Number.MAX_VALUE].map(value => [`weight ${value}`, d => { d.collection.catches[0].weightKg = value; }]),
  ['invalid capture date', d => { d.collection.catches[0].caughtAt = 'bad'; }],
  ['calendar rollover', d => { d.collection.catches[0].caughtAt = '2026-02-30T00:00:00Z'; }],
  ['invalid disposition', d => { d.collection.catches[0].disposition = 'lost'; }],
  ['sold price missing', d => { delete d.collection.catches[0].salePrice; }],
  ['sold date missing', d => { delete d.collection.catches[0].soldAt; }],
  ['invalid sale price', d => { d.collection.catches[0].salePrice = -1; }],
  ['invalid sale date', d => { d.collection.catches[0].soldAt = ''; }],
  ['unsold sale fields', d => { d.collection.catches[0].disposition = 'stored'; }],
  ['invalid save date', d => { d.savedAt = '2026-13-01T00:00:00Z'; }],
  ['non-string save date', d => { d.savedAt = Date.now(); }],
  ['NaN boat', d => { d.boat.x = NaN; }], ['infinite boat', d => { d.boat.heading = Infinity; }],
  ['outside boat', d => { d.boat.z = 1000; }],
  ...[-1, NaN, Infinity, '0'].map(value => [`clock ${value}`, d => { d.clock.elapsedSeconds = value; }]),
  ['invented setting', d => { d.settings.volume = 1; }],
  ['duplicated derived state', d => { d.collection.storedIds = []; }],
];
for (const [name, corrupt] of corruptions) test(`atomic rejection: ${name}`, () => {
  const current = funded(), before = current.collection.snapshot, awards = current.achievements.snapshot;
  let changes = 0; current.collection.subscribe(() => changes++);
  const data = clone(save(current)); corrupt(data);
  assert.throws(() => restoreSaveData(data), SaveDataError);
  assert.deepEqual(current.collection.snapshot, before); assert.deepEqual(current.achievements.snapshot, awards);
  assert.equal(current.collection.catches, before.catches); assert.equal(changes, 0);
  assert.equal(current.boat.mode, 'sailing'); assert.equal(current.clock.state.elapsedSeconds, 0);
});

test('historical sale prices and nonchronological injected clocks are retained without repricing or timestamp changes', () => {
  const data = clone(save(funded())); data.collection.catches[0].salePrice = 123;
  data.collection.catches[0].soldAt = '1970-01-01T00:00:01Z';
  data.collection.wallet = { balance: 123, lifetimeSales: 123 };
  data.achievements.unlocked = data.achievements.unlocked.filter(item => item.id !== 'normal-sales-10000');
  assert.deepEqual(save(restoreSaveData(data)), data);
});

test('optional encounter snapshots accept omitted, partial, nullable and actual generated conditions', () => {
  const examples = [undefined, {}, { depthM: 5, timeOfDay: 'day', lureId: 'worm', lurePosition: { x: 2, z: 3 } },
    { depthM: null, depthBand: null, timeOfDay: null, cycleProgress: null },
    { depthM: 12, depthBand: 'deep', timeOfDay: 'night', cycleProgress: 0.75, lureId: 'minnow', lurePosition: { x: 0, z: -10 } }];
  for (const conditions of examples) {
    const state = session(); state.collection.register(record('a', conditions === undefined ? {} : { conditions }));
    const data = save(state), restored = restoreSaveData(data);
    assert.deepEqual(restored.collection.catches[0].conditions, conditions);
  }
  const f = createFishing({ random: () => 0.1, getEnvironment: () => ({ depthM: 5, timeOfDay: 'day', cycleProgress: 0.1 }) });
  const state = { ...session(), collection: f.collection, achievements: createAchievements({ collection: f.collection }) };
  land(f); const data = save(state);
  assert.deepEqual(restoreSaveData(data).collection.catches[0].conditions, f.state.catch.conditions);
});

for (const conditions of [null, [], { depthM: -1 }, { depthM: NaN }, { depthM: 5, depthBand: 'deep' },
  { timeOfDay: 'dawn' }, { cycleProgress: 1 }, { cycleProgress: Infinity }, { lureId: 'unknown' },
  { lurePosition: { x: Infinity, z: 0 } }, { lurePosition: { x: 0 } }, { other: {} }]) {
  test(`reject malformed encounter conditions ${JSON.stringify(conditions)}`, () => {
    const state = funded(), data = clone(save(state)); data.collection.catches[0].conditions = conditions; rejects(data);
  });
}

test('fresh catches after restore cannot collide even with the exact next legacy ID and a rolled-back clock', () => {
  const state = session(); state.collection.register(record('catch-1000-2'));
  const restored = restoreSaveData(save(state), { now: () => 1000 });
  const fishing = createFishing({ collection: restored.collection, random: () => 0.1, now: () => 1000 });
  land(fishing);
  assert.equal(fishing.state.catch.id, 'catch-1000-3'); assert.equal(restored.collection.catches.length, 2);
  assert.equal(restored.collection.has('catch-1000-2'), true);
  assert.equal(restored.collection.has('catch-1000-3'), true);
});

test('boat restores saved position/heading, zero speed, sailing and a fresh READY fishing state', () => {
  const state = session(); Object.assign(state.boat, { x: 10, z: -30, heading: -7, speed: 8, mode: 'fishing' });
  const restored = restoreSaveData(save(state));
  assert.deepEqual(restored.boat, { x: 10, z: -30, heading: -7, speed: 0, mode: 'sailing' });
  assert.equal(restored.fishing.state.phase, PHASE.READY); assert.equal(restored.fishing.state.catch, null);
  assert.equal(restored.fishing.state.encounter, null); assert.equal(restored.fishing.state.reeling, false);
});

test('boat shoreline boundaries use the same radial margin as movement, with no silent coordinate clamping', () => {
  for (let i = 0; i < 32; i++) {
    const angle = i * Math.PI / 16, limit = shoreRadius(angle) - LAKE.boatMargin;
    const data = clone(fresh());
    data.boat = { x: Math.cos(angle) * (limit - 1e-8), z: Math.sin(angle) * (limit - 1e-8), heading: angle };
    assert.equal(isNavigableBoatPosition(data.boat), true);
    assert.deepEqual(save(restoreSaveData(data)), data);
    data.boat.x = Math.cos(angle) * (limit + 1e-8); data.boat.z = Math.sin(angle) * (limit + 1e-8); rejects(data);
  }
  const data = clone(fresh()); data.boat = { x: shoreRadius(0) - LAKE.boatMargin, z: 0, heading: 0 };
  assert.deepEqual(restoreSaveData(data).boat.x, data.boat.x);
});

test('normal boat collision projections remain saveable despite floating-point boundary rounding', () => {
  for (let i = 0; i < 1000; i++) {
    const angle = i * Math.PI / 500, limit = shoreRadius(angle) - LAKE.boatMargin;
    const boat = { x: Math.cos(angle) * limit, z: Math.sin(angle) * limit,
      heading: angle + Math.PI / 2, speed: 9, mode: 'sailing' };
    stepBoat(boat, { throttle: 1, steer: 0 }, 0.05);
    assert.equal(isNavigableBoatPosition(boat), true);
    const state = session(); state.boat = boat; assert.ok(save(state));
  }
});

for (const seconds of [0, 179.999999, 180, 180.000001, 359.999999, 360, 360.000001, 360 * 100 + 270]) {
  test(`clock round trip and continuation at ${seconds}s ignores offline wall time`, () => {
    const state = session(); state.clock.step(seconds);
    const restored = restoreSaveData(save(state), { now: () => future });
    assert.deepEqual(restored.clock.state, state.clock.state);
    restored.clock.step(1 / 60); state.clock.step(1 / 60);
    assert.deepEqual(restored.clock.state, state.clock.state);
  });
}
for (const fps of [30, 60, 144]) test(`${fps}fps clocks continue across both boundaries after restore`, () => {
  const state = session();
  for (let i = 0; i < 179 * fps; i++) state.clock.step(1 / fps);
  const restored = restoreSaveData(save(state));
  for (let i = 0; i < 181 * fps; i++) { restored.clock.step(1 / fps); state.clock.step(1 / fps); }
  assert.deepEqual(restored.clock.state, state.clock.state); assert.equal(restored.clock.state.timeOfDay, 'day');
  assert.equal(restored.clock.state.cycleProgress, 0);
});

test('direct domain restore constructors validate before subscriptions and preserve new-game defaults', () => {
  assert.throws(() => createCatchCollection({ initialData: {} }), SaveDataError);
  const collection = createCatchCollection(); let subscriptions = 0;
  const original = collection.subscribe; collection.subscribe = listener => { subscriptions++; return original(listener); };
  assert.throws(() => createAchievements({ collection, initialData: { unlocked: [{ id: 'unknown', unlockedAt: savedAt }] } }), SaveDataError);
  assert.equal(subscriptions, 0); assert.equal(createGameClock().state.elapsedSeconds, 0);
  for (const elapsedSeconds of [-1, NaN, Infinity]) assert.throws(() => createGameClock(undefined, { elapsedSeconds }), RangeError);
  assert.throws(() => createBoatState({ x: 1000, z: 0, heading: 0 }), RangeError);
  assert.throws(() => createBoatState({ x: 0, z: 0, heading: NaN }), RangeError);
});

test('bounded input rejects oversized text/arrays/IDs, sparse arrays, cycles, getters and unknown nested objects', () => {
  assert.throws(() => parseSaveData(' '.repeat(SAVE_LIMITS.jsonCharacters + 1)), error => error.code === 'input-too-large');
  const data = clone(fresh()); data.collection.catches.length = SAVE_LIMITS.catches + 1; rejects(data, 'input-too-large');
  data.collection.catches = new Array(1); rejects(data);
  const state = funded(), long = clone(save(state)); long.collection.catches[0].id = 'a'.repeat(SAVE_LIMITS.idCharacters + 1); rejects(long, 'input-too-large');
  const cyclic = clone(fresh()); cyclic.settings.future = cyclic; rejects(cyclic);
  const getter = clone(fresh()); Object.defineProperty(getter.boat, 'x', { get() { throw new Error('must not run'); }, enumerable: true }); rejects(getter);
  const unknown = clone(fresh()); unknown.settings = JSON.parse('['.repeat(20000) + '0' + ']'.repeat(20000)); rejects(unknown);
  const polluted = serializeSaveData(fresh()).replace('"settings":{}', '"settings":{"__proto__":{"polluted":true}}');
  assert.equal(tryRestoreSaveData(polluted).ok, false); assert.equal({}.polluted, undefined);
});

test('large legitimate history restores linearly without imposing a small fish capacity or losing indices', () => {
  const base = clone(fresh()), count = 20000;
  base.collection.catches = Array.from({ length: count }, (_, i) => ({ ...record(`large-${i}`), disposition: 'stored' }));
  base.achievements.unlocked = NORMAL_ACHIEVEMENTS.filter(item => item.metric === 'catches').map(item => ({ id: item.id, unlockedAt: savedAt }));
  const restored = restoreSaveData(parseSaveData(serializeSaveData(base)));
  assert.equal(restored.collection.catches.length, count); assert.equal(restored.collection.stored.length, count);
  assert.equal(restored.collection.encyclopedia[0].count, count);
  assert.equal(restored.collection.has(`large-${count - 1}`), true);
  assert.equal(restored.collection.register(record('large-19999')).disposition, 'stored');
});

test('assembly, parsing, successful restore and rejection never access browser storage', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true,
    get() { throw new Error('Unexpected browser storage access'); } });
  try {
    const json = serializeSaveData(fresh());
    assert.equal(tryRestoreSaveData(json).ok, true);
    assert.equal(tryRestoreSaveData('{broken').error.code, 'invalid-json');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});
