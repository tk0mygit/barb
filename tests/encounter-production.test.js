import test from 'node:test';
import assert from 'node:assert/strict';
import { encounterModel, getRodEncounterModifiers } from '../src/game/encounter-production.js';
import { getEquipmentLevel } from '../src/game/equipment.js';
import { FISH_SPECIES, calculateFishWeightKg } from '../src/game/fish-species.js';
import { FISH_RARITY, FISH_TIERS } from '../src/game/fish-rarity.js';
import { LURES } from '../src/game/lures.js';
import { getSpeciesProbabilities, sampleFishSpecies, normalizeEncounterConditions } from '../src/game/fish-encounters.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { createFishing, PHASE } from '../src/game/fishing.js';
import { FISHING_SPOTS } from '../src/world/fishing-spots.js';
import { randomGenerator } from '../src/world/config.js';

const environments = [1, 5, 12].flatMap(depthM => ['day', 'night'].map(timeOfDay => ({ depthM, timeOfDay })));
const bonuses = [[1, 1], [1, 1], [1, 1], [1, 1], [1, 1],
  [1.02, 1.10], [1.04, 1.20], [1.06, 1.30], [1.08, 1.40], [1.10, 1.50]];
const multiplier = (level, tier) => tier === 'Common' ? 1 : bonuses[level - 1][tier === 'Uncommon' ? 0 : 1];

// Use the actual legacy export as the independent unmodified-weight oracle.
function reference(lureId, conditions, level) {
  const entries = getSpeciesProbabilities(lureId, conditions).map(entry => ({ ...entry,
    weight: entry.weight * multiplier(level, FISH_RARITY[entry.speciesId]),
  }));
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  return entries.map(entry => ({ ...entry, probability: entry.weight / total }));
}
function pick(entries, roll) {
  let cumulative = 0;
  for (const [index, entry] of entries.entries()) {
    cumulative += entry.probability;
    if (roll < cumulative) return FISH_SPECIES[index];
  }
  return FISH_SPECIES.at(-1);
}
function collectionAt(level) {
  const collection = createCatchCollection({ now: () => 1700000000000 });
  collection.register({ schemaVersion: 1, id: 'fund', speciesId: 'black-bass', lengthCm: 50,
    weightKg: 1000, caughtAt: '2026-01-01T00:00:00.000Z' });
  collection.sellUnassigned('fund');
  for (let current = 1; current < level; current++) assert.ok(collection.purchaseUpgrade('rod', current));
  return collection;
}
function cast(f, origin = { x: 0, z: 30 }) {
  assert.equal(f.prepare(origin, 0), true); f.aim(0, 180); f.cast(); f.step(0.801);
}
function bite(f, dt = 1 / 60, flick = false) {
  let frames = 0;
  while (f.state.phase === PHASE.LURE && frames < 12000) {
    if (flick) f.flick();
    f.step(dt); frames++;
  }
  assert.equal(f.state.phase, PHASE.BITE);
  return frames;
}

test('production model and all ten immutable species modifier tables use exactly the approved 12 fish', () => {
  assert.equal(encounterModel.definitions.species.length, 12);
  assert.deepEqual(encounterModel.definitions.species, FISH_SPECIES);
  assert.deepEqual(encounterModel.definitions.tiers, FISH_RARITY);
  assert.deepEqual(FISH_TIERS.map(tier => Object.values(FISH_RARITY).filter(value => value === tier).length), [5, 4, 3]);
  for (let level = 1; level <= 10; level++) {
    const modifiers = getRodEncounterModifiers(level), row = getEquipmentLevel('rod', level);
    assert.equal(getRodEncounterModifiers(level), modifiers);
    assert.ok(Object.isFrozen(modifiers));
    assert.deepEqual(Object.keys(modifiers), FISH_SPECIES.map(fish => fish.id));
    for (const fish of FISH_SPECIES) assert.equal(modifiers[fish.id], multiplier(level, FISH_RARITY[fish.id]));
    if (level <= 5) assert.equal(Object.hasOwn(row, 'tierMultipliers'), false);
    else {
      assert.deepEqual(row.tierMultipliers, { Common: 1, Uncommon: bonuses[level - 1][0], Rare: bonuses[level - 1][1] });
      assert.ok(Object.isFrozen(row.tierMultipliers));
      assert.throws(() => { row.tierMultipliers.Rare = 9; }, TypeError);
    }
    assert.throws(() => { modifiers.bluegill = 9; }, TypeError);
  }
  for (const level of [undefined, null, 0, 11, 1.5, '6', NaN, Infinity, {}, Symbol('level')]) {
    assert.throws(() => getRodEncounterModifiers(level), RangeError);
  }
});

test('Lv.1–5 each exactly retain all 288 legacy weights, totals and probabilities; Lv.6–10 match reference normalization', t => {
  const uncommonDecreases = [];
  for (const lure of LURES) for (const conditions of environments) {
    let previous;
    for (let level = 1; level <= 10; level++) {
      const modifiers = getRodEncounterModifiers(level);
      const expected = reference(lure.id, conditions, level);
      const audit = encounterModel.audit(lure.id, conditions, modifiers);
      assert.deepEqual(encounterModel.getProbabilities(lure.id, conditions, modifiers), expected);
      assert.deepEqual(audit.entries.map(({ speciesId, weight, probability }) => ({ speciesId, weight, probability })), expected);
      assert.equal(audit.totalWeight, expected.reduce((sum, entry) => sum + entry.weight, 0));
      assert.ok(Math.abs(expected.reduce((sum, entry) => sum + entry.probability, 0) - 1) <= 1e-12);
      const tier = { Common: 0, Uncommon: 0, Rare: 0 };
      for (const entry of audit.entries) {
        assert.equal(entry.modifier, multiplier(level, entry.tier));
        assert.ok(entry.weight > 0 && entry.probability > 0);
        tier[entry.tier] += entry.probability;
      }
      if (level <= 5) assert.deepEqual(expected, getSpeciesProbabilities(lure.id, conditions));
      else {
        assert.ok(tier.Common < previous.Common);
        assert.ok(tier.Rare > previous.Rare);
        for (const name of ['Uncommon', 'Rare']) assert.ok(tier[name] / tier.Common > previous[name] / previous.Common);
        if (level === 6 && tier.Uncommon < previous.Uncommon) uncommonDecreases.push(`${lure.id}/${conditions.depthM}/${conditions.timeOfDay}`);
      }
      previous = tier;
    }
  }
  assert.deepEqual(uncommonDecreases, ['spinnerbait/1/day', 'spinnerbait/1/night', 'spinnerbait/5/night']);
  t.diagnostic('Lv.1–5: 1440/1440 exact legacy cells (max difference 0); Lv.6–10: 1440/1440 reference cells');
  t.diagnostic('Uncommon/Common and Rare/Common odds rise in all 24 conditions; normalized Uncommon falls in the 3 documented spinnerbait conditions');
});

test('neutral and malformed conditions, legacy mutable returns and species RNG boundaries remain compatible', () => {
  const conditions = [undefined, null, {}, false, 'night', [], Symbol('conditions'),
    { depthM: NaN, timeOfDay: 'unknown' }, { depthM: -1, timeOfDay: 'night' },
    { depthM: 12, timeOfDay: false }, { depthM: '12', timeOfDay: 'day', cycleProgress: Infinity }];
  for (const lure of LURES) for (let level = 1; level <= 10; level++) {
    const modifiers = getRodEncounterModifiers(level);
    for (const environment of [...environments, ...conditions]) {
      const expected = reference(lure.id, environment, level);
      assert.deepEqual(encounterModel.getProbabilities(lure.id, environment, modifiers), expected);
      assert.deepEqual(encounterModel.audit(lure.id, environment, modifiers).conditions, normalizeEncounterConditions(environment));
      let cumulative = 0;
      const rolls = [0, 1 - Number.EPSILON, 1 - Number.EPSILON / 2];
      for (const entry of expected.slice(0, -1)) {
        cumulative += entry.probability;
        rolls.push(cumulative - Number.EPSILON, cumulative, cumulative + Number.EPSILON);
      }
      for (const roll of rolls) {
        let calls = 0;
        const species = encounterModel.sample(lure.id, () => { calls++; return roll; }, environment, modifiers);
        assert.equal(species, pick(expected, roll)); assert.equal(calls, 1);
        if (level <= 5) assert.equal(species, sampleFishSpecies(lure.id, () => roll, environment));
      }
    }
  }
  const mutable = getSpeciesProbabilities('minnow'); mutable[0].weight = 0; mutable.pop();
  assert.equal(getSpeciesProbabilities('minnow').length, 12);
  assert.equal(getSpeciesProbabilities('minnow')[0].weight, 26.400000000000002);
});

test('public BITE follows seeded budget/species/size order for every level and all 24 conditions; the individual stays fixed', t => {
  let scenarios = 0;
  for (let level = 1; level <= 10; level++) for (const lure of LURES) for (const conditions of environments) {
    for (const seed of [423, 426, 2026]) {
      const expectedRandom = randomGenerator(seed), actualRandom = randomGenerator(seed);
      expectedRandom(); // The existing exponential bite budget precedes species and size.
      const speciesRoll = expectedRandom(), sizeRoll = expectedRandom();
      const species = pick(reference(lure.id, conditions, level), speciesRoll);
      const lengthCm = Math.round((species.minLengthCm + sizeRoll * (species.maxLengthCm - species.minLengthCm)) * 10) / 10;
      let calls = 0;
      const f = createFishing({ collection: collectionAt(level), getEnvironment: () => conditions,
        random: () => { calls++; return actualRandom(); } });
      f.selectLure(lure.id); cast(f); assert.equal(calls, 1); bite(f);
      assert.equal(calls, 3);
      const individual = f.state.encounter;
      assert.deepEqual(Object.keys(individual), ['speciesId', 'lengthCm', 'weightKg', 'conditions']);
      assert.equal(individual.speciesId, species.id); assert.equal(individual.lengthCm, lengthCm);
      assert.equal(individual.weightKg, calculateFishWeightKg(species.id, lengthCm));
      assert.ok(lengthCm >= species.minLengthCm && lengthCm <= species.maxLengthCm);
      assert.ok(Object.isFrozen(individual));
      assert.equal(f.hook(), true); f.reel(true); f.step(0.25); f.reel(false); f.step(0.1); f.reel(true); f.step(0.1);
      assert.equal(f.state.phase, PHASE.FIGHT); assert.equal(f.state.encounter, individual); assert.equal(calls, 3);
      scenarios++;
    }
  }
  assert.equal(scenarios, 720); t.diagnostic('720 seeded public casts; exactly budget → species → size, no resampling in FIGHT');
});

test('public BITE uses 0, last interval and exact species boundaries at all ten rod levels', () => {
  for (let level = 1; level <= 10; level++) for (const lure of LURES) for (const conditions of environments) {
    const expected = reference(lure.id, conditions, level);
    let cumulative = 0;
    const rolls = [0, 1 - Number.EPSILON / 2];
    for (const entry of expected.slice(0, -1)) { cumulative += entry.probability; rolls.push(cumulative); }
    for (const roll of rolls) {
      let calls = 0;
      const sequence = [0, roll, roll === 0 ? 0 : 1 - Number.EPSILON];
      const f = createFishing({ collection: collectionAt(level), getEnvironment: () => conditions,
        random: () => { calls++; assert.ok(sequence.length); return sequence.shift(); } });
      f.selectLure(lure.id); cast(f); bite(f, 0.1);
      const species = pick(expected, roll);
      assert.equal(f.state.encounter.speciesId, species.id);
      assert.equal(f.state.encounter.lengthCm, roll === 0 ? species.minLengthCm : species.maxLengthCm);
      assert.equal(calls, 3);
    }
  }
});

test('Tier affects no exponential waiting, spot 1.5 bonus, action 1.35 bonus or lure hit multiplier', () => {
  for (const lure of LURES) for (const origin of [{ x: 0, z: 30 }, ...FISHING_SPOTS]) for (const action of [false, true]) {
    let baseline;
    for (let level = 1; level <= 10; level++) {
      let calls = 0;
      const f = createFishing({ collection: collectionAt(level), random: () => { calls++; return 0.5; } });
      f.selectLure(lure.id); cast(f, origin);
      const frames = bite(f, 1 / 60, action);
      const expectedSeconds = 3 + (-Math.log(0.5) * 12) / (lure.hitMultiplier * (FISHING_SPOTS.includes(origin) ? 1.5 : 1) * (action ? 1.35 : 1));
      assert.ok(Math.abs(frames / 60 - expectedSeconds) < 1 / 30);
      assert.equal(calls, 3);
      if (baseline === undefined) baseline = frames;
      assert.equal(frames, baseline);
    }
  }
});

test('production methods retain fail-closed modifier, lure and random checks without consuming extra RNG', () => {
  const invalid = [null, [], 1, { missing: 1 }, { constructor: 1 }, { bluegill: 0 }, { bluegill: -1 },
    { bluegill: '1' }, { bluegill: NaN }, { bluegill: Infinity }, { bluegill: undefined }];
  for (const modifiers of invalid) {
    let calls = 0;
    assert.throws(() => encounterModel.sample('minnow', () => { calls++; return 0; }, undefined, modifiers));
    assert.throws(() => encounterModel.audit('minnow', undefined, modifiers));
    assert.throws(() => encounterModel.getProbabilities('minnow', undefined, modifiers));
    assert.equal(calls, 0);
  }
  for (const lure of ['missing', null, undefined, '__proto__']) assert.throws(() => encounterModel.sample(lure), RangeError);
  for (const roll of [-1, 1, '0', null, NaN, Infinity]) {
    let calls = 0;
    assert.throws(() => encounterModel.sample('minnow', () => { calls++; return roll; }, undefined, getRodEncounterModifiers(10)), RangeError);
    assert.equal(calls, 1);
  }
});

test('active rod purchases cannot change the prepared Tier distribution, including a roll that changes species at Lv.10', () => {
  for (const level of [1, 6]) for (const stage of ['aim', 'cast', 'lure', 'bite', 'fight']) {
    const collection = collectionAt(level);
    const oldSpecies = pick(reference('spinnerbait', undefined, level), 0.5);
    const newSpecies = pick(reference('spinnerbait', undefined, 10), 0.5);
    assert.notEqual(oldSpecies.id, newSpecies.id);
    const f = createFishing({ collection, random: () => 0.5 }); f.selectLure('spinnerbait');
    assert.equal(f.prepare({ x: 0, z: 30 }, 0), true); f.aim(0, 180);
    if (stage !== 'aim') f.cast();
    if (['lure', 'bite', 'fight'].includes(stage)) f.step(0.801);
    if (['bite', 'fight'].includes(stage)) bite(f);
    if (stage === 'fight') assert.equal(f.hook(), true);
    for (let current = level; current < 10; current++) assert.ok(collection.purchaseUpgrade('rod', current));
    assert.equal(f.prepare({ x: 0, z: 0 }, 0), false);
    if (f.state.phase === PHASE.AIM) f.cast();
    if (f.state.phase === PHASE.CAST) f.step(0.801);
    if (f.state.phase === PHASE.LURE) bite(f);
    assert.equal(f.state.encounter.speciesId, oldSpecies.id);
    if (f.state.phase === PHASE.FIGHT) {
      f.reel(true);
      for (let frame = 0; frame < 1200 && f.state.phase === PHASE.FIGHT; frame++) f.step(1 / 60);
      assert.equal(f.state.phase, PHASE.FAILED); f.step(2);
    } else assert.equal(f.cancelForViewChange(), true);
    cast(f); bite(f); assert.equal(f.state.encounter.speciesId, newSpecies.id);
  }
});
