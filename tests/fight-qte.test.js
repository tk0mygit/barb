import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FISH_SPECIES, getFishSpecies } from '../src/game/fish-species.js';
import { createFightProfile } from '../src/game/fish-fight.js';
import { getQteDifficulty, qteSeconds, getFightScale, applyQteEffect, FightQteSchedule } from '../src/game/fight-qte.js';

const reference = JSON.parse(readFileSync(new URL('./fixtures/fight-difficulty.json', import.meta.url)));
test('all 5792 legal lengths match independent rational count/deadline ranges', () => {
  let checked = 0;
  for (const expected of reference.species) {
    const species = getFishSpecies(expected.id);
    assert.equal(species.minLengthCm, expected.minLengthCm); assert.equal(species.maxLengthCm, expected.maxLengthCm);
    assert.equal(species.fight.baseResistance, expected.baseResistance);
    for (const range of expected.ranges) for (let length = range.firstDeciCm; length <= range.lastDeciCm; length++) {
      const d = getQteDifficulty(species, length / 10);
      assert.equal(d.count, range.count); assert.equal(d.seconds, range.seconds);
      for (const kind of ['flick', 'swipe', 'target']) assert.equal(qteSeconds(d, kind), range.seconds);
      assert.equal(qteSeconds(d, 'tap'), 2);
      assert.deepEqual(d.thresholds, d.count === 1 ? [.4] : d.count === 2 ? [.3, .7] : [.2, .5, .8]);
      assert.ok(Object.isFrozen(d)); checked++;
    }
  }
  assert.equal(checked, reference.total);
});
test('exact 0.90 / 0.95 / 1.25 / 1.30 boundaries use rational comparisons, never displayed rounding', () => {
  for (const [id, length, n, count, seconds] of [
    ['bluegill', 28, '9', 1, 1], ['rainbow-trout', 20, '9', 1, 1],
    ['smallmouth-bass', 20, '19', 2, 1], ['walleye', 30, '19', 2, 1],
    ['rainbow-trout', 65, '5', 2, .5], ['northern-pike', 60, '5', 2, .5],
    ['smallmouth-bass', 50, '13', 3, .5], ['northern-pike', 70, '13', 3, .5], ['walleye', 80, '13', 3, .5],
  ]) { const d = getQteDifficulty(getFishSpecies(id), length); assert.equal(d.numerator, n); assert.equal(d.count, count); assert.equal(d.seconds, seconds); }
  const s = getFishSpecies('smallmouth-bass');
  assert.equal(s.fight.baseResistance + .35, 1.2999999999999998);
  assert.equal(getQteDifficulty(s, 49.9).count, 2); assert.equal(getQteDifficulty(s, 50).count, 3);
  assert.throws(() => getQteDifficulty(s, 50.1), RangeError);
  assert.throws(() => getQteDifficulty(s, 20.01), RangeError);
});
test('profiles are deterministic immutable metadata for every species and size', () => {
  for (const species of FISH_SPECIES) for (const length of [species.minLengthCm, (species.minLengthCm + species.maxLengthCm) / 2, species.maxLengthCm]) {
    const before = JSON.stringify(species), p = createFightProfile(species, length);
    assert.deepEqual(p, createFightProfile(species, length)); assert.ok(Object.isFrozen(p));
    assert.ok(Math.abs(p.surge + p.endurance + p.sway - 1) < 1e-12);
    assert.ok([p.surge, p.endurance, p.sway].every(x => x >= 0 && x <= 1));
    assert.equal(JSON.stringify(species), before);
  }
});
test('reservations latch across pushback, enforce .8 normal seconds and never duplicate', () => {
  for (const [id, length, count] of [['bluegill', 10, 1], ['black-bass', 40, 2], ['alligator-gar', 180, 3]]) {
    const d = getQteDifficulty(getFishSpecies(id), length), q = new FightQteSchedule(d, 4.5001, 4.5, true);
    assert.equal(q.entries.length, count); q.observe(4.5); q.observe(4.6);
    let t = 0;
    for (let i = 0; i < count; i++) { assert.equal(q.start(t).index, i); assert.equal(q.start(t), null); assert.equal(q.resolve(t), true); if (i + 1 < count) { assert.equal(q.start(t + .799999), null); t += .8; } }
    assert.equal(q.complete, true); assert.equal(q.start(100), null);
    const aborted = new FightQteSchedule(d, 8, 4.5, true); aborted.observe(4.5); aborted.abort(); assert.ok(aborted.entries.every(e => e.status === 'cancelled'));
    const off = new FightQteSchedule(d, 8, 4.5, false); off.observe(4.5); assert.equal(off.start(10), null); assert.equal(off.complete, true);
  }
});
test('scaled penalties and success limits preserve phase and bound every required distance', () => {
  for (const start of [4.5001, 4.51, 5.5, 8, 16, 32, 40, 60]) {
    const scale = getFightScale(start);
    assert.equal(scale, Math.max(0, Math.min(1, (start - 4.5) / 27.5)));
    for (const n of [1, 2, 3]) {
      const state = { phase: 'fight', distance: start, tension: .42 };
      applyQteEffect(state, false, n, start, scale);
      assert.equal(state.phase, 'fight'); assert.equal(state.distance, Math.min(start + 4, start + .5 * n * scale));
      assert.equal(state.tension, .42 + .06 * n);
      state.distance = start + 4; state.tension = .999;
      applyQteEffect(state, false, n, start, scale); assert.equal(state.tension, .98); assert.equal(state.distance, start + 4);
      applyQteEffect(state, true, n, start, scale);
      assert.equal(state.distance, Math.max(4.5, start + 4 - Math.min(1.2, start * .08)));
      assert.equal(state.tension, .88);
    }
    const state = { distance: 4.50001, tension: .42 }; applyQteEffect(state, true, 0, start, scale);
    assert.equal(state.distance, 4.5); assert.equal(state.tension, .45);
  }
});
