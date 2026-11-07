import test from 'node:test';
import assert from 'node:assert/strict';
import { FISH_SPECIES } from '../src/game/fish-species.js';
import { LURES } from '../src/game/lures.js';
import { PHASE } from '../src/game/fishing.js';
import { createFishingInput } from '../src/input/fishing.js';
import { getQteDifficulty, qteSeconds } from '../src/game/fight-qte.js';
import { hookedFight } from './helpers/fight-replay.js';

const rare = FISH_SPECIES.slice(30);

// Reach BITE/HOOK through the production encounter interval. Unit-level QTE
// submissions exercise the public domain contract; browser tests separately
// exercise native gestures. No fight/catch/tension state is written.
function fight(condition, { successes = 3, operation = 'tap', fps = 60, idleSeconds = 0, nonstop = false } = {}) {
  let f, input, held = false, index = 0, wall = 0, nextObserve = 0;
  const events = [];
  ({ f } = hookedFight(condition, { qte: { enabled: true, selectOperation: () => operation }, onFightEvent(event) {
    events.push(event);
    if (event.type === 'qte-warning') {
      input.up(); held = false;
      assert.equal(f.submitQteResult(event.fight.qte.token, index++ < successes, event.fight.qte.deadlineSeconds), true);
    }
  } }));
  input = createFishingInput(f);
  let reversed = false, stalled = false, lastDistance = f.state.distance;
  while (f.state.phase === PHASE.FIGHT && wall < idleSeconds + 90) {
    if (f.state.inputOwner === 'normal' && f.state.fight.normalSeconds >= nextObserve) {
      nextObserve += .1;
      if (wall >= idleSeconds) {
        if (!held && (nonstop || f.state.tension < .35)) { input.down(0, 0); held = true; }
        else if (held && !nonstop && f.state.tension > .65) { input.up(); held = false; }
      }
    }
    input.step(1 / fps); f.step(1 / fps); wall += 1 / fps;
    reversed ||= f.state.distance > lastDistance + 1e-9;
    stalled ||= f.state.inputOwner === 'normal' && Math.abs(f.state.distance - lastDistance) < 1e-12;
    lastDistance = f.state.distance;
  }
  input.cancel();
  return { f, events, index, reversed, stalled, wall };
}

test('six Rare profiles reserve three QTEs from minimum size, with unchanged .5s non-tap and 2s tap windows', () => {
  assert.equal(rare.length, 6);
  for (const fish of rare) for (const length of [fish.minLengthCm, fish.weight.referenceLengthCm, fish.maxLengthCm]) {
    const difficulty = getQteDifficulty(fish, length);
    assert.equal(difficulty.count, 3);
    for (const operation of ['flick', 'swipe', 'target']) assert.equal(qteSeconds(difficulty, operation), .5);
    assert.equal(qteSeconds(difficulty, 'tap'), 2);
  }
});

test('Rare6 min/mid/max: Lv1/5/10, QTE0/1/2/3, tap/flick and 30/144fps land and preserve actual results', t => {
  const ranges = {};
  let cases = 0;
  for (const fish of rare) for (const size of ['min', 'mid', 'max']) for (const successes of [0, 1, 2, 3])
    for (const operation of ['tap', 'flick']) for (const fps of [30, 144]) {
      const durations = [];
      for (const level of [1, 5, 10]) {
        const { f, index } = fight({ speciesId: fish.id, size, rod: level, reel: level }, { successes, operation, fps });
        assert.equal(f.state.phase, PHASE.LANDING, `${fish.id}/${size}/Lv${level}/${successes}/${operation}/${fps}`);
        assert.equal(index, 3); assert.equal(f.state.fight.qte.successes, successes);
        assert.equal(f.state.fight.qte.failures, 3 - successes);
        assert.ok(f.state.fight.elapsedSeconds < 60, 'measured evaluation bound, never a game timer');
        durations.push(f.state.fight.elapsedSeconds);
        const key = `${fish.id}/Lv${level}`, range = ranges[key] ??= { min: Infinity, max: 0 };
        range.min = Math.min(range.min, f.state.fight.elapsedSeconds); range.max = Math.max(range.max, f.state.fight.elapsedSeconds);
        f.step(2); assert.equal(f.state.phase, PHASE.RESULT);
        assert.equal(f.state.catch.speciesId, fish.id); assert.equal(f.state.catch.qteSuccessCount, successes);
        assert.equal(f.closeResult(), true); assert.equal(f.state.phase, PHASE.READY);
        assert.equal(f.state.catches[0].disposition, 'stored'); cases++;
      }
      assert.ok(durations[1] < durations[0] && durations[2] < durations[1], 'equipment improves the same profile/input strategy');
    }
  assert.equal(cases, 864);
  t.diagnostic(JSON.stringify({ cases, startDistance: 32, feedback: '100ms / tension .35–.65', ranges }));
});

test('new eight fish land through every lure at min/mid/max and 30/144fps with initial equipment', () => {
  for (const fish of FISH_SPECIES.slice(28)) for (const lure of LURES) for (const size of ['min', 'mid', 'max']) for (const fps of [30, 144]) {
    const { f } = fight({ speciesId: fish.id, lureId: lure.id, size }, { fps });
    assert.equal(f.state.phase, PHASE.LANDING, `${fish.id}/${lure.id}/${size}/${fps}`);
    f.step(2); assert.equal(f.state.catch.speciesId, fish.id);
    assert.equal(f.state.lureId, lure.id);
  }
});

test('Rare6 allow reversal/stall and recovery; sustained slack escapes, nonstop overload breaks the line and retry stays available', () => {
  for (const fish of rare) {
    const recovered = fight({ speciesId: fish.id, size: 'max' }, { successes: 0, idleSeconds: .25 });
    assert.equal(recovered.f.state.phase, PHASE.LANDING, fish.id);
    assert.ok(recovered.reversed && recovered.stalled); assert.equal(recovered.f.state.fight.qte.failures, 3);
    const slack = fight({ speciesId: fish.id, size: 'max' }, { idleSeconds: 61 });
    assert.equal(slack.f.state.phase, PHASE.FAILED); assert.equal(slack.f.state.fight.outcome, 'slack-escape');
    assert.equal(slack.f.state.catches.length, 0);
    const broken = fight({ speciesId: fish.id, size: 'max' }, { successes: 0, nonstop: true });
    assert.equal(broken.f.state.phase, PHASE.FAILED); assert.equal(broken.f.state.fight.outcome, 'line-break');
    assert.equal(broken.f.state.catches.length, 0); broken.f.step(2);
    assert.equal(broken.f.state.phase, PHASE.READY);
    assert.equal(broken.f.prepare({ x: 0, z: 30 }, 0), true); broken.f.aim(0, 180);
    broken.f.cast(); assert.equal(broken.f.state.phase, PHASE.CAST);
  }
});
