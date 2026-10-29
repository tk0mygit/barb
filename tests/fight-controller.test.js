import test from 'node:test';
import assert from 'node:assert/strict';
import { FISH_SPECIES } from '../src/game/fish-species.js';
import { FISHING_CONFIG } from '../src/game/fishing-config.js';
import { getEquipmentLevel } from '../src/game/equipment.js';
import { createFightController } from '../src/game/fight-controller.js';
import { createFishing, PHASE } from '../src/game/fishing.js';
import { hookedFight, replayFight } from './helpers/fight-replay.js';
import { createFishingInput } from '../src/input/fishing.js';
import { fishResistance } from '../src/game/fish-fight.js';
import { stoppedDistance } from './helpers/fight-pushback.js';
const near = (a, b, epsilon = 1e-10) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

test('5C-1R uses four times the historical stopped speed with the original scale and 60Hz samples', () => {
  assert.equal(FISHING_CONFIG.fightPushbackSpeed, .80);
  for (const species of FISH_SPECIES) for (const lengthCm of [species.minLengthCm, (species.minLengthCm + species.maxLengthCm) / 2, species.maxLengthCm]) {
    for (const startDistance of [4.5001, 4.51, 5.5, 8, 16, 32, 40, 60]) {
      const make = speed => createFightController({ species, lengthCm, startDistance,
        rod: getEquipmentLevel('rod', 1), reel: getEquipmentLevel('reel', 1),
        settings: { ...FISHING_CONFIG, fightPushbackSpeed: speed }, random: () => .5, id: 1 });
      const current = make(FISHING_CONFIG.fightPushbackSpeed), historical = make(.20);
      current.step(1); historical.step(1);
      const actual = current.snapshot, old = historical.snapshot;
      near(actual.distance, stoppedDistance({ species, lengthCm, startDistance, seconds: 1 }), 1e-11);
      near(old.distance, stoppedDistance({ species, lengthCm, startDistance, seconds: 1, pushbackSpeed: .20 }), 1e-11);
      near(actual.pushbackMeters, 4 * old.pushbackMeters, 1e-11);
      assert.equal(actual.tension, old.tension); assert.equal(actual.rngCalls, 0);
      assert.equal(actual.normalSeconds, 1); assert.equal(actual.outcome, null);
    }
  }
});

test('public construction disables QTE while applying short-distance pushback and fixed steps', () => {
  for (const distance of [4.5001, 4.51, 5.5, 8, 16, 32, 40, 60]) {
    const { f, calls } = hookedFight({ startDistance: distance, rod: 10, reel: 10 });
    const initial = f.state.distance; f.step(1 / 144); assert.equal(f.state.distance, initial);
    f.step(1 / 60 - 1 / 144); assert.ok(f.state.distance > initial);
    const p = f.state.fight; assert.equal(p.qte.enabled, false); assert.deepEqual(p.qte.reservations, []);
    near(p.scale, Math.min(1, (initial - 4.5) / 27.5)); assert.equal(calls(), 3);
    near(p.normalSeconds, 1 / 60); assert.equal(p.mode, 'normal');
    assert.equal(f.state.inputOwner, 'normal'); assert.ok(Object.isFrozen(p.equipment.rod));
  }
});
test('warning/active/result freeze physics, apply once, arm failures only and retain reservations', () => {
  for (const success of [true, false]) {
    const { f, calls } = hookedFight({ speciesId: 'alligator-gar', size: 'max', rod: 10, reel: 10, startDistance: 4.51 },
      { qte: { enabled: true, selectOperation: () => 'tap' } });
    f.reel(true); while (f.state.fight.mode === 'normal') f.step(1 / 60);
    const before = f.state.fight, token = before.qte.token, oldGeneration = before.generation;
    assert.equal(before.mode, 'warning'); assert.equal(before.qte.operation, 'tap');
    f.step(.3); const frozen = f.state.fight;
    for (const key of ['normalSeconds', 'distance', 'tension', 'slackSeconds', 'rngCalls']) assert.equal(frozen[key], before[key]);
    assert.equal(f.state.inputOwner, 'qte'); assert.equal(f.fightContact('down', frozen.elapsedSeconds, oldGeneration), false);
    assert.equal(f.submitQteResult(token, success, before.qte.deadlineSeconds), true);
    while (f.state.fight.qte.successes + f.state.fight.qte.failures === 0) f.step(1 / 60);
    const result = f.state.fight;
    assert.equal(f.submitQteResult(token, success), false); assert.equal(result.qte.successes + result.qte.failures, 1);
    assert.equal(calls(), 3); assert.equal(result.normalSeconds, before.normalSeconds);
    assert.equal(result.mode, success ? 'normal' : 'arm');
    assert.notEqual(result.generation, oldGeneration); assert.equal(f.state.phase, PHASE.FIGHT);
    if (!success) {
      const t = result.tension, d = result.distance; f.step(.1);
      assert.equal(f.state.tension, t); assert.equal(f.state.distance, d); assert.equal(f.state.fight.normalSeconds, result.normalSeconds);
      f.step(.2); assert.equal(f.state.fight.mode, 'normal'); near(f.state.fight.armSeconds, .22);
    }
  }
});
test('lifecycle pause retains reservation/deadline; invalidates old tokens without losing a fish', () => {
  const { f } = hookedFight({ speciesId: 'smallmouth-bass', size: 'max', rod: 10, reel: 10, startDistance: 8 },
    { qte: { enabled: true, selectOperation: () => 'flick' } });
  f.reel(true); while (f.state.fight.mode === 'normal') f.step(1 / 60); f.step(.7);
  const before = f.state.fight, token = before.qte.token;
  assert.equal(f.pauseFight(), true); const paused = f.state.fight; f.step(100);
  assert.deepEqual(f.state.fight, paused); assert.equal(f.state.phase, PHASE.FIGHT); assert.equal(f.state.catches.length, 0);
  assert.equal(f.submitQteResult(token, false), false); assert.equal(f.resumeFight(), true);
  const resumed = f.state.fight; assert.equal(resumed.qte.remainingSeconds, before.qte.remainingSeconds);
  assert.equal(resumed.qte.deadlineSeconds, before.qte.deadlineSeconds); assert.equal(resumed.qte.token.index, token.index);
  assert.notEqual(resumed.qte.token.generation, token.generation); assert.equal(f.submitQteResult(token, false), false);
  // A pointer cancellation discards its generation, not the fish or time budget.
  f.cancelInput(); assert.equal(f.state.fight.qte.remainingSeconds, resumed.qte.remainingSeconds);
  assert.equal(f.state.fight.qte.failures, 0); assert.equal(f.state.phase, PHASE.FIGHT);
  assert.equal(f.abortFight(), true); assert.equal(f.state.phase, PHASE.READY); assert.equal(f.state.catches.length, 0);
});
test('fixed grid, cap, normal slack escape and line-break precedence remain active', () => {
  const make = random => createFightController({ species: FISH_SPECIES[0], lengthCm: 40, startDistance: 60,
    rod: getEquipmentLevel('rod', 1), reel: getEquipmentLevel('reel', 1), settings: FISHING_CONFIG, random, id: 1 });
  const cap = make(() => 1 - Number.EPSILON); cap.step(30); assert.equal(cap.snapshot.distance, 64); assert.equal(cap.snapshot.outcome, null);
  const idle = make(() => 0); idle.step(5); assert.equal(idle.snapshot.outcome, 'slack-escape'); assert.equal(idle.snapshot.rngCalls, 1);
  const held = make(() => 0); held.reel(true); held.step(30); assert.equal(held.snapshot.outcome, 'line-break'); assert.equal(held.snapshot.tension, 1);
  assert.equal(held.snapshot.qte.reservations.length, 0);
});
test('same external input list agrees at 30/60/144fps and irregular dt, including hold/up tie', () => {
  for (const up of [.219999, .22, .220001, 1]) {
    const events = [{ type: 'down', at: 0 }, { type: 'up', at: up }, { type: 'down', at: 1.2 }];
    const outcomes = [30, 60, 144].map(fps => replayFight({ rod: 5, reel: 10, fps }, { providedEvents: events }));
    const irregular = replayFight({ rod: 5, reel: 10 }, { providedEvents: events, renderDts: [.001, .032, .075, .25, .004] });
    for (const r of [...outcomes.slice(1), irregular]) { assert.equal(r.outcome, outcomes[0].outcome); near(r.fight.elapsedSeconds, outcomes[0].fight.elapsedSeconds); near(r.fight.tension, outcomes[0].fight.tension); near(r.fight.distance, outcomes[0].fight.distance); }
  }
});

test('hold has no retrospective reel interval; exact up tie wins over hold', () => {
  for (const up of [.219999, .22, .220001]) {
    const c = createFightController({ species: FISH_SPECIES[0], lengthCm: 40, startDistance: 32,
      rod: getEquipmentLevel('rod', 1), reel: getEquipmentLevel('reel', 1), settings: FISHING_CONFIG, random: () => 0, id: 1 });
    c.queueContact('down', 0, 1); c.queueContact('up', up, 1); c.step(.25);
    const idleTension = .42 - .42 * .25;
    if (up <= .22) near(c.snapshot.tension, idleTension);
    else near(c.snapshot.tension, idleTension + (.42 + .24 * fishResistance(FISH_SPECIES[0], 40, up)) * (up - .22));
  }
});
test('lifecycle drops pending old down/up and cannot reuse old contact on resume', () => {
  const { f } = hookedFight(), input = createFishingInput(f);
  input.down(0, 0, 1000); // admitted to adapter but not to a physical tick yet
  f.pauseFight(); f.step(50); f.resumeFight();
  input.step(.3, 53000); f.step(.3); assert.equal(f.state.reeling, false);
  input.down(0, 0, 53000); input.step(.3, 53300); f.step(.3); assert.equal(f.state.reeling, true);
  // A delayed release from before this down must not release the fresh hold.
  input.up(52999); input.step(1 / 60, 53300 + 1000 / 60); f.step(1 / 60);
  assert.equal(f.state.reeling, true);
  input.cancel(); input.step(.03, 53350); f.step(.03); assert.equal(f.state.reeling, false);
});
test('timestamped cancellation preserves earlier intervals and ignores stale up at every fps', () => {
  const events = [{ type: 'down', at: 0 }, { type: 'cancel', at: .231 }, { type: 'down', at: .4 },
    { type: 'up', at: .5 }, { type: 'down', at: .7 }];
  const outputs = [30, 60, 144].map(fps => replayFight({ rod: 5, reel: 10, fps }, { providedEvents: events }));
  for (const r of outputs.slice(1)) {
    assert.equal(r.outcome, outputs[0].outcome); near(r.fight.elapsedSeconds, outputs[0].fight.elapsedSeconds);
    near(r.fight.tension, outputs[0].fight.tension); near(r.fight.distance, outputs[0].fight.distance);
  }
});

test('the third QTE starts when the remaining normal gap is below one wall-clock ulp', () => {
  for (const fps of [30, 60, 144]) {
    let fight, held = false, poll = 0;
    const warnings = [], resolutions = [];
    fight = createFightController({ species: FISH_SPECIES.find(s => s.id === 'smallmouth-bass'), lengthCm: 50,
      startDistance: 8, rod: getEquipmentLevel('rod', 1), reel: getEquipmentLevel('reel', 10),
      settings: FISHING_CONFIG, random: () => .5, id: 1,
      qte: { enabled: true, selectOperation: () => 'tap' },
      onEvent(event) {
        if (event.type === 'qte-warning') {
          warnings.push(event.fight);
          fight.submitResult(event.fight.qte.token, true, event.fight.qte.deadlineSeconds);
        }
        if (event.type === 'qte-resolved') {
          resolutions.push(event.fight); held = false; poll = event.fight.normalSeconds;
        }
      } });
    while (!fight.snapshot.outcome && fight.snapshot.renderSeconds < 180) {
      const s = fight.snapshot;
      if (s.owner === 'normal' && s.normalSeconds >= poll) {
        poll += .1;
        if (held && s.tension > .65) { fight.contact('up', s.renderSeconds); held = false; }
        if (!held && s.tension < .35) { fight.contact('down', s.renderSeconds); held = true; }
      }
      fight.step(1 / fps);
    }
    assert.equal(fight.snapshot.outcome, 'landed');
    assert.equal(warnings.length, 3); assert.equal(resolutions.length, 3);
    assert.equal(fight.snapshot.qte.successes, 3);
    assert.ok(fight.snapshot.qte.reservations.every(entry => entry.status === 'done'));
    for (let i = 1; i < warnings.length; i++) {
      assert.ok(warnings[i].normalSeconds >= resolutions[i - 1].normalSeconds + .8);
    }
  }
});

test('the existing action timer decays through FIGHT and retains its value during pause', () => {
  const rolls = [0, 0, .5], f = createFishing({ random: () => rolls.length ? rolls.shift() : .5 });
  assert.equal(f.prepare({ x: 0, z: 30 }, 0), true); f.aim(0, 180); f.cast();
  f.step(.81); f.step(2.8); assert.equal(f.state.phase, PHASE.LURE);
  f.flick(); f.step(.3); assert.equal(f.state.phase, PHASE.BITE);
  assert.equal(f.hook(), true); const before = f.state.action;
  assert.ok(before > .3); f.step(.3); near(f.state.action, before - .3);
  const paused = f.state.action;
  assert.equal(f.pauseFight(), true); f.step(100); assert.equal(f.state.action, paused);
  assert.equal(f.resumeFight(), true); f.step(.15); near(f.state.action, paused - .15);
  f.step(.6); assert.equal(f.state.action, 0);
});
