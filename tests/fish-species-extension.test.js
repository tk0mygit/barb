import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FISH_SPECIES, BLACK_BASS } from '../src/game/fish-species.js';
import { defineFishSpecies, createFishSpeciesRegistry } from '../src/game/fish-species-registry.js';
import { LURES } from '../src/game/lures.js';
import { APPEARANCE_WEIGHTS, getSpeciesProbabilities } from '../src/game/fish-encounters.js';
import { FISH_ENVIRONMENT_AFFINITIES, LURE_DEPTH_AFFINITIES } from '../src/game/encounter-affinities.js';
import { NORMAL_ACHIEVEMENTS, createAchievements } from '../src/game/achievements.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { createBoatState } from '../src/game/boat.js';
import { createGameClock } from '../src/game/game-clock.js';
import { createSaveData, serializeSaveData, parseSaveData } from '../src/game/save-data.js';
import { fishSpeciesSandbox } from './helpers/fish-species-sandbox.js';

test('all gameplay definitions exactly retain main 51ab225 values, including fixed achievement targets', () => {
  const data = { fish: FISH_SPECIES.map(({ image, ...data }) => data), LURES, APPEARANCE_WEIGHTS,
    FISH_ENVIRONMENT_AFFINITIES, LURE_DEPTH_AFFINITIES, NORMAL_ACHIEVEMENTS: NORMAL_ACHIEVEMENTS.slice(0, 10) };
  assert.equal(createHash('sha256').update(JSON.stringify(data)).digest('hex'),
    '000d079bde84a88d7002541db875987adebf956b43bdaa3533d581b7095ee0a3');
  assert.equal(NORMAL_ACHIEVEMENTS.length, 15);
  assert.deepEqual(NORMAL_ACHIEVEMENTS.filter(item => item.metric === 'species').map(item => item.target), [5, 12]);
});

test('registration rejects duplicates and missing/invalid metadata, and detaches mutable inputs', () => {
  assert.throws(() => createFishSpeciesRegistry([BLACK_BASS, { ...BLACK_BASS }]), /Duplicate/);
  assert.throws(() => createFishSpeciesRegistry([BLACK_BASS, ,]), TypeError);
  for (const key of ['id', 'name', 'description', 'image', 'minLengthCm', 'maxLengthCm', 'weight', 'fight', 'basePricePerKg']) {
    const data = { ...BLACK_BASS }; delete data[key];
    assert.throws(() => defineFishSpecies(data), TypeError, key);
  }
  for (const section of ['weight', 'fight']) for (const key of Object.keys(BLACK_BASS[section])) {
    const data = { ...BLACK_BASS, [section]: { ...BLACK_BASS[section] } }; delete data[section][key];
    assert.throws(() => defineFishSpecies(data), TypeError, `${section}.${key}`);
  }
  for (const update of [{ id: '' }, { id: 'Bad ID' }, { name: ' ' }, { image: '' }, { alternateName: '' },
    { minLengthCm: 55 }, { maxLengthCm: Infinity }, { basePricePerKg: 0 }, { basePricePerKg: 0.5 },
    { weight: { ...BLACK_BASS.weight, exponent: NaN } }, { weight: { ...BLACK_BASS.weight, referenceLengthCm: 1 } },
    { fight: { ...BLACK_BASS.fight, surgeAmplitude: 1 } }]) assert.throws(() => defineFishSpecies({ ...BLACK_BASS, ...update }), TypeError);
  const input = { ...BLACK_BASS, id: 'fixture-species', weight: { ...BLACK_BASS.weight }, fight: { ...BLACK_BASS.fight } };
  const registry = createFishSpeciesRegistry([BLACK_BASS, input]);
  input.weight.exponent = 100; input.fight.baseResistance = 100; input.name = 'changed';
  assert.equal(registry.get('fixture-species').weight.exponent, 3);
  assert.equal(registry.get('fixture-species').fight.baseResistance, 0.85);
  assert.equal(registry.get('fixture-species').name, BLACK_BASS.name);
  assert.equal(registry.get('black-bass'), BLACK_BASS);
  for (const id of ['missing', 'constructor', '__proto__', null, undefined]) assert.equal(registry.get(id), undefined);
  assert.ok(Object.isFrozen(registry.species) && Object.isFrozen(registry.get('fixture-species')));
  assert.equal(FISH_SPECIES.length, 12);
});

test('hypothetical species uses actual neutral encounter/lure/environment defaults and its own price', async t => {
  const sandbox = await fishSpeciesSandbox(t, { extra: true });
  const { FISH_SPECIES: definitions, getFishSpecies } = await sandbox.load('fish-species');
  const { getSpeciesProbabilities: probabilities } = await sandbox.load('fish-encounters');
  const { calculateSalePrice } = await sandbox.load('fish-sales');
  assert.equal(definitions.length, 13); assert.equal(FISH_SPECIES.length, 12);
  for (const lure of LURES) for (const depthM of [1, 7, 12]) for (const timeOfDay of ['day', 'night']) {
    const entries = probabilities(lure.id, { depthM, timeOfDay });
    assert.equal(entries.find(entry => entry.speciesId === 'fixture-species').weight, 1);
    assert.ok(Math.abs(entries.reduce((sum, entry) => sum + entry.probability, 0) - 1) < 1e-12);
    assert.deepEqual(entries.filter(entry => entry.speciesId !== 'fixture-species').map(({ speciesId, weight }) => ({ speciesId, weight })),
      getSpeciesProbabilities(lure.id, { depthM, timeOfDay }).map(({ speciesId, weight }) => ({ speciesId, weight })));
  }
  assert.equal(calculateSalePrice({ speciesId: 'fixture-species', weightKg: 1.5, qteSuccessCount: 0 }), getFishSpecies('fixture-species').basePricePerKg * 1.5);
});

test('an image-only PNG substitution preserves canonical saves, catches, sales, achievements and probabilities', async t => {
  const sandbox = await fishSpeciesSandbox(t, { png: true });
  const changed = await sandbox.load('fish-species');
  assert.match(changed.BLACK_BASS.image, /fixture\.png$/);
  assert.notEqual(changed.BLACK_BASS.image, BLACK_BASS.image);
  assert.deepEqual(changed.FISH_SPECIES.map(({ image, ...data }) => data), FISH_SPECIES.map(({ image, ...data }) => data));
  const collection = createCatchCollection({ now: () => 1000 });
  const achievements = createAchievements({ collection, now: () => 1000 });
  for (const [index, fish] of FISH_SPECIES.entries()) {
    const id = `legacy-${index}`;
    collection.register({ schemaVersion: 1, id, speciesId: fish.id, lengthCm: fish.minLengthCm, weightKg: 1, caughtAt: '2026-01-01T00:00:00.000Z' });
    if (index % 2) collection.sellUnassigned(id); else collection.store(id);
  }
  const old = createSaveData({ collection, achievements, boat: createBoatState(), clock: createGameClock() }, { savedAt: '2026-01-01T00:00:00.000Z' });
  const api = await sandbox.load('save-data');
  const restored = api.restoreSaveData(api.parseSaveData(serializeSaveData(old)), { now: () => 1000 });
  assert.deepEqual(api.createSaveData(restored, { savedAt: old.savedAt }), old);
  assert.deepEqual(restored.collection.encyclopedia, collection.encyclopedia);
  assert.deepEqual(restored.collection.stored, collection.stored);
  assert.deepEqual(restored.achievements.entries, achievements.entries);
  assert.match(changed.getFishSpecies(restored.collection.stored[0].speciesId).image, /fixture\.png$/);
  const { getSpeciesProbabilities: probabilities } = await sandbox.load('fish-encounters');
  for (const lure of LURES) assert.deepEqual(probabilities(lure.id, { depthM: 12, timeOfDay: 'night' }), getSpeciesProbabilities(lure.id, { depthM: 12, timeOfDay: 'night' }));
  assert.deepEqual(restored.collection.sellStored(['legacy-0']), collection.sellStored(['legacy-0']));
  assert.equal(old.saveVersion, 2);
  for (const field of ['image', 'imageFormat']) {
    const corrupt = JSON.parse(JSON.stringify(old)); corrupt.collection.catches[0][field] = 'fixture.png';
    assert.throws(() => parseSaveData(JSON.stringify(corrupt)));
  }
});

test('explicit SVG and mixed SVG/PNG fixtures remain independent of the production artwork', async t => {
  for (const png of [false, true]) {
    const sandbox = await fishSpeciesSandbox(t, { svg: true, png });
    const changed = await sandbox.load('fish-species');
    assert.deepEqual(changed.FISH_SPECIES.map(({ image, ...data }) => data), FISH_SPECIES.map(({ image, ...data }) => data));
    assert.match(changed.BLACK_BASS.image, png ? /fixture\.png$/ : /fixture\.svg$/);
    for (const fish of changed.FISH_SPECIES.slice(1)) assert.match(fish.image, /fixture\.svg$/);
  }
});
