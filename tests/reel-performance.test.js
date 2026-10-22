import test from 'node:test';
import assert from 'node:assert/strict';
import { createFishing, PHASE } from '../src/game/fishing.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { getEquipmentLevel } from '../src/game/equipment.js';
import { FISH_SPECIES } from '../src/game/fish-species.js';
import { fishResistance } from '../src/game/fish-fight.js';
import { getSpeciesProbabilities } from '../src/game/fish-encounters.js';
import { createFishingInput } from '../src/input/fishing.js';
import { LURES } from '../src/game/lures.js';
import { FISHING_SPOTS } from '../src/world/fishing-spots.js';

const near = (a, b, epsilon = 1e-11) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const levels = [[1, 1, 1], [2, 1.06, 1.04], [3, 1.12, 1.08], [4, 1.18, 1.12], [5, 1.24, 1.16]];
function upgrade(c, kind, target) {
  while (c.equipment[`${kind}Level`] < target) assert.ok(c.purchaseUpgrade(kind, c.equipment[`${kind}Level`]));
}
function collectionAt(rod, reel) {
  const c = createCatchCollection({ now: () => 1700000000000 });
  c.register({ schemaVersion: 1, id: 'fund', speciesId: 'black-bass', lengthCm: 50, weightKg: 1000, caughtAt: '2026-01-01T00:00:00Z' });
  c.sellUnassigned('fund');
  upgrade(c, 'rod', rod); upgrade(c, 'reel', reel);
  return c;
}
function fishing(rod = 1, reel = 1, species = FISH_SPECIES[0], size = 0.5, options = {}) {
  let cumulative = 0, roll;
  for (const entry of getSpeciesProbabilities('minnow')) {
    if (entry.speciesId === species.id) roll = cumulative + entry.probability / 2;
    cumulative += entry.probability;
  }
  const rolls = [0, roll, size];
  return createFishing({ collection: collectionAt(rod, reel), random: () => rolls.shift() ?? 0,
    now: () => 1700000000000, ...options });
}
function prepare(f) { assert.equal(f.prepare({ x: 0, z: 30 }, 0), true); f.aim(0, 180); }
function lure(f) { f.cast(); f.step(0.801); assert.equal(f.state.phase, PHASE.LURE); }
function hook(f) {
  if (f.state.phase === PHASE.AIM) lure(f);
  for (let i = 0; i < 10000 && f.state.phase !== PHASE.BITE; i++) f.step(1 / 60);
  assert.equal(f.hook(), true);
}

for (const [level, speed, relief] of levels) {
  test(`reel Lv.${level}: exact data, LURE speed, relief and stopped distance at 30/60/144fps`, () => {
    assert.equal(getEquipmentLevel('reel', level).reelSpeedMultiplier, speed);
    assert.equal(getEquipmentLevel('reel', level).tensionReliefMultiplier, relief);
    for (const hz of [30, 60, 144]) {
      const f = fishing(1, level); prepare(f); lure(f);
      const start = f.state.distance;
      f.step(0.5); assert.equal(f.state.distance, start);
      f.reel(true);
      for (let i = 0; i < hz; i++) f.step(1 / hz);
      near(start - f.state.distance, 0.65 * speed);
      hook(f);
      const distance = f.state.distance;
      for (let i = 0; i < hz / 2; i++) f.step(1 / hz);
      near(f.state.tension, 0.42 - 0.42 * relief * 0.5);
      assert.equal(f.state.distance, distance);
      f.step(0.6); assert.equal(f.state.tension, 0);
      assert.equal(f.state.distance, distance);
    }
  });

  test(`reel Lv.${level}: all 12 species/sizes retain resistance and rod effects at 30/60/144fps`, () => {
    for (const rod of [1, 5]) for (const species of FISH_SPECIES) for (const size of [0, 0.5, 1 - Number.EPSILON]) {
      const distances = [30, 60, 144].map(hz => {
        const f = fishing(rod, level, species, size); prepare(f); hook(f);
        const start = f.state.distance, span = start - f.settings.landingDistance;
        let distance = start, tension = 0.42, time = 0;
        f.reel(true);
        for (let frame = 0; frame < hz / 2; frame++) {
          const steps = hz === 30 ? 2 : 1, dt = 1 / hz / steps;
          for (let i = 0; i < steps; i++) {
            time += dt;
            const resistance = fishResistance(species, f.state.encounter.lengthCm, time);
            distance -= span / (6.5 * Math.max(0.8, Math.min(1.25, resistance))) * speed * dt;
            tension += 0.24 * resistance * (rod === 5 ? 0.84 : 1) * dt;
          }
          f.step(1 / hz);
        }
        assert.equal(f.state.phase, PHASE.FIGHT);
        near(f.state.distance, distance); near(f.state.tension, tension);
        return distance;
      });
      near(distances[0], distances[1]); near(distances[1], distances[2], 0.01);
    }
  });
}

test('all reel levels retain large-fish line breaks and slack escape with both rods', () => {
  for (const rod of [1, 5]) for (const [reel] of levels) {
    for (const held of [true, false]) {
      const f = fishing(rod, reel, FISH_SPECIES.find(s => s.id === 'alligator-gar'), 1 - Number.EPSILON);
      prepare(f); hook(f); f.reel(held);
      for (let i = 0; i < 1800 && f.state.phase === PHASE.FIGHT; i++) f.step(1 / 60);
      assert.equal(f.state.phase, PHASE.FAILED);
      assert.equal(f.state.tension, held ? 1 : 0);
      assert.match(f.state.message, held ? /切れ/ : /緩み/);
    }
  }
});

test('purchase at each active stage freezes both rows; failed prepare cannot refresh; next cast does', () => {
  for (const stage of ['aim', 'cast', 'lure', 'bite', 'fight']) for (const kinds of [['rod'], ['reel'], ['rod', 'reel']]) {
    const a = fishing(), b = fishing();
    for (const f of [a, b]) {
      prepare(f);
      if (stage === 'cast') f.cast();
      if (['lure', 'bite', 'fight'].includes(stage)) lure(f);
      if (['bite', 'fight'].includes(stage)) {
        while (f.state.phase === PHASE.LURE) f.step(1 / 60);
        if (stage === 'fight') assert.equal(f.hook(), true);
      }
    }
    const history = a.collection.catches, sales = a.collection.wallet.lifetimeSales;
    for (const kind of kinds) upgrade(a.collection, kind, 5);
    assert.equal(a.collection.catches, history);
    assert.equal(a.collection.wallet.lifetimeSales, sales);
    assert.equal(a.prepare({ x: 0, z: 0 }, 0), false);
    for (const f of [a, b]) {
      if (f.state.phase === PHASE.AIM) f.aim(0, 180);
      if (f.state.phase !== PHASE.FIGHT) hook(f);
      f.reel(true); f.step(0.5); f.reel(false); f.step(0.25);
    }
    near(a.state.distance, b.state.distance); near(a.state.tension, b.state.tension);
    // Force a natural slack failure, then prepare again with upgraded rows.
    while (a.state.phase === PHASE.FIGHT) a.step(1 / 60);
    assert.equal(a.state.phase, PHASE.FAILED); a.step(2); prepare(a);
    const c = fishing(kinds.includes('rod') ? 5 : 1, kinds.includes('reel') ? 5 : 1, FISH_SPECIES[0], 0,
      { random: () => 0 });
    prepare(c);
    assert.equal(a.state.distance, c.state.distance);
    for (const f of [a, c]) { lure(f); f.reel(true); f.step(0.5); hook(f); f.reel(true); f.step(0.5); f.reel(false); f.step(0.25); }
    near(a.state.distance, c.state.distance); near(a.state.tension, c.state.tension);
  }
});

test('cancelled prepare refreshes reel; full lure retrieval clamps and returns READY without a catch', () => {
  const f = fishing(1, 1, undefined, undefined, { random: () => 1 - Number.EPSILON });
  prepare(f); upgrade(f.collection, 'reel', 5); f.cancelInput(); prepare(f); lure(f);
  const start = f.state.distance; f.reel(true); f.step(1);
  near(start - f.state.distance, 0.806);
  f.step(40);
  assert.equal(f.state.phase, PHASE.READY); assert.equal(f.state.distance, f.settings.landingDistance);
  assert.match(f.state.message, /回収/); assert.equal(f.state.catches.length, 1);
});

test('legacy collection is exactly Lv.1 through lure, fight, landing, result and storage', () => {
  const c = collectionAt(1, 1);
  const legacy = { get catches() { return c.catches; }, register: c.register, store: c.store };
  const a = fishing(), b = fishing(1, 1, undefined, undefined, { collection: legacy });
  for (const f of [a, b]) { prepare(f); lure(f); f.reel(true); f.step(0.5); hook(f); }
  let held = false;
  while (a.state.phase === PHASE.FIGHT) {
    if (a.state.tension < 0.4) held = true;
    if (a.state.tension > 0.78) held = false;
    for (const f of [a, b]) { f.reel(held); f.step(1 / 60); }
    assert.deepEqual(a.state, b.state);
  }
  for (const f of [a, b]) { f.step(2); assert.equal(f.state.phase, PHASE.RESULT); f.closeResult(); }
  assert.deepEqual(a.state, b.state);
});

test('reel changes neither cast distance, action, bite timing nor species at all spots/lures', () => {
  for (const lureType of LURES) for (const origin of [{ x: 0, z: 30 }, ...FISHING_SPOTS]) {
    const results = [1, 5].map(reel => {
      const f = fishing(1, reel, undefined, undefined, { random: () => 0.5 });
      f.selectLure(lureType.id); f.prepare(origin, 0); f.aim(0, 180);
      assert.equal(f.state.distance, 32); lure(f); f.flick();
      let frames = 0;
      while (f.state.phase === PHASE.LURE && frames < 3000) { f.step(1 / 60); frames++; }
      assert.equal(f.state.phase, PHASE.BITE);
      return { frames, encounter: f.state.encounter, action: f.state.action };
    });
    assert.deepEqual(results[0], results[1]);
  }
});

test('all rod/reel endpoint combinations land every species/size with real hold delay at 30/60/144fps', t => {
  for (const rod of [1, 5]) for (const reel of [1, 5]) {
    const times = [];
    for (const species of FISH_SPECIES) for (const size of [0, 0.5, 1 - Number.EPSILON]) for (const hz of [30, 60, 144]) {
      const f = fishing(rod, reel, species, size); prepare(f); hook(f);
      const count = f.state.catches.length, input = createFishingInput(f);
      let held = false, elapsed = 0, observe = 0, releases = 0;
      while (f.state.phase === PHASE.FIGHT && elapsed < 25) {
        if (elapsed >= observe) {
          if (!held && f.state.tension < 0.35) { input.down(0, 0); held = true; }
          else if (held && f.state.tension > 0.65) { input.up(); held = false; releases++; }
          observe += 0.1;
        }
        input.step(1 / hz); f.step(1 / hz); elapsed += 1 / hz;
        assert.ok(f.state.tension >= 0 && f.state.tension <= 1);
        assert.ok(f.state.distance >= f.settings.landingDistance);
      }
      input.cancel();
      assert.equal(f.state.phase, PHASE.LANDING, species.id);
      assert.equal(f.state.distance, f.settings.landingDistance);
      assert.ok(elapsed > 4 && elapsed < 20, `${species.id}: ${elapsed}`);
      if (species.id === 'alligator-gar') assert.ok(releases > 0);
      assert.equal(f.state.catches.length, count);
      f.step(0.5); assert.equal(f.state.phase, PHASE.LANDING);
      f.step(1); assert.equal(f.state.phase, PHASE.RESULT);
      assert.equal(f.state.catch.speciesId, species.id);
      assert.equal(f.state.catches.length, count + 1);
      f.step(10); assert.equal(f.state.catches.length, count + 1);
      assert.equal(f.closeResult(), true); assert.equal(f.collection.stored.length, 1);
      times.push(elapsed);
    }
    t.diagnostic(`rod ${rod}/reel ${reel}: ${Math.min(...times).toFixed(2)}–${Math.max(...times).toFixed(2)}s (108 scenarios)`);
  }
});

test('continuous reeling balance: max upgrades allow only small/mid bluegill without relief', t => {
  for (const level of [1, 5]) for (const hz of [30, 60, 144]) {
    const landed = [];
    for (const species of FISH_SPECIES) for (const [sizeName, size] of [['min', 0], ['mid', 0.5], ['max', 1 - Number.EPSILON]]) {
      const f = fishing(level, level, species, size); prepare(f); hook(f); f.reel(true);
      for (let frame = 0; frame < 20 * hz && f.state.phase === PHASE.FIGHT; frame++) f.step(1 / hz);
      if (f.state.phase === PHASE.LANDING) landed.push(`${species.id}:${sizeName}`);
      else {
        assert.equal(f.state.phase, PHASE.FAILED);
        assert.match(f.state.message, /切れ/);
      }
    }
    assert.deepEqual(landed, level === 1 ? [] : ['bluegill:min', 'bluegill:mid']);
  }
  t.diagnostic('Continuous reel: Lv.1 both 0/36 catches; Lv.5 both 2/36 (min/mid bluegill), identical at 30/60/144fps');
});
