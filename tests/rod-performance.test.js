import test from 'node:test';
import assert from 'node:assert/strict';
import { createFishing, getLurePosition, PHASE } from '../src/game/fishing.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { FISH_SPECIES } from '../src/game/fish-species.js';
import { fishResistance } from '../src/game/fish-fight.js';
import { getSpeciesProbabilities } from '../src/game/fish-encounters.js';
import { shoreRadius } from '../src/world/config.js';
import { FISHING_SPOTS } from '../src/world/fishing-spots.js';
import { LURES } from '../src/game/lures.js';

const near = (a, b, epsilon = 1e-12) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
function collectionAt(level) {
  const collection = createCatchCollection({ now: () => 1700000000000 });
  collection.register({ schemaVersion: 1, id: 'fund', speciesId: 'black-bass', lengthCm: 50,
    weightKg: 100, caughtAt: '2026-01-01T00:00:00Z' });
  collection.sellUnassigned('fund');
  upgrade(collection, level);
  return collection;
}
function upgrade(collection, level) {
  while (collection.equipment.rodLevel < level) assert.ok(collection.purchaseUpgrade('rod', collection.equipment.rodLevel));
}
function prepare(f) { assert.equal(f.prepare({ x: 0, z: 30 }, 0), true); f.aim(0, 180); }
function hook(f) {
  f.cast();
  for (let i = 0; i < 10000 && f.state.phase !== PHASE.BITE; i++) f.step(1 / 60);
  assert.equal(f.hook(), true);
}
function fishing(level, species = FISH_SPECIES[0], size = 0.5, options = {}) {
  let cumulative = 0, roll;
  for (const entry of getSpeciesProbabilities('minnow')) {
    if (entry.speciesId === species.id) roll = cumulative + entry.probability / 2;
    cumulative += entry.probability;
  }
  const rolls = [0, roll, size];
  return createFishing({ collection: collectionAt(level), random: () => rolls.shift() ?? 0.5, ...options });
}

test('all rod levels preserve 8m minimum and drag scale, extend maximum, and land at the preview', () => {
  for (const [level, max] of [[1, 32], [2, 34], [3, 36], [4, 38], [5, 40]]) {
    for (const drag of [0, 45, 90, 180, 360]) {
      const f = fishing(level); prepare(f); f.aim(0, drag);
      assert.equal(f.state.distance, 8 + (max - 8) * Math.min(drag / 180, 1));
      const preview = { ...f.state.target };
      f.cast(); f.step(0.801);
      assert.equal(f.state.phase, PHASE.LURE);
      assert.deepEqual(getLurePosition(f.state), preview);
    }
  }
});

test('all levels stop at intervening land and reject casts too close to shore', () => {
  for (let level = 1; level <= 5; level++) {
    for (const limit of [1, 5, 12.13, 35.13]) {
      const f = fishing(level, undefined, undefined, { isWater: (x, z) => z >= -limit || z < -limit - 2 });
      f.prepare({ x: 0, z: 0 }, 0); f.aim(0, 180);
      assert.ok(f.state.distance <= limit);
      const preview = { ...f.state.target };
      f.cast();
      if (limit < 5.5) assert.equal(f.state.phase, PHASE.READY);
      else { f.step(0.801); assert.deepEqual(getLurePosition(f.state), preview); }
    }
    const isWater = (x, z) => Math.hypot(x, z) < shoreRadius(Math.atan2(z, x)) - 2;
    for (let angle = 0; angle < Math.PI * 2; angle += 0.2) {
      const radius = shoreRadius(angle) - 10;
      const f = fishing(level, undefined, undefined, { isWater });
      f.prepare({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius }, angle);
      f.aim(90, 180);
      assert.ok(isWater(f.state.target.x, f.state.target.z));
      for (let d = 0.25; d <= f.state.distance; d += 0.25) {
        assert.ok(isWater(f.state.origin.x + Math.sin(f.state.heading) * d, f.state.origin.z - Math.cos(f.state.heading) * d));
      }
    }
  }
});

test('legacy collections without equipment match Lv.1 through cast and fight', () => {
  const legacy = collectionAt(1); const { equipment, ...withoutEquipment } = legacy;
  const a = fishing(1), b = fishing(1, undefined, undefined, { collection: withoutEquipment });
  for (const f of [a, b]) { prepare(f); hook(f); f.reel(true); f.step(0.5); }
  assert.deepEqual(a.state, b.state);
});

test('every species and size combines existing resistance with rod multipliers at 30/60/144fps', () => {
  for (const species of FISH_SPECIES) for (const size of [0, 0.5, 1 - Number.EPSILON]) {
    for (const [level, multiplier] of [[1, 1], [2, 0.96], [3, 0.92], [4, 0.88], [5, 0.84]]) {
      const tensions = [30, 60, 144].map(hz => {
        const f = fishing(level, species, size); prepare(f); hook(f); f.reel(true);
        let expected = f.settings.tensionStart, time = 0;
        for (let frame = 0; frame < hz / 2; frame++) {
          // Existing integrator samples resistance at the end of each <=1/60s step.
          const steps = hz === 30 ? 2 : 1, dt = 1 / hz / steps;
          for (let i = 0; i < steps; i++) {
            time += dt;
            expected += f.settings.tensionRise * fishResistance(species, f.state.encounter.lengthCm, time) * multiplier * dt;
          }
          f.step(1 / hz);
        }
        near(f.state.tension, expected);
        return f.state.tension;
      });
      near(tensions[0], tensions[1]);
      near(tensions[1], tensions[2], 0.0015); // endpoint integration error, not frame-dependent rates
    }
    const a = fishing(1, species, size), b = fishing(5, species, size);
    for (const f of [a, b]) { prepare(f); hook(f); f.reel(true); f.step(0.5); }
    near(b.state.tension - b.settings.tensionStart, (a.state.tension - a.settings.tensionStart) * 0.84);
  }
});

test('relief, tension bounds, slack escape and large-fish line breaks survive every rod level', () => {
  for (let level = 1; level <= 5; level++) {
    const f = fishing(level, FISH_SPECIES.find(s => s.id === 'alligator-gar'), 1 - Number.EPSILON);
    prepare(f); hook(f); f.step(0.5);
    near(f.state.tension, f.settings.tensionStart - f.settings.tensionRelief * 0.5);
    f.step(0.6); assert.equal(f.state.tension, 0);
    f.reel(true);
    for (let i = 0; i < 1000 && f.state.phase === PHASE.FIGHT; i++) f.step(1 / 60);
    assert.equal(f.state.phase, PHASE.FAILED); assert.equal(f.state.tension, 1); assert.match(f.state.message, /切れ/);
    const slack = fishing(level, undefined, undefined, { random: () => 0 });
    prepare(slack); hook(slack); slack.step(3);
    assert.equal(slack.state.phase, PHASE.FAILED); assert.match(slack.state.message, /緩み/);
  }
});

test('API upgrades during aim, flight and fight stay frozen; retry uses the latest rod', () => {
  for (const stage of ['aim', 'cast', 'fight']) {
    const f = fishing(1), baseline = fishing(1);
    for (const item of [f, baseline]) prepare(item);
    if (stage === 'cast') { f.cast(); baseline.cast(); }
    if (stage === 'fight') { hook(f); hook(baseline); }
    upgrade(f.collection, 5);
    assert.equal(f.prepare({ x: 0, z: 0 }, 0), false); // cannot refresh an active cast
    if (stage === 'aim') { f.aim(0, 180); assert.equal(f.state.distance, 32); }
    if (stage !== 'fight') { hook(f); hook(baseline); }
    for (const item of [f, baseline]) { item.reel(true); item.step(0.5); }
    assert.equal(f.state.tension, baseline.state.tension);
    assert.equal(f.state.distance, baseline.state.distance);
    while (f.state.phase === PHASE.FIGHT) f.step(1 / 60);
    assert.equal(f.state.phase, PHASE.FAILED); f.step(2);
    prepare(f); assert.equal(f.state.distance, 40); hook(f); f.reel(true); f.step(0.5);
    const upgraded = fishing(5, undefined, undefined, { random: () => 0.5 });
    prepare(upgraded); hook(upgraded); upgraded.reel(true); upgraded.step(0.5);
    near(f.state.tension, upgraded.state.tension);
  }
});

test('cancelled preparation refreshes performance and a controlled upgraded fight lands', () => {
  const f = fishing(1); prepare(f); upgrade(f.collection, 5); f.cancelInput();
  prepare(f); assert.equal(f.state.distance, 40); hook(f);
  let held = false;
  for (let i = 0; i < 1800 && f.state.phase === PHASE.FIGHT; i++) {
    if (f.state.tension < 0.4) held = true;
    if (f.state.tension > 0.78) held = false;
    f.reel(held); f.step(1 / 60);
  }
  assert.equal(f.state.phase, PHASE.LANDING); f.step(2);
  assert.equal(f.state.phase, PHASE.RESULT); f.closeResult(); prepare(f);
  assert.equal(f.state.distance, 40);
});


test('rod distance changes neither boat spot bonus nor bite timing for any lure', () => {
  for (const lure of LURES) for (const origin of [{ x: 0, z: 30 }, ...FISHING_SPOTS]) {
    const results = [1, 5].map(level => {
      const f = fishing(level, undefined, undefined, { random: () => 0.5 });
      f.selectLure(lure.id); f.prepare(origin, 0); f.aim(0, 180); f.cast(); f.step(0.801);
      let frames = 0;
      while (f.state.phase === PHASE.LURE && frames < 10000) { f.step(1 / 60); frames++; }
      assert.equal(f.state.phase, PHASE.BITE);
      return { frames, encounter: f.state.encounter };
    });
    assert.deepEqual(results[0], results[1]);
  }
});
