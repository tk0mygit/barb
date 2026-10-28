import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createFishing, PHASE } from '../src/game/fishing.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { FISH_SPECIES, getFishSpecies } from '../src/game/fish-species.js';
import { fishResistance, isLargeFish } from '../src/game/fish-fight.js';
import { getEquipmentLevel } from '../src/game/equipment.js';
import { getSpeciesProbabilities } from '../src/game/fish-encounters.js';
import { FISH_RARITY } from '../src/game/fish-rarity.js';

const baseSha = '6fd79b45ecbdc0c80ebab55c2cb6f5289da2e0df';
const near = (a, b, epsilon = 1e-11) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const assistAt = [1, 1, 1, 1, 1, 1.03, 1.06, 1.09, 1.12, 1.15];
const speedAt = [1, 1.06, 1.12, 1.18, 1.24, 1.33, 1.43, 1.54, 1.65, 1.77];
const rodBonus = [[1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1.02, 1.10], [1.04, 1.20], [1.06, 1.30], [1.08, 1.40], [1.10, 1.50]];
const large = (s, length) => length >= 70 || (length >= 40 && (length - s.minLengthCm) / (s.maxLengthCm - s.minLengthCm) >= 0.75);

function upgrade(collection, kind, target) {
  while (collection.equipment[`${kind}Level`] < target) assert.ok(collection.purchaseUpgrade(kind, collection.equipment[`${kind}Level`]));
}
function collectionAt(rod, reel) {
  const collection = createCatchCollection({ now: () => 1700000000000 });
  collection.register({ schemaVersion: 1, id: 'fund', speciesId: 'black-bass', lengthCm: 50,
    weightKg: 1000, caughtAt: '2026-01-01T00:00:00.000Z' });
  collection.sellUnassigned('fund'); upgrade(collection, 'rod', rod); upgrade(collection, 'reel', reel);
  return collection;
}
function speciesRoll(rod, speciesId, legacy = false) {
  const entries = getSpeciesProbabilities('minnow').map(entry => ({ ...entry,
    weight: entry.weight * (legacy || FISH_RARITY[entry.speciesId] === 'Common' ? 1
      : rodBonus[rod - 1][FISH_RARITY[entry.speciesId] === 'Uncommon' ? 0 : 1]),
  }));
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let cumulative = 0;
  for (const entry of entries) {
    const p = entry.weight / total;
    if (entry.speciesId === speciesId) return cumulative + p / 2;
    cumulative += p;
  }
  throw new Error('Missing species');
}
function scenario(rod, reel, species = FISH_SPECIES[0], length = species.minLengthCm, engine = createFishing, legacy = false) {
  let calls = 0, rolls;
  const reset = (nextRod = rod) => { rolls = [0, speciesRoll(nextRod, species.id, legacy),
    Math.min(1 - Number.EPSILON, (length - species.minLengthCm) / (species.maxLengthCm - species.minLengthCm))]; };
  reset();
  const f = engine({ collection: collectionAt(rod, reel), now: () => 1700000000000,
    random: () => { calls++; return rolls.shift() ?? 0; } });
  return { f, reset, calls: () => calls };
}
function prepare(f) {
  assert.equal(f.prepare({ x: 0, z: 30 }, 0), true);
  const max = 32 + getEquipmentLevel('rod', f.collection.equipment.rodLevel).castDistanceBonusM;
  f.aim(0, 180 * 24.125 / (max - 8)); assert.equal(f.state.distance, 32);
}
function toBite(f) {
  if (f.state.phase === PHASE.AIM) f.cast();
  for (let frame = 0; [PHASE.CAST, PHASE.LURE].includes(f.state.phase) && frame < 10000; frame++) f.step(1 / 60);
  assert.equal(f.state.phase, PHASE.BITE);
}
function hook(f) { if (f.state.phase !== PHASE.FIGHT) { toBite(f); assert.equal(f.hook(), true); } }

test('large-fish predicate and public FIGHT honor every valid rounded 0.75 boundary and the 39.9/40, 69.9/70 thresholds', t => {
  let cases = 0;
  for (const species of FISH_SPECIES) {
    const boundary = species.minLengthCm + 0.75 * (species.maxLengthCm - species.minLengthCm);
    const lengths = new Set([39.9, 40, 69.9, 70, species.minLengthCm, species.maxLengthCm,
      Math.floor(boundary * 10) / 10 - 0.1, Math.floor(boundary * 10) / 10,
      Math.ceil(boundary * 10) / 10, Math.ceil(boundary * 10) / 10 + 0.1].map(value => Math.round(value * 10) / 10));
    for (const length of lengths) {
      if (length < species.minLengthCm || length > species.maxLengthCm) continue;
      const expected = large(species, length);
      assert.equal(isLargeFish(species, length), expected);
      const { f, calls } = scenario(1, 10, species, length); prepare(f); hook(f);
      assert.equal(f.state.encounter.speciesId, species.id); assert.equal(f.state.encounter.lengthCm, length);
      const resistance = Math.max(0.8, Math.min(1.25, fishResistance(species, length, 1 / 60)));
      const expectedDistance = 32 - 27.5 / (6.5 * resistance) * 1.77 * (expected ? 1.15 : 1) / 60;
      f.reel(true); f.step(1 / 60);
      near(f.state.distance, expectedDistance); assert.equal(calls(), 3); cases++;
    }
  }
  assert.equal(isLargeFish(getFishSpecies('iwana'), 39.9), false);
  assert.equal(isLargeFish(getFishSpecies('iwana'), 40), true);
  assert.equal(isLargeFish(getFishSpecies('northern-pike'), 69.9), false);
  assert.equal(isLargeFish(getFishSpecies('northern-pike'), 70), true);
  assert.equal(isLargeFish(getFishSpecies('bluegill'), 23.5), false); // Relative 0.75 alone is insufficient.
  t.diagnostic(`${cases} valid rounded boundary/species cases; no out-of-range test individuals`);
});

test('all ten reel levels apply exact FIGHT-only assist; LURE, stopped retrieval and tension remain unchanged', () => {
  for (let reel = 1; reel <= 10; reel++) {
    const row = getEquipmentLevel('reel', reel);
    assert.equal(row.largeFishAssistMultiplier ?? 1, assistAt[reel - 1]);
    assert.equal(Object.hasOwn(row, 'largeFishAssistMultiplier'), reel > 5);
    for (const hz of [30, 60, 144]) {
      const { f, calls } = scenario(1, reel, getFishSpecies('alligator-gar'), 180);
      prepare(f); f.cast(); f.step(0.801);
      const start = f.state.distance;
      f.reel(true);
      for (let frame = 0; frame < hz / 2; frame++) f.step(1 / hz);
      near(start - f.state.distance, 0.65 * speedAt[reel - 1] * 0.5);
      f.reel(false); const stopped = f.state.distance;
      f.step(0.5); assert.equal(f.state.distance, stopped); hook(f);
      const individual = f.state.encounter, before = f.state.distance;
      f.step(0.25); assert.equal(f.state.distance, before);
      near(f.state.tension, 0.42 - 0.42 * row.tensionReliefMultiplier * 0.25);
      assert.equal(f.state.encounter, individual); assert.equal(calls(), 3);
    }
  }
});

test('all 12 species × 3 sizes × 3 frame rates × 5 reels × 3 rods match the approved FIGHT equation exactly', t => {
  let cases = 0;
  for (const rod of [1, 5, 10]) for (const reel of [1, 5, 6, 8, 10]) for (const species of FISH_SPECIES) {
    for (const size of [0, 0.5, 1]) for (const hz of [30, 60, 144]) {
      const length = Math.round((species.minLengthCm + size * (species.maxLengthCm - species.minLengthCm)) * 10) / 10;
      const { f, calls } = scenario(rod, reel, species, length); prepare(f); hook(f);
      assert.equal(f.state.encounter.speciesId, species.id); assert.equal(f.state.encounter.lengthCm, length);
      const individual = f.state.encounter;
      let distance = 32, tension = 0.42, time = 0;
      f.reel(true);
      for (let frame = 0; frame < hz / 2; frame++) {
        const steps = hz === 30 ? 2 : 1, dt = 1 / hz / steps;
        for (let i = 0; i < steps; i++) {
          time += dt;
          const resistance = fishResistance(species, length, time);
          distance -= 27.5 / (6.5 * Math.max(0.8, Math.min(1.25, resistance))) * speedAt[reel - 1]
            * (large(species, length) ? assistAt[reel - 1] : 1) * dt;
          tension += 0.24 * resistance * getEquipmentLevel('rod', rod).tensionMultiplier * dt;
        }
        f.step(1 / hz);
      }
      assert.equal(f.state.phase, PHASE.FIGHT);
      near(f.state.distance, distance); near(f.state.tension, tension);
      assert.equal(f.state.encounter, individual); assert.equal(calls(), 3);
      const stopped = f.state.distance; f.reel(false); f.step(0.1); assert.equal(f.state.distance, stopped);
      cases++;
    }
  }
  assert.equal(cases, 1620); t.diagnostic('1620 FIGHT integrations: absolute tolerance 1e-11, unchanged tension/resistance/clamp');
});

test('Tier and large-fish assist freeze through AIM/CAST/LURE/BITE/FIGHT purchases; next successful prepare refreshes both', () => {
  for (const level of [1, 6]) for (const stage of ['aim', 'cast', 'lure', 'bite', 'fight']) {
    const species = getFishSpecies('alligator-gar');
    const a = scenario(level, level, species, 180), b = scenario(level, level, species, 180);
    for (const { f } of [a, b]) {
      prepare(f);
      if (stage === 'cast') f.cast();
      if (stage === 'lure') { f.cast(); f.step(0.801); }
      if (['bite', 'fight'].includes(stage)) toBite(f);
      if (stage === 'fight') assert.equal(f.hook(), true);
    }
    for (const kind of ['rod', 'reel']) upgrade(a.f.collection, kind, 10);
    assert.equal(a.f.prepare({ x: 0, z: 0 }, 0), false);
    for (const { f } of [a, b]) { hook(f); f.reel(true); f.step(0.5); }
    assert.deepEqual(a.f.state, b.f.state);
    a.f.reel(false);
    for (let frame = 0; frame < 1000 && a.f.state.phase === PHASE.FIGHT; frame++) a.f.step(1 / 60);
    assert.equal(a.f.state.phase, PHASE.FAILED); assert.match(a.f.state.message, /緩み/);
    a.f.step(2); a.reset(10); prepare(a.f); hook(a.f);
    const next = scenario(10, 10, species, 180); prepare(next.f); hook(next.f);
    assert.equal(a.f.state.encounter.speciesId, species.id); assert.equal(a.f.state.encounter.lengthCm, 180);
    for (const { f } of [a, next]) { f.reel(true); f.step(0.5); }
    assert.equal(a.f.state.distance, next.f.state.distance); assert.equal(a.f.state.tension, next.f.state.tension);
  }
});

test('actual 5B-1A engine/rows retain exact Lv.1–5 state and RNG; continuous high-level fights still break or escape', async t => {
  // Compare the real frozen start commit, never a rewritten legacy algorithm.
  const root = await mkdtemp(join(tmpdir(), 'barb-5b1b-reference-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(new URL('../src/', import.meta.url), join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  for (const name of ['fishing', 'equipment']) await writeFile(join(root, `src/game/${name}.js`),
    execFileSync('git', ['show', `${baseSha}:src/game/${name}.js`], { cwd: new URL('../', import.meta.url) }));
  const base = await import(pathToFileURL(join(root, 'src/game/fishing.js')));
  const equipment = await import(pathToFileURL(join(root, 'src/game/equipment.js')));
  for (const kind of ['rod', 'reel']) for (let level = 1; level <= 10; level++) {
    const actual = getEquipmentLevel(kind, level), expected = equipment.getEquipmentLevel(kind, level);
    if (level <= 5) assert.deepEqual(actual, expected);
    else {
      const { tierMultipliers, largeFishAssistMultiplier, ...basic } = actual;
      assert.deepEqual(basic, expected);
    }
  }
  let comparisons = 0;
  for (let rod = 1; rod <= 5; rod++) for (let reel = 1; reel <= 5; reel++) for (const species of FISH_SPECIES) {
    for (const size of [0, 0.5, 1]) for (const hz of [30, 60, 144]) {
      const length = Math.round((species.minLengthCm + size * (species.maxLengthCm - species.minLengthCm)) * 10) / 10;
      const a = scenario(rod, reel, species, length), b = scenario(rod, reel, species, length, base.createFishing, true);
      for (const { f } of [a, b]) { prepare(f); hook(f); }
      assert.deepEqual(a.f.state, b.f.state);
      for (const { f } of [a, b]) f.reel(true);
      for (let frame = 0; frame < hz / 2; frame++) { a.f.step(1 / hz); b.f.step(1 / hz); }
      assert.deepEqual(a.f.state, b.f.state); assert.equal(a.calls(), b.calls()); comparisons++;
    }
  }
  assert.equal(comparisons, 2700); t.diagnostic('2700 legacy engine comparisons: full state/RNG exactly equal, all old rows/fields and all basic/price fields unchanged');

  for (const level of [1, 5, 6, 8, 10]) for (const hz of [30, 60, 144]) {
    const outcome = [];
    for (const [label, engine, legacy] of [['5B-1A', base.createFishing, true], ['5B-1B', createFishing, false]]) {
      const times = [], landed = [];
      for (const species of FISH_SPECIES) for (const size of [0, 0.5, 1]) {
        const length = Math.round((species.minLengthCm + size * (species.maxLengthCm - species.minLengthCm)) * 10) / 10;
        const { f } = scenario(level, level, species, length, engine, legacy); prepare(f); hook(f); f.reel(true);
        let elapsed = 0;
        while (f.state.phase === PHASE.FIGHT && elapsed < 20) { f.step(1 / hz); elapsed += 1 / hz; }
        if (f.state.phase === PHASE.LANDING) { assert.ok(elapsed > 2); times.push(elapsed); landed.push(`${species.id}/${size}`); }
        else { assert.equal(f.state.phase, PHASE.FAILED); assert.match(f.state.message, /切れ/); }
        if (species.id === 'alligator-gar' && size === 1) assert.equal(f.state.phase, PHASE.FAILED);
      }
      outcome.push(landed);
      t.diagnostic(`${label} continuous rod/reel ${level}, ${hz}fps: ${landed.length}/36 catches, ${times.length ? `${Math.min(...times).toFixed(3)}–${Math.max(...times).toFixed(3)}s` : 'all line breaks'}`);
    }
    if (level <= 5) assert.deepEqual(outcome[0], outcome[1]);
    const slack = scenario(level, level, getFishSpecies('alligator-gar'), 180).f; prepare(slack); hook(slack);
    const start = slack.state.distance;
    for (let frame = 0; frame < hz * 5 && slack.state.phase === PHASE.FIGHT; frame++) { slack.step(1 / hz); assert.equal(slack.state.distance, start); }
    assert.equal(slack.state.phase, PHASE.FAILED); assert.match(slack.state.message, /緩み/); assert.equal(slack.state.tension, 0);
  }
});
