import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createEncounterModel } from '../src/game/encounter-model.js';
import { FISH_TIERS, FISH_RARITY, getFishTier, defineFishRarity } from '../src/game/fish-rarity.js';
import { FISH_SPECIES, BLACK_BASS } from '../src/game/fish-species.js';
import { createFishSpeciesRegistry } from '../src/game/fish-species-registry.js';
import { APPEARANCE_WEIGHTS, getSpeciesProbabilities, sampleFishSpecies, normalizeEncounterConditions } from '../src/game/fish-encounters.js';
import { LURES } from '../src/game/lures.js';
import { FISH_ENVIRONMENT_AFFINITIES, LURE_DEPTH_AFFINITIES, getEnvironmentWeight } from '../src/game/encounter-affinities.js';
import { randomGenerator } from '../src/world/config.js';

const environments = [1, 5, 12].flatMap(depthM => ['day', 'night'].map(timeOfDay => ({ depthM, timeOfDay })));
const productionConfig = () => ({ registry: { species: FISH_SPECIES }, baseWeights: APPEARANCE_WEIGHTS, lures: LURES,
  environmentAffinities: FISH_ENVIRONMENT_AFFINITIES, lureDepthExponents: LURE_DEPTH_AFFINITIES, tiers: FISH_RARITY });
const mutableConfig = () => structuredClone(productionConfig());
const at = (object, path) => path.reduce((value, key) => value[key], object);
const set = (object, path, value) => { at(object, path.slice(0, -1))[path.at(-1)] = value; };
const remove = (object, path) => { delete at(object, path.slice(0, -1))[path.at(-1)]; };
const view = audit => audit.entries.map(({ speciesId, weight, probability }) => ({ speciesId, weight, probability }));

function invalidConfig(change, ErrorType, path) {
  const config = mutableConfig(); change(config);
  assert.throws(() => createEncounterModel(config), error => error instanceof ErrorType && error.message.includes(path), path);
}

// Fictional Node-only records. No additions to the production registry/assets.
function fixtureConfig(count = 36) {
  const registry = createFishSpeciesRegistry(Array.from({ length: count }, (_, index) => ({
    ...BLACK_BASS, id: `fixture-${index + 1}`, name: `Fixture ${index + 1}`,
  })));
  const ids = registry.species.map(fish => fish.id);
  return {
    registry,
    baseWeights: Object.fromEntries(ids.map((id, index) => [id, 1 + index % 7])),
    tiers: Object.fromEntries(ids.map((id, index) => [id, FISH_TIERS[index % 3]])),
    lures: LURES.map((lure, lureIndex) => ({ id: lure.id,
      affinities: Object.fromEntries(ids.map((id, index) => [id, 0.6 + ((index + lureIndex) % 9) / 10])),
    })),
    environmentAffinities: Object.fromEntries(ids.map((id, index) => [id, {
      depth: { shallow: 0.8 + index % 3 / 10, mid: 1.1, deep: 1.3 - index % 4 / 10 },
      time: { day: 0.9 + index % 4 / 10, night: 1.2 - index % 3 / 10 },
    }])),
    lureDepthExponents: structuredClone(LURE_DEPTH_AFFINITIES),
  };
}

function unitConfig(count = 2) {
  const config = fixtureConfig(count);
  for (const id of Object.keys(config.baseWeights)) {
    config.baseWeights[id] = 1;
    config.environmentAffinities[id] = { depth: { shallow: 1, mid: 1, deep: 1 }, time: { day: 1, night: 1 } };
    for (const lure of config.lures) lure.affinities[id] = 1;
  }
  for (const id of Object.keys(config.lureDepthExponents)) config.lureDepthExponents[id] = { shallow: 1, mid: 1, deep: 1 };
  return config;
}

function frozenTree(value) {
  if (value === null || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) frozenTree(child);
}

test('approved immutable Tier assignments cover exactly the 12 fish, with 5/4/3 members', () => {
  assert.deepEqual(FISH_TIERS, ['Common', 'Uncommon', 'Rare']);
  assert.deepEqual(Object.keys(FISH_RARITY), FISH_SPECIES.map(fish => fish.id));
  const expected = {
    Common: ['black-bass', 'smallmouth-bass', 'bluegill', 'rainbow-trout', 'european-perch'],
    Uncommon: ['brown-trout', 'iwana', 'walleye', 'catfish'],
    Rare: ['northern-pike', 'alligator-gar', 'arowana'],
  };
  for (const tier of FISH_TIERS) {
    assert.deepEqual(FISH_SPECIES.filter(fish => getFishTier(fish.id) === tier).map(fish => fish.id), expected[tier]);
  }
  assert.equal(Object.values(APPEARANCE_WEIGHTS).reduce((sum, weight) => sum + weight, 0), 128);
  assert.deepEqual(defineFishRarity(FISH_SPECIES.map(fish => fish.id), FISH_RARITY), FISH_RARITY);
  frozenTree(FISH_RARITY); frozenTree(FISH_TIERS);
  assert.throws(() => { FISH_RARITY['black-bass'] = 'Rare'; }, TypeError);
  assert.throws(() => { FISH_TIERS.push('Other'); }, TypeError);
  for (const id of ['missing', 'constructor', '__proto__', null, undefined, Symbol('fish')]) {
    assert.throws(() => getFishTier(id), RangeError);
  }
  for (const value of ['Legendary', '', 'common']) invalidConfig(config => { config.tiers.bluegill = value; }, RangeError, 'tiers.bluegill');
  for (const value of [null, 1, {}]) invalidConfig(config => { config.tiers.bluegill = value; }, TypeError, 'tiers.bluegill');
  invalidConfig(config => { config.tiers['black-bass'] = 'Rare'; }, RangeError, 'tiers.black-bass');
  assert.throws(() => defineFishRarity(['fixture-1', 'fixture-1'], { 'fixture-1': 'Common' }), /duplicate/);
});

test('all 288 production cells exactly match legacy weights, totals, probabilities and audit factors', t => {
  const model = createEncounterModel(productionConfig());
  let cells = 0;
  for (const lure of LURES) for (const conditions of environments) {
    const legacy = getSpeciesProbabilities(lure.id, conditions);
    const probabilities = model.getProbabilities(lure.id, conditions);
    const audit = model.audit(lure.id, conditions);
    assert.deepEqual(probabilities, legacy);
    assert.deepEqual(view(audit), legacy);
    assert.equal(audit.totalWeight, legacy.reduce((sum, entry) => sum + entry.weight, 0));
    assert.ok(Math.abs(probabilities.reduce((sum, entry) => sum + entry.probability, 0) - 1) < 1e-12);
    for (const entry of audit.entries) {
      assert.equal(entry.baseWeight, APPEARANCE_WEIGHTS[entry.speciesId]);
      assert.equal(entry.lureAffinity, lure.affinities[entry.speciesId]);
      assert.equal(entry.depthAffinity, FISH_ENVIRONMENT_AFFINITIES[entry.speciesId].depth[audit.conditions.depthBand]);
      assert.equal(entry.lureDepthExponent, LURE_DEPTH_AFFINITIES[lure.id][audit.conditions.depthBand]);
      assert.equal(entry.timeAffinity, FISH_ENVIRONMENT_AFFINITIES[entry.speciesId].time[conditions.timeOfDay]);
      assert.equal(entry.environmentWeight, getEnvironmentWeight(entry.speciesId, lure.id, audit.conditions));
      assert.equal(entry.weight, (entry.baseWeight * entry.lureAffinity) * (entry.depthWeight * entry.timeAffinity) * entry.modifier);
      assert.equal(entry.probability, entry.weight / audit.totalWeight);
      assert.equal(entry.modifier, 1); assert.equal(entry.tier, getFishTier(entry.speciesId));
      cells++;
    }
  }
  assert.equal(cells, 288); t.diagnostic('288/288 cells: exact equality (maximum difference 0)');
});

test('production sampling uses one RNG call, strict cumulative boundaries and injected fish references', () => {
  const model = createEncounterModel(productionConfig());
  for (const lure of LURES) for (const conditions of environments) {
    const entries = model.getProbabilities(lure.id, conditions);
    let cumulative = 0;
    for (const [index, entry] of entries.entries()) {
      let calls = 0;
      const roll = cumulative + entry.probability / 2;
      assert.equal(model.sample(lure.id, () => { calls++; return roll; }, conditions), FISH_SPECIES[index]);
      assert.equal(calls, 1);
      cumulative += entry.probability;
      if (index < entries.length - 1) assert.equal(model.sample(lure.id, () => cumulative, conditions), FISH_SPECIES[index + 1]);
    }
    assert.equal(model.sample(lure.id, () => 0, conditions), FISH_SPECIES[0]);
    assert.equal(model.sample(lure.id, () => 1 - Number.EPSILON, conditions), FISH_SPECIES.at(-1));
    const oldRandom = randomGenerator(426), newRandom = randomGenerator(426);
    assert.deepEqual(Array.from({ length: 40 }, () => model.sample(lure.id, newRandom, conditions).id),
      Array.from({ length: 40 }, () => sampleFishSpecies(lure.id, oldRandom, conditions).id));
  }
});

test('the final interval rescues rounding exactly as the legacy sampling loop does', () => {
  const config = unitConfig(10), model = createEncounterModel(config);
  const lastRoll = 1 - Number.EPSILON / 2;
  assert.equal(model.getProbabilities('minnow').reduce((sum, entry) => sum + entry.probability, 0), lastRoll);
  assert.equal(model.sample('minnow', () => lastRoll), config.registry.species.at(-1));
});

test('omitted, invalid and partially valid conditions retain the legacy neutralization boundary', () => {
  const model = createEncounterModel(productionConfig());
  const conditions = [undefined, null, {}, false, 1, 'day', [], Symbol('conditions'),
    { depthBand: 'deep', spotMultiplier: 1.5 },
    ...[NaN, Infinity, -Infinity, -1, '12', null].map(depthM => ({ depthM, timeOfDay: 'unknown', cycleProgress: Infinity })),
    ...[0, 2.999999, 3, 7.999999, 8, 12].map(depthM => ({ depthM, timeOfDay: 'invalid', cycleProgress: 0.5 })),
    ...[undefined, -1, 1, '0.5', NaN].map(cycleProgress => ({ depthM: 'bad', timeOfDay: 'night', cycleProgress })),
    { depthM: 12, timeOfDay: 'day', cycleProgress: 0 }, { depthM: 5, timeOfDay: 'night', cycleProgress: 1 - Number.EPSILON }];
  for (const lure of LURES) for (const value of conditions) {
    assert.deepEqual(model.audit(lure.id, value).conditions, normalizeEncounterConditions(value));
    assert.deepEqual(model.getProbabilities(lure.id, value), getSpeciesProbabilities(lure.id, value));
  }
});

test('unknown lures and invalid random results fail explicitly without extra RNG consumption', () => {
  const model = createEncounterModel(productionConfig());
  for (const id of ['missing', '__proto__', 'constructor', null, undefined, Symbol('lure')]) {
    for (const method of ['audit', 'getProbabilities', 'sample']) assert.throws(() => model[method](id), RangeError);
  }
  for (const roll of [-1, 1, NaN, Infinity, -Infinity, '0', null, undefined, {}, 0n]) {
    let calls = 0;
    assert.throws(() => model.sample('minnow', () => { calls++; return roll; }), RangeError);
    assert.equal(calls, 1);
  }
  for (const random of [null, 1, 'random', {}]) assert.throws(() => model.sample('minnow', random), TypeError);
});

test('36 fictional fish cover 864 positive cells and remain reachable across all 24 conditions', t => {
  const config = fixtureConfig(), model = createEncounterModel(config);
  const otherConfig = fixtureConfig();
  otherConfig.registry = createFishSpeciesRegistry([...otherConfig.registry.species].reverse().map(fish => ({ ...fish, name: `Other ${fish.id}` })));
  otherConfig.lures.reverse(); otherConfig.baseWeights['fixture-1'] = 31;
  const other = createEncounterModel(otherConfig);
  assert.deepEqual(model.definitions.speciesIds, config.registry.species.map(fish => fish.id));
  assert.deepEqual(other.definitions.lureIds, [...model.definitions.lureIds].reverse());
  let cells = 0;
  for (const lure of LURES) for (const conditions of environments) {
    const before = model.getProbabilities(lure.id, conditions);
    assert.equal(before.length, 36);
    assert.ok(Math.abs(before.reduce((sum, entry) => sum + entry.probability, 0) - 1) < 1e-12);
    let cumulative = 0;
    for (const entry of before) {
      assert.ok(Number.isFinite(entry.weight) && entry.weight > 0 && entry.probability > 0);
      assert.equal(model.sample(lure.id, () => cumulative + entry.probability / 2, conditions), config.registry.get(entry.speciesId));
      cumulative += entry.probability; cells++;
    }
    const otherEntries = other.getProbabilities(lure.id, conditions);
    assert.deepEqual(otherEntries.map(entry => entry.speciesId), [...before].reverse().map(entry => entry.speciesId));
    assert.notEqual(otherEntries.find(entry => entry.speciesId === 'fixture-1').probability, before[0].probability);
    assert.equal(other.sample(lure.id, () => 0, conditions), otherConfig.registry.species[0]);
    assert.equal(model.sample(lure.id, () => 0, conditions), config.registry.species[0]);
    assert.deepEqual(model.getProbabilities(lure.id, conditions), before);
  }
  assert.equal(cells, 864); assert.equal(FISH_SPECIES.length, 12);
  t.diagnostic('864/864 fictional cells positive and reachable; production species count remains 12');
});

test('mutable definitions are detached, immutable registry identities are retained, and every return is frozen', () => {
  const input = mutableConfig(), model = createEncounterModel(input);
  const before = model.audit('minnow', environments[0]);
  const selected = model.sample('minnow', () => 0);
  assert.notEqual(selected, input.registry.species[0]);
  assert.notEqual(selected.weight, input.registry.species[0].weight);
  input.registry.species[0].name = 'changed'; input.registry.species[0].weight.exponent = 9;
  input.registry.species[0].fight.baseResistance = 99; input.registry.species[0].id = 'changed';
  input.registry.species.reverse(); input.lures.reverse(); input.lures[3].id = 'changed';
  input.lures[3].affinities['black-bass'] = 99; input.baseWeights['black-bass'] = 99;
  input.environmentAffinities['black-bass'].depth.shallow = 99;
  input.environmentAffinities['black-bass'].time.day = 99;
  input.lureDepthExponents.minnow.shallow = 99; input.tiers['black-bass'] = 'Rare';
  assert.deepEqual(model.audit('minnow', environments[0]), before);
  assert.equal(selected.name, BLACK_BASS.name); assert.equal(selected.weight.exponent, 3);
  assert.equal(selected.fight.baseResistance, BLACK_BASS.fight.baseResistance);
  for (const result of [model, model.definitions, before, model.getProbabilities('minnow'), selected]) frozenTree(result);
  assert.throws(() => { model.definitions.baseWeights['black-bass'] = 1; }, TypeError);
  assert.throws(() => { before.entries[0].weight = 1; }, TypeError);
  assert.throws(() => { model.getProbabilities('minnow').pop(); }, TypeError);
  assert.throws(() => { selected.weight.exponent = 1; }, TypeError);
  const immutableModel = createEncounterModel(productionConfig());
  assert.equal(immutableModel.sample('minnow', () => 0), BLACK_BASS);
  const old = getSpeciesProbabilities('minnow');
  assert.equal(Object.isFrozen(old), false); assert.equal(Object.isFrozen(old[0]), false);
});

test('optional per-species multipliers are neutral by default and never mutate models or definitions', () => {
  const model = createEncounterModel(productionConfig()), other = createEncounterModel(productionConfig());
  const conditions = environments[0], before = model.getProbabilities('minnow', conditions);
  assert.deepEqual(model.getProbabilities('minnow', conditions, {}), before);
  assert.deepEqual(model.getProbabilities('minnow', conditions, Object.fromEntries(FISH_SPECIES.map(fish => [fish.id, 1]))), before);
  // Arbitrary fixture multiplier only; no equipment-level balance is defined.
  const modifiers = { 'black-bass': 2 };
  const audit = model.audit('minnow', conditions, modifiers);
  assert.equal(audit.entries[0].weight, before[0].weight * 2);
  assert.deepEqual(audit.entries.slice(1).map(entry => entry.weight), before.slice(1).map(entry => entry.weight));
  assert.deepEqual(model.getProbabilities('minnow', conditions, modifiers), view(audit));
  let cumulative = 0;
  for (const [index, entry] of audit.entries.entries()) {
    assert.equal(model.sample('minnow', () => cumulative + entry.probability / 2, conditions, modifiers), FISH_SPECIES[index]);
    cumulative += entry.probability;
  }
  modifiers['black-bass'] = 7;
  assert.equal(audit.entries[0].modifier, 2);
  assert.deepEqual(model.getProbabilities('minnow', conditions), before);
  assert.deepEqual(other.getProbabilities('minnow', conditions), before);
  assert.equal(model.definitions.baseWeights['black-bass'], 24);
});

const numericPaths = [
  ['baseWeights', 'black-bass'], ['lures', 0, 'affinities', 'black-bass'],
  ['environmentAffinities', 'black-bass', 'depth', 'shallow'],
  ['environmentAffinities', 'black-bass', 'time', 'day'], ['lureDepthExponents', 'minnow', 'shallow'],
];
for (const path of numericPaths) test(`strict positive numeric contract: ${path.join('.')}`, () => {
  const field = path.slice(path[0] === 'lures' ? 2 : 0).join('.');
  for (const value of [0, -1, -0, NaN, Infinity, -Infinity]) invalidConfig(config => set(config, path, value), RangeError, field);
  for (const value of ['1', undefined, null, false, {}, [], 1n]) invalidConfig(config => set(config, path, value), TypeError, field);
});

// Check every mandatory ID and every mandatory depth/time cell, not just one
// representative fish. Unknown keys must fail at each nesting level too.
const requiredRecords = [[], ['baseWeights'], ['tiers'], ['environmentAffinities'], ['lureDepthExponents'],
  ...FISH_SPECIES.flatMap(fish => [['environmentAffinities', fish.id], ['environmentAffinities', fish.id, 'depth'], ['environmentAffinities', fish.id, 'time']]),
  ...LURES.flatMap((lure, index) => [['lures', index, 'affinities'], ['lureDepthExponents', lure.id]]),
];
test('every required record rejects missing/unknown keys and malformed record types', () => {
  for (const path of requiredRecords) {
    const field = path.length ? path.filter(value => typeof value !== 'number').join('.') : 'config';
    for (const key of Object.keys(at(productionConfig(), path))) {
      invalidConfig(config => remove(config, [...path, key]), TypeError, path[0] === 'lures' ? String(key) : `${field === 'config' ? 'config' : field}.${key}`);
    }
    invalidConfig(config => { at(config, path).unknown = 1; }, RangeError, 'unknown');
    for (const value of [null, [], 1, 'table', new Map(), new Date()]) {
      if (path.length) invalidConfig(config => set(config, path, value), TypeError, path[0] === 'lures' ? 'affinities' : field);
      else assert.throws(() => createEncounterModel(value), TypeError);
    }
  }
  invalidConfig(config => { Object.defineProperty(config.baseWeights, Symbol('unknown'), { value: 1 }); }, RangeError, 'baseWeights');
  invalidConfig(config => { Object.defineProperty(config.baseWeights, 'black-bass', { get: () => 1 }); }, TypeError, 'baseWeights.black-bass');
  invalidConfig(config => { config.baseWeights = Object.create(config.baseWeights); }, TypeError, 'baseWeights');
});

test('fish/lure lists reject duplicates, holes, invalid IDs and malformed registry data', () => {
  for (const path of [['registry', 'species'], ['lures']]) {
    const field = path.join('.');
    for (const value of [undefined, null, {}, 'list']) invalidConfig(config => set(config, path, value), TypeError, field);
    invalidConfig(config => set(config, path, []), RangeError, field);
    invalidConfig(config => { delete at(config, path)[1]; }, TypeError, `${field}[1]`);
    invalidConfig(config => { at(config, path).push(at(config, path)[0]); }, RangeError, 'duplicate');
    invalidConfig(config => { at(config, path).extra = 1; }, RangeError, field);
    for (const value of [undefined, null, 1, 'fish', []]) invalidConfig(config => { at(config, path)[0] = value; }, TypeError, `${field}[0]`);
    for (const id of [undefined, null, 1]) invalidConfig(config => { at(config, path)[0].id = id; }, TypeError, 'ID');
    for (const id of ['', 'Bad ID', '__proto__']) invalidConfig(config => { at(config, path)[0].id = id; }, RangeError, 'ID');
  }
  invalidConfig(config => { config.registry = null; }, TypeError, 'registry');
  invalidConfig(config => { config.registry.species[0].weight.exponent = NaN; }, TypeError, 'black-bass');
  invalidConfig(config => { config.registry.species[0].extra = new Map(); }, TypeError, 'extra');
  invalidConfig(config => { config.registry.species[0].extra = config.registry.species[0]; }, TypeError, 'cyclic');
});

test('invalid modifiers fail across all methods without consuming random values or contaminating later calls', () => {
  const model = createEncounterModel(productionConfig()), before = model.audit('minnow');
  const cases = [
    ...[null, [], 1, '1', () => 1].map(value => [value, TypeError]),
    ...[0, -1, NaN, Infinity, -Infinity].map(value => [{ 'black-bass': value }, RangeError]),
    ...['1', null, undefined, false].map(value => [{ 'black-bass': value }, TypeError]),
    [{ missing: 1 }, RangeError], [{ constructor: 1 }, RangeError], [{ [Symbol('fish')]: 1 }, RangeError],
  ];
  for (const [modifiers, ErrorType] of cases) {
    for (const method of ['audit', 'getProbabilities']) assert.throws(() => model[method]('minnow', undefined, modifiers), ErrorType);
    let calls = 0;
    assert.throws(() => model.sample('minnow', () => { calls++; return 0; }, undefined, modifiers), ErrorType);
    assert.equal(calls, 0);
    assert.deepEqual(model.audit('minnow'), before);
  }
});

const derivedFailures = [
  ['base product overflow', config => { config.baseWeights['fixture-1'] = Number.MAX_VALUE; config.lures[0].affinities['fixture-1'] = 2; }, 'baseLureWeight'],
  ['base product underflow', config => { config.baseWeights['fixture-1'] = Number.MIN_VALUE; config.lures[0].affinities['fixture-1'] = 0.25; }, 'baseLureWeight'],
  ['depth overflow', config => { config.environmentAffinities['fixture-1'].depth.shallow = Number.MAX_VALUE; config.lureDepthExponents.minnow.shallow = 2; }, 'depthWeight'],
  ['depth underflow', config => { config.environmentAffinities['fixture-1'].depth.shallow = Number.MIN_VALUE; config.lureDepthExponents.minnow.shallow = 2; }, 'depthWeight'],
  ['environment overflow', config => { config.environmentAffinities['fixture-1'].depth.shallow = Number.MAX_VALUE; config.environmentAffinities['fixture-1'].time.day = 2; }, 'environmentWeight'],
  ['environment underflow', config => { config.environmentAffinities['fixture-1'].depth.shallow = Number.MIN_VALUE; config.environmentAffinities['fixture-1'].time.day = 0.25; }, 'environmentWeight'],
  ['weight overflow', config => { config.baseWeights['fixture-1'] = Number.MAX_VALUE; config.environmentAffinities['fixture-1'].time.day = 2; }, 'unmodifiedWeight'],
  ['all weights underflow to zero', config => { for (const id of Object.keys(config.baseWeights)) { config.baseWeights[id] = Number.MIN_VALUE; config.environmentAffinities[id].time.day = 0.25; } }, 'unmodifiedWeight'],
  ['total overflow', config => { for (const id of Object.keys(config.baseWeights)) config.baseWeights[id] = Number.MAX_VALUE; }, 'totalWeight'],
  ['probability underflow', config => { config.baseWeights['fixture-1'] = Number.MIN_VALUE; config.baseWeights['fixture-2'] = Number.MAX_VALUE / 8; }, 'probabilities'],
];
for (const [name, change, field] of derivedFailures) test(`invalid derived results cannot succeed: ${name}`, () => {
  const config = unitConfig(); change(config);
  const model = createEncounterModel(config), conditions = environments[0];
  const matches = error => error instanceof RangeError && error.message.includes(field);
  assert.throws(() => model.audit('minnow', conditions), matches);
  assert.throws(() => model.getProbabilities('minnow', conditions), matches);
  let calls = 0;
  assert.throws(() => model.sample('minnow', () => { calls++; return 0; }, conditions), matches);
  assert.equal(calls, 0);
});

test('zero configuration totals and modifier overflow/underflow cannot produce successful probabilities', () => {
  invalidConfig(config => { for (const id of Object.keys(config.baseWeights)) config.baseWeights[id] = 0; }, RangeError, 'baseWeights');
  for (const [base, multiplier] of [[2, Number.MAX_VALUE], [Number.MIN_VALUE, 0.25]]) {
    const config = unitConfig(); config.baseWeights['fixture-1'] = base;
    const model = createEncounterModel(config), before = model.audit('minnow');
    const modifiers = { 'fixture-1': multiplier };
    assert.throws(() => model.audit('minnow', undefined, modifiers), /weights.minnow.fixture-1.weight/);
    assert.throws(() => model.getProbabilities('minnow', undefined, modifiers), RangeError);
    assert.throws(() => model.sample('minnow', () => 0, undefined, modifiers), RangeError);
    assert.deepEqual(model.audit('minnow'), before);
  }
});

test('audit CLI traces exactly 288 ordered production cells from the shared calculation', () => {
  const output = JSON.parse(execFileSync(process.execPath, [new URL('../scripts/audit-encounters.mjs', import.meta.url).pathname], { encoding: 'utf8' }));
  assert.equal(output.speciesCount, 12); assert.equal(output.conditionCount, 24); assert.equal(output.cellCount, 288);
  assert.equal(output.rows.length, 288);
  const model = createEncounterModel(productionConfig());
  let index = 0;
  for (const lure of LURES) for (const conditions of environments) {
    const audit = model.audit(lure.id, conditions);
    for (const entry of audit.entries) {
      assert.deepEqual(output.rows[index++], { lureId: lure.id, ...audit.conditions, ...entry, totalWeight: audit.totalWeight });
    }
  }
});
