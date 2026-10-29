import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { replayFight } from './helpers/fight-replay.js';
const a = JSON.parse(readFileSync(new URL('./fixtures/fight-failure-rescues.json', import.meta.url)));
const b = JSON.parse(readFileSync(new URL('./fixtures/fight-fps-hold.json', import.meta.url)));
test('all106 original failure-rescue contexts / 212 operation fixtures have no all-failure rescue', t => {
  assert.equal(a.conditions.length, 106); let rows = 0, successes = 0;
  for (const condition of a.conditions) for (const operation of ['flick', 'tap']) {
    const none = replayFight(condition), failure = replayFight(condition, { mode: 'failure', operation }), success = replayFight(condition, { mode: 'success', operation });
    assert.equal(failure.outcome, 'line-break', JSON.stringify({ condition, operation, before: none.outcome, failure: failure.outcome }));
    assert.equal(success.outcome, 'landed', JSON.stringify({ condition, operation }));
    successes++; rows++;
    assert.ok(success.fight.qte.reservations.every(e => e.status === 'done'));
    assert.ok(failure.fight.qte.reservations.every(e => ['done', 'cancelled'].includes(e.status)));
    assert.equal(success.fight.armSeconds, 0);
  }
  assert.equal(rows, 212); assert.equal(successes, 212); t.diagnostic('636 native fights through legal LURE/BITE/HOOK; all106 preserved, all-success212 captured');
});
test('all86 original fps-split groups agree on one external timestamp list per group', t => {
  assert.equal(b.groups.length, 86);
  for (const group of b.groups) {
    assert.ok(new Set(group.results.map(r => r.outcome)).size > 1, 'retain the original negative fixture');
    const [, mode, fixture] = group.key.split('|'), operation = fixture === 'tap' ? 'tap' : 'flick';
    const condition = { speciesId: group.species, size: group.size, rod: group.rod, reel: group.reel, startDistance: group.distance };
    const source = replayFight({ ...condition, fps: 60 }, { mode, operation });
    const outputs = [30, 60, 144].map(fps => replayFight({ ...condition, fps }, { mode, operation, providedEvents: source.events }));
    for (const result of outputs.slice(1)) {
      assert.equal(result.outcome, outputs[0].outcome, JSON.stringify(group));
      assert.ok(Math.abs(result.fight.elapsedSeconds - outputs[0].fight.elapsedSeconds) < 1e-9);
      assert.ok(Math.abs(result.fight.tension - outputs[0].fight.tension) < 1e-9);
      assert.ok(Math.abs(result.fight.distance - outputs[0].fight.distance) < 1e-9);
      // A source contact at the terminal instant need not be delivered after
      // an earlier render callback has already observed the terminal state.
      // No contact while the fight was active may be omitted or changed.
      assert.deepEqual(result.events, source.events.slice(0, result.events.length));
      assert.ok(source.events.slice(result.events.length).every(e => e.at >= result.fight.elapsedSeconds - 1e-12));
    }
  }
  t.diagnostic('86 full comparison groups x30/60/144fps; actual fishing input timestamp adapter and production FIGHT');
});
