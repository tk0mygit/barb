import test from 'node:test';
import assert from 'node:assert/strict';
import { FISH_SPECIES, calculateFishWeightKg } from '../src/game/fish-species.js';
import { LURES, getLure } from '../src/game/lures.js';
import { APPEARANCE_WEIGHTS, getSpeciesProbabilities, sampleFishSpecies } from '../src/game/fish-encounters.js';
import { fishResistance } from '../src/game/fish-fight.js';
import { createFishing, PHASE } from '../src/game/fishing.js';
import { createFishingInput } from '../src/input/fishing.js';
import { randomGenerator } from '../src/world/config.js';

function speciesRoll(lureId, speciesId) {
  let start = 0;
  for (const entry of getSpeciesProbabilities(lureId)) {
    if (entry.speciesId === speciesId) return start + entry.probability / 2;
    start += entry.probability;
  }
  throw new Error('Missing species');
}
function cast(f) {
  f.prepare({ x: 0, z: 0 }, 0); f.aim(0, 180); f.cast();
  f.step(f.settings.flightSeconds + 0.01);
}
function encounter(lureId, speciesId, size) {
  const rolls = [0, speciesRoll(lureId, speciesId), size];
  const f = createFishing({ random: () => rolls.shift() ?? 0.5, now: () => 1700000000000 });
  f.selectLure(lureId); cast(f);
  while (f.state.phase === PHASE.LURE) f.step(0.01);
  assert.equal(f.state.phase, PHASE.BITE);
  return f;
}
// One-finger feedback, including the real 220ms hold threshold and 100ms
// observation interval. No state mutation or equipment upgrade shortcuts.
function land(f, dt = 1 / 60) {
  const input = createFishingInput(f);
  let held = false, elapsed = 0, observe = 0;
  while (f.state.phase === PHASE.FIGHT && elapsed < 30) {
    if (elapsed >= observe) {
      if (!held && f.state.tension < 0.35) { input.down(0, 0); held = true; }
      else if (held && f.state.tension > 0.65) { input.up(); held = false; }
      observe += 0.1;
    }
    input.step(dt); f.step(dt); elapsed += dt;
  }
  input.cancel();
  assert.equal(f.state.phase, PHASE.LANDING, `${f.state.encounter.speciesId}: ${f.state.message}`);
  const lureId = f.state.lureId;
  assert.equal(f.selectLure(lureId === 'minnow' ? 'worm' : 'minnow'), false);
  assert.equal(f.state.lureId, lureId);
  f.step(2);
  assert.equal(f.state.phase, PHASE.RESULT);
  return elapsed;
}

test('four immutable lures have positive affinities for all 12 species and bounded bite rates', () => {
  assert.deepEqual(LURES.map(lure => lure.id), ['minnow', 'crankbait', 'worm', 'spinnerbait']);
  assert.equal(getLure('missing'), undefined);
  for (const lure of LURES) {
    assert.equal(getLure(lure.id), lure);
    assert.ok(Object.isFrozen(lure) && Object.isFrozen(lure.affinities));
    assert.ok(lure.hitMultiplier >= 0.8 && lure.hitMultiplier <= 1.2);
    assert.equal(Object.keys(lure.affinities).length, 12);
    for (const fish of FISH_SPECIES) {
      assert.ok(Number.isFinite(lure.affinities[fish.id]) && lure.affinities[fish.id] > 0);
      assert.ok(Number.isFinite(APPEARANCE_WEIGHTS[fish.id]) && APPEARANCE_WEIGHTS[fish.id] > 0);
    }
  }
});

test('normalized weights, interval sampling and boundaries cover all 12 species for every lure', () => {
  for (const lure of LURES) {
    const entries = getSpeciesProbabilities(lure.id);
    assert.equal(entries.length, 12);
    assert.ok(Math.abs(entries.reduce((sum, entry) => sum + entry.probability, 0) - 1) < 1e-12);
    const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
    for (const entry of entries) {
      assert.equal(entry.weight, APPEARANCE_WEIGHTS[entry.speciesId] * lure.affinities[entry.speciesId]);
      assert.equal(entry.probability, entry.weight / total);
      assert.equal(sampleFishSpecies(lure.id, () => speciesRoll(lure.id, entry.speciesId)).id, entry.speciesId);
    }
    assert.equal(sampleFishSpecies(lure.id, () => 0).id, 'black-bass');
    assert.equal(sampleFishSpecies(lure.id, () => 1 - Number.EPSILON).id, 'arowana');
  }
  assert.throws(() => getSpeciesProbabilities('missing'), RangeError);
  for (const roll of [-1, 1, NaN, Infinity]) assert.throws(() => sampleFishSpecies('minnow', () => roll), RangeError);
});

test('seeded sampling follows lure affinities, including rare fish', () => {
  const samples = 20000;
  const countsByLure = {};
  for (const lure of LURES) {
    const random = randomGenerator(423);
    const counts = Object.fromEntries(FISH_SPECIES.map(fish => [fish.id, 0]));
    for (let i = 0; i < samples; i++) counts[sampleFishSpecies(lure.id, random).id]++;
    for (const entry of getSpeciesProbabilities(lure.id)) {
      assert.ok(counts[entry.speciesId] > 0);
      assert.ok(Math.abs(counts[entry.speciesId] / samples - entry.probability) < 0.01);
    }
    countsByLure[lure.id] = counts;
  }
  assert.ok(countsByLure.worm.bluegill > countsByLure.minnow.bluegill * 2);
  assert.ok(countsByLure.spinnerbait['northern-pike'] > countsByLure.worm['northern-pike'] * 2);
});

test('each lure preserves 10–20 second average bite pacing', t => {
  for (const lure of LURES) {
    const random = randomGenerator(420);
    let total = 0;
    for (let i = 0; i < 1000; i++) {
      const f = createFishing({ random }); f.selectLure(lure.id); cast(f);
      while (f.state.phase === PHASE.LURE) { f.step(0.1); total += 0.1; }
    }
    const mean = total / 1000;
    assert.ok(mean > 10 && mean < 20, `${lure.id}: ${mean}`);
    t.diagnostic(`${lure.id}: mean bite ${mean.toFixed(2)}s`);
  }
});

test('lure selection is locked from preparation through result/failure and restored after cancellation/retry', () => {
  const f = createFishing({ random: () => 0 });
  assert.equal(f.selectLure('worm'), true);
  assert.equal(f.selectLure('missing'), false); assert.equal(f.state.lureId, 'worm');
  const locked = () => { assert.equal(f.selectLure('minnow'), false); assert.equal(f.state.lureId, 'worm'); };
  f.prepare({ x: 0, z: 0 }, 0); locked();
  f.cancelInput(); assert.equal(f.selectLure('crankbait'), true); f.selectLure('worm');
  f.prepare({ x: 0, z: 0 }, 0); f.cast(); locked();
  f.step(0.81); locked();
  while (f.state.phase === PHASE.LURE) f.step(0.01);
  locked(); const selected = f.state.encounter;
  assert.ok(Object.isFrozen(selected)); assert.equal(f.hook(), true); locked();
  assert.equal(f.state.encounter, selected);
  f.reel(true);
  while (f.state.phase === PHASE.FIGHT) f.step(0.01);
  assert.equal(f.state.phase, PHASE.FAILED); locked();
  f.step(2); assert.equal(f.state.encounter, null);
  assert.equal(f.selectLure('spinnerbait'), true);
  const success = encounter('worm', 'catfish', 0.5);
  success.hook(); land(success);
  assert.equal(success.selectLure('minnow'), false);
  success.closeResult(); assert.equal(success.selectLure('minnow'), true);
});

test('all 12 species land with all four lures at minimum/mid/maximum sizes at 30 and 144 fps', t => {
  for (const species of FISH_SPECIES) {
    const durations = [];
    for (const lure of LURES) for (const size of [0, 0.5, 1 - Number.EPSILON]) for (const dt of [1 / 30, 1 / 144]) {
      const f = encounter(lure.id, species.id, size);
      const selected = f.state.encounter;
      assert.equal(selected.speciesId, species.id);
      assert.equal(f.hook(), true);
      assert.equal(f.state.encounter, selected);
      const elapsed = land(f, dt); durations.push(elapsed);
      const fight = f.state.fight, span = fight.startDistance - fight.landingDistance;
      // Stopped FIGHT now adds retrieval work. Preserve the original pacing
      // bound per equivalent starting span. The 5C-1R PM decision changes
      // the observed FIGHT pacing target from 20s to 30s, not a runtime timer.
      const equivalentSeconds = elapsed * span / (span + fight.pushbackMeters);
      assert.ok(elapsed >= 5 && elapsed <= 30, `${species.id}: ${elapsed}`);
      assert.ok(equivalentSeconds <= (species.id === 'alligator-gar' ? 20 : 16),
        `${species.id}: ${elapsed}s / ${equivalentSeconds}s equivalent, push=${fight.pushbackMeters}m`);
      const record = f.state.catch;
      assert.equal(record.speciesId, species.id); assert.equal(record.schemaVersion, 1);
      assert.equal(record.lengthCm, Math.round((species.minLengthCm + size * (species.maxLengthCm - species.minLengthCm)) * 10) / 10);
      assert.equal(record.weightKg, calculateFishWeightKg(species.id, record.lengthCm));
      assert.equal(record.caughtAt, '2023-11-14T22:13:20.000Z');
      assert.equal(record.disposition, 'unassigned');
      assert.ok(Object.isFrozen(record));
      f.step(10); assert.equal(f.state.catches.length, 1);
      f.closeResult(); assert.equal(f.state.encounter, null); assert.equal(f.state.catch, null);
      assert.deepEqual(f.state.catches[0], { ...record, disposition: 'stored' }); cast(f);
    }
    t.diagnostic(`${species.id}: fight ${Math.min(...durations).toFixed(2)}–${Math.max(...durations).toFixed(2)}s`);
  }
});

test('species, length and surge timing affect actual tension and retrieval difficulty', () => {
  const tensionBySpecies = [];
  for (const species of FISH_SPECIES) {
    const { baseResistance, surgeAmplitude, surgeFrequency } = species.fight;
    const peakTime = Math.PI / (2 * surgeFrequency), troughTime = 3 * peakTime;
    assert.ok(Math.abs(fishResistance(species, species.minLengthCm, peakTime) - (baseResistance + surgeAmplitude)) < 1e-12);
    assert.ok(Math.abs(fishResistance(species, species.minLengthCm, troughTime) - (baseResistance - surgeAmplitude)) < 1e-12);
    const snapshots = [0, 1 - Number.EPSILON].map(size => {
      const f = encounter('minnow', species.id, size); f.hook(); f.reel(true); f.step(0.5);
      return { tension: f.state.tension, distance: f.state.distance };
    });
    assert.ok(snapshots[1].tension > snapshots[0].tension);
    assert.ok(snapshots[1].distance >= snapshots[0].distance);
    tensionBySpecies.push(snapshots[0].tension);
  }
  assert.equal(new Set(tensionBySpecies).size, 12);
  assert.ok(tensionBySpecies[10] > tensionBySpecies[2]);
});
