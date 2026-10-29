import test from 'node:test';
import { createCatchCollection } from '../src/game/catch-collection.js';
import assert from 'node:assert/strict';
import { DEPTH_CONFIG, estimateWaterDepth, getDepthBand } from '../src/world/depth.js';
import { shoreRadius, randomGenerator } from '../src/world/config.js';
import { createGameClock } from '../src/game/game-clock.js';
import { FISH_ENVIRONMENT_AFFINITIES, LURE_DEPTH_AFFINITIES, getEnvironmentWeight } from '../src/game/encounter-affinities.js';
import { FISH_SPECIES } from '../src/game/fish-species.js';
import { LURES } from '../src/game/lures.js';
import { getSpeciesProbabilities, sampleFishSpecies, normalizeEncounterConditions } from '../src/game/fish-encounters.js';
import { createFishing, getLurePosition, PHASE } from '../src/game/fishing.js';
import { FISHING_SPOTS } from '../src/world/fishing-spots.js';

const conditions = [1, 5, 12].flatMap(depthM => ['day', 'night'].map(timeOfDay => ({ depthM, timeOfDay })));

test('radial shore model is shallow at every shoreline, increases offshore and stays bounded', () => {
  for (let angle = 0; angle < 2 * Math.PI; angle += 0.05) {
    const shore = shoreRadius(angle);
    const depths = [0, 5, 20, 50, 90].map(clearance => estimateWaterDepth({ x: Math.cos(angle) * (shore - clearance), z: Math.sin(angle) * (shore - clearance) }));
    assert.ok(depths[0] < 1e-9);
    for (let i = 1; i < depths.length; i++) assert.ok(depths[i] > depths[i - 1]);
    assert.ok(Math.abs(depths.at(-1) - DEPTH_CONFIG.maxDepthM) < 1e-9);
    assert.equal(estimateWaterDepth({ x: Math.cos(angle) * (shore + 1), z: Math.sin(angle) * (shore + 1) }), 0);
  }
  assert.equal(estimateWaterDepth({ x: 0, z: 0 }), 12);
  const config = { ...DEPTH_CONFIG, maxDepthM: 20, offshoreDistanceM: 100, exponent: 1 };
  assert.equal(estimateWaterDepth({ x: shoreRadius(0) - 50, z: 0 }, config), 10);
  for (const [depth, band] of [[0, 'shallow'], [2.999999, 'shallow'], [3, 'mid'], [7.999999, 'mid'], [8, 'deep'], [12, 'deep']]) assert.equal(getDepthBand(depth), band);
});

test('invalid coordinates and malformed conditions never produce invalid sampling values', () => {
  for (const position of [null, undefined, {}, { x: NaN, z: 0 }, { x: 0, z: Infinity }, { x: '1', z: 0 }, { x: Number.MAX_VALUE, z: Number.MAX_VALUE }]) {
    assert.equal(estimateWaterDepth(position), 0);
    const entries = getSpeciesProbabilities('minnow', { depthM: estimateWaterDepth(position), timeOfDay: 'day' });
    assert.ok(entries.every(entry => Number.isFinite(entry.probability) && entry.probability > 0));
  }
  for (const depthM of [NaN, Infinity, -1, '12', null]) {
    const invalid = { depthM, timeOfDay: 'unknown', cycleProgress: Infinity };
    assert.deepEqual(getSpeciesProbabilities('minnow', invalid), getSpeciesProbabilities('minnow'));
    assert.deepEqual(normalizeEncounterConditions(invalid), { depthM: null, depthBand: null, timeOfDay: null, cycleProgress: null });
  }
});

test('clock starts in day, changes at 180s, wraps at 360s and supports multi-cycle deltas', () => {
  const clock = createGameClock();
  assert.equal(clock.state.timeOfDay, 'day'); assert.equal(clock.state.cycleProgress, 0);
  clock.step(179.999999); assert.equal(clock.state.timeOfDay, 'day');
  clock.step(0.000001); assert.equal(clock.state.timeOfDay, 'night'); assert.equal(clock.state.cycleProgress, 0.5);
  assert.equal(clock.state.phaseProgress, 0);
  clock.step(179.999999); assert.equal(clock.state.timeOfDay, 'night');
  clock.step(0.000001); assert.equal(clock.state.timeOfDay, 'day'); assert.equal(clock.state.cycleProgress, 0);
  clock.step(360 * 100 + 270);
  assert.equal(clock.state.cycleSeconds, 270); assert.equal(clock.state.phaseProgress, 0.5);
  assert.ok(Object.isFrozen(clock.state));
});

test('clock is equivalent at 30, 60 and 144fps, independent of frame caps and paused/wall time', () => {
  const snapshots = [30, 60, 144].map(hz => {
    const clock = createGameClock();
    for (let i = 0; i < 180 * hz; i++) clock.step(1 / hz);
    assert.equal(clock.state.timeOfDay, 'night');
    for (let i = 0; i < 180 * hz; i++) clock.step(1 / hz);
    assert.equal(clock.state.timeOfDay, 'day');
    const before = clock.state;
    clock.step(7200, true);
    for (const dt of [-1, 0, NaN, Infinity, undefined]) clock.step(dt);
    assert.deepEqual(clock.state, before);
    clock.step(35); // a visible long frame advances the full elapsed time
    return clock.state;
  });
  assert.deepEqual(snapshots[0], snapshots[1]); assert.deepEqual(snapshots[1], snapshots[2]);
  const custom = createGameClock({ daySeconds: 2, nightSeconds: 3 }); custom.step(3);
  assert.equal(custom.state.timeOfDay, 'night'); assert.equal(custom.state.phaseProgress, 1 / 3);
  assert.throws(() => createGameClock({ daySeconds: 0 }), RangeError);
});

test('all fish and lure environment profiles are immutable, positive and moderate', () => {
  assert.equal(Object.keys(FISH_ENVIRONMENT_AFFINITIES).length, 12);
  assert.equal(Object.keys(LURE_DEPTH_AFFINITIES).length, 4);
  for (const fish of FISH_SPECIES) {
    const profile = FISH_ENVIRONMENT_AFFINITIES[fish.id];
    assert.ok(Object.isFrozen(profile) && Object.isFrozen(profile.depth) && Object.isFrozen(profile.time));
    assert.deepEqual(Object.keys(profile.depth), ['shallow', 'mid', 'deep']);
    for (const value of [...Object.values(profile.depth), ...Object.values(profile.time)]) assert.ok(value >= 0.75 && value <= 1.3);
  }
  for (const lure of LURES) for (const value of Object.values(LURE_DEPTH_AFFINITIES[lure.id])) assert.ok(value >= 0.8 && value <= 1.2);
});

test('all 24 environment/lure combinations normalize to one and sample all 12 fish reproducibly', t => {
  let min = 1, max = 0;
  for (const lure of LURES) for (const environment of conditions) {
    const entries = getSpeciesProbabilities(lure.id, environment);
    assert.ok(Math.abs(entries.reduce((sum, entry) => sum + entry.probability, 0) - 1) < 1e-12);
    let cumulative = 0;
    for (const entry of entries) {
      min = Math.min(min, entry.probability); max = Math.max(max, entry.probability);
      const roll = cumulative + entry.probability / 2;
      assert.equal(sampleFishSpecies(lure.id, () => roll, environment).id, entry.speciesId);
      cumulative += entry.probability;
    }
    const a = randomGenerator(10), b = randomGenerator(10);
    assert.deepEqual(Array.from({ length: 100 }, () => sampleFishSpecies(lure.id, a, environment).id), Array.from({ length: 100 }, () => sampleFishSpecies(lure.id, b, environment).id));
    assert.deepEqual(entries, getSpeciesProbabilities(lure.id, { ...environment, spotMultiplier: 1.5 }));
  }
  assert.ok(min > 0.005 && max < 0.4);
  t.diagnostic(`probability range ${(min * 100).toFixed(2)}–${(max * 100).toFixed(2)}%`);
});

test('shallow/day favours bluegill, deep/night favours walleye; lure depth affinity survives normalization', () => {
  const probability = (id, environment) => getSpeciesProbabilities('minnow', environment).find(entry => entry.speciesId === id).probability;
  assert.ok(probability('bluegill', { depthM: 1, timeOfDay: 'day' }) > probability('bluegill', { depthM: 12, timeOfDay: 'night' }));
  assert.ok(probability('walleye', { depthM: 12, timeOfDay: 'night' }) > probability('walleye', { depthM: 1, timeOfDay: 'day' }));
  // Isolate depth factors from the existing lure-species affinities: a common
  // scalar would leave this ratio unchanged between lures, but ours does not.
  const ratio = lureId => getEnvironmentWeight('bluegill', lureId, { depthBand: 'shallow', timeOfDay: 'day' }) / getEnvironmentWeight('walleye', lureId, { depthBand: 'shallow', timeOfDay: 'day' });
  assert.ok(ratio('spinnerbait') > ratio('crankbait'));
});

function cast(f, origin = { x: 0, z: 30 }) {
  f.prepare(origin, 0); f.aim(0, 180); f.cast(); f.step(0.801);
}
function bite(f) {
  let seconds = 0;
  while (f.state.phase === PHASE.LURE && seconds < 100) { f.step(0.01); seconds += 0.01; }
  assert.equal(f.state.phase, PHASE.BITE); return seconds;
}
function land(f) {
  assert.equal(f.hook(), true);
  let held = false;
  // 5C-1R's approved 30s observation target; this does not end a game FIGHT.
  for (let frame = 0; frame < 30 * 60 && f.state.phase === PHASE.FIGHT; frame++) {
    if (f.state.tension < 0.4) held = true;
    if (f.state.tension > 0.78) held = false;
    f.reel(held); f.step(1 / 60);
  }
  assert.equal(f.state.phase, PHASE.LANDING); f.step(2); assert.equal(f.state.phase, PHASE.RESULT);
}

test('all 12 fish can be caught in every depth, time and lure combination; conditions persist to catch', () => {
  for (const rodLevel of [1, 5]) for (const reelLevel of [1, 5]) for (const lure of LURES) for (const environment of conditions) {
    let cumulative = 0;
    for (const entry of getSpeciesProbabilities(lure.id, environment)) {
      const rolls = [0, cumulative + entry.probability / 2, 0.5];
      cumulative += entry.probability;
      let current = environment;
      const f = createFishing({ random: () => rolls.shift() ?? 0.5, getEnvironment: () => current, collection: createCatchCollection() });
      if (rodLevel === 5 || reelLevel === 5) {
        f.collection.register({ schemaVersion: 1, id: 'fund', speciesId: 'black-bass', lengthCm: 50, weightKg: 1000, caughtAt: '2026-01-01T00:00:00Z' });
        f.collection.sellUnassigned('fund');
        for (const [kind, target] of [['rod', rodLevel], ['reel', reelLevel]])
          for (let level = 1; level < target; level++) assert.ok(f.collection.purchaseUpgrade(kind, level));
      }
      f.selectLure(lure.id); cast(f); bite(f);
      assert.equal(f.state.encounter.speciesId, entry.speciesId);
      const snapshot = f.state.encounter.conditions;
      current = { depthM: 0, timeOfDay: 'night' }; // no resampling after the bite
      land(f);
      assert.equal(f.state.catch.speciesId, entry.speciesId);
      assert.equal(f.state.catch.conditions, snapshot);
      assert.equal(f.state.catch.schemaVersion, 1);
      assert.equal(snapshot.timeOfDay, environment.timeOfDay); assert.equal(snapshot.depthM, environment.depthM);
      assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.lurePosition));
      f.closeResult(); assert.equal(f.state.encounter, null);
    }
  }
});

test('sampling uses the retrieved lure surface position, not the boat or original landing target', () => {
  const boat = { x: 0, z: shoreRadius(Math.PI / 2) - 10 };
  let sampledPosition;
  const clock = createGameClock();
  const f = createFishing({ random: () => 0.5, getEnvironment: position => {
    sampledPosition = position;
    return { depthM: estimateWaterDepth(position), ...clock.state };
  } });
  cast(f, boat); const landed = { ...f.state.target };
  f.reel(true); bite(f);
  assert.deepEqual(sampledPosition, getLurePosition(f.state));
  assert.notDeepEqual(sampledPosition, boat); assert.notDeepEqual(sampledPosition, landed);
  assert.notEqual(estimateWaterDepth(sampledPosition), estimateWaterDepth(boat));
  assert.notEqual(estimateWaterDepth(sampledPosition), estimateWaterDepth(landed));
  clock.step(180); land(f);
  assert.equal(f.state.catch.conditions.timeOfDay, 'day'); assert.equal(clock.state.timeOfDay, 'night');
});

test('environment changes neither bite timing nor the 1.5x boat spot bonus, for every lure', () => {
  for (const lure of LURES) {
    const wait = (environment, origin) => {
      const f = createFishing({ random: () => 0.5, getEnvironment: environment ? () => environment : undefined });
      f.selectLure(lure.id); cast(f, origin); return bite(f);
    };
    const neutral = wait(null), spotNeutral = wait(null, FISHING_SPOTS[0]);
    for (const environment of conditions) {
      assert.equal(wait(environment), neutral);
      assert.equal(wait(environment, FISHING_SPOTS[0]), spotNeutral);
    }
    assert.ok(Math.abs((neutral - 3) / (spotNeutral - 3) - 1.5) < 0.01);
  }
});
