import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscoveryCoordinator } from '../src/ui/discovery-coordinator.js';
import { createCatchCollection } from '../src/game/catch-collection.js';
import { createFishing, PHASE } from '../src/game/fishing.js';
import { createAchievements } from '../src/game/achievements.js';
import { FISH_SPECIES, calculateFishWeightKg } from '../src/game/fish-species.js';
import { encounterModel, getRodEncounterModifiers } from '../src/game/encounter-production.js';

const record = (id, species = FISH_SPECIES[0]) => ({ schemaVersion: 1, id, speciesId: species.id,
  lengthCm: species.minLengthCm, weightKg: calculateFishWeightKg(species.id, species.minLengthCm),
  caughtAt: '2026-11-08T00:00:00.000Z' });
function fixture(collection = createCatchCollection()) {
  const draws = [], jobs = [], events = [], displayed = [], notified = [];
  const fishing = createFishing({ collection, random: () => draws.shift() ?? .5, now: () => 1000 });
  const achievements = createAchievements({ collection, now: () => 1000 });
  let end, paused = false;
  const achievementNotice = {
    setPaused(value) { paused = value; events.push(['pause', value]); },
    notify(awards) { notified.push(...awards); events.push(['awards', paused, awards.map(award => award.id)]); },
  };
  const discoveryNotice = {
    show(caught, done) { displayed.push(caught); end = done; events.push(['discovery', caught.id]); return true; },
    cancel() { const done = end; end = null; done?.(); },
    dispose() { this.cancel(); },
  };
  const coordinator = createDiscoveryCoordinator({ collection, fishing, achievements,
    achievementNotice, discoveryNotice, schedule: job => jobs.push(job) });
  const drain = () => { while (jobs.length) jobs.shift()(); };
  function catchFish(speciesId = 'black-bass', lengthRoll = .1) {
    assert.equal(fishing.prepare({ x: 0, z: 30 }, 0), true);
    fishing.aim(0, 0); fishing.cast();
    fishing.step(fishing.settings.flightSeconds + .01);
    assert.equal(fishing.state.phase, PHASE.LURE);
    let roll = 0;
    for (const row of encounterModel.getProbabilities(fishing.state.lureId, fishing.getConditions(), getRodEncounterModifiers(1))) {
      if (row.speciesId === speciesId) { roll += row.probability / 2; break; }
      roll += row.probability;
    }
    draws.push(roll, lengthRoll);
    for (let n = 0; n < 10000 && fishing.state.phase === PHASE.LURE; n++) fishing.step(.05);
    assert.equal(fishing.hook(), true);
    let held = false;
    for (let n = 0; n < 10000 && fishing.state.phase === PHASE.FIGHT; n++) {
      if (fishing.state.tension < .4) held = true;
      if (fishing.state.tension > .65) held = false;
      fishing.reel(held); fishing.step(.05);
    }
    assert.equal(fishing.state.phase, PHASE.LANDING);
    fishing.step(fishing.settings.landingSeconds + .01);
    assert.equal(fishing.state.phase, PHASE.RESULT);
    assert.equal(fishing.state.catch.speciesId, speciesId);
    return fishing.state.catch;
  }
  return { collection, fishing, achievements, discoveryNotice, coordinator, events, displayed, notified,
    drain, catchFish, get paused() { return paused; }, get completion() { return end; }, finish: () => end?.() };
}

test('first production registration commits immediately and beats synchronously published awards', () => {
  const f = fixture(), caught = f.catchFish('arapaima', .5);
  assert.equal(f.collection.catches.length, 1); assert.equal(f.achievements.unlockedCount, 2);
  assert.deepEqual(f.notified, []); assert.deepEqual(f.displayed, []);
  f.coordinator.showResult(caught); f.drain();
  assert.equal(f.displayed[0], caught); assert.equal(f.paused, true);
  assert.deepEqual(f.notified.map(award => award.id), ['normal-first-catch', 'normal-length-100']);
  assert.ok(f.events.findIndex(event => event[0] === 'discovery') < f.events.findIndex(event => event[0] === 'awards'));
  assert.equal(f.events.find(event => event[0] === 'awards')[1], true);
  f.finish(); f.drain(); assert.equal(f.paused, false);
  f.coordinator.showResult(caught); assert.equal(f.displayed.length, 1);
  f.coordinator.dispose();
});

test('all 0–36 restored known sets are silent; existing IDs, store, sale and invalid records are silent', () => {
  for (let count = 0; count <= FISH_SPECIES.length; count++) {
    const seed = createCatchCollection();
    for (const fish of FISH_SPECIES.slice(0, count)) seed.register(record(fish.id, fish));
    const { catches, wallet, equipment } = seed.snapshot;
    const f = fixture(createCatchCollection({ initialData: { catches, wallet, equipment } }));
    f.drain(); assert.deepEqual(f.displayed, []); assert.deepEqual(f.notified, []);
    for (const captured of f.collection.catches) {
      f.collection.register(captured); f.collection.store(captured.id); f.collection.sellStored([captured.id]);
    }
    assert.throws(() => f.collection.register({ ...record('invalid'), speciesId: 'unknown' }));
    f.drain(); assert.deepEqual(f.displayed, []);
    f.coordinator.dispose();
  }
});

test('known recapture has awards only; second individual and a stale result cannot rediscover', () => {
  const f = fixture(), first = f.catchFish();
  f.coordinator.showResult(first); f.drain(); f.coordinator.closeResult();
  assert.equal(f.fishing.closeResult(), true);
  const second = f.catchFish('black-bass', .9);
  f.coordinator.showResult(second); f.drain(); assert.equal(f.displayed.length, 1);
  f.coordinator.showResult(first); f.drain(); assert.equal(f.displayed.length, 1);
  assert.equal(f.collection.catches.length, 2); assert.equal(f.paused, false);
  f.coordinator.dispose();
});

test('early close/sale before microtask flush releases awards and preserves the committed disposition', () => {
  for (const sell of [false, true]) {
    const f = fixture(), caught = f.catchFish();
    assert.equal(f.collection.catches.length, 1);
    if (sell) assert.ok(f.fishing.sellResult()); else assert.equal(f.fishing.closeResult(), true);
    f.coordinator.closeResult(); f.drain();
    assert.equal(f.paused, false); assert.equal(f.notified.length, 1); assert.equal(f.displayed.length, 0);
    assert.equal(f.collection.catches[0].disposition, sell ? 'sold' : 'stored');
    f.coordinator.showResult(caught); assert.equal(f.displayed.length, 0);
    assert.equal(f.fishing.prepare({ x: 0, z: 30 }, 0), true);
    f.coordinator.dispose();
  }
});

test('canceled fishing and non-RESULT registration never present; subsequent distinct discoveries present once each', () => {
  const f = fixture();
  f.fishing.prepare({ x: 0, z: 30 }, 0); f.fishing.cancelInput(); f.drain();
  f.collection.register(record('external')); f.drain();
  assert.equal(f.displayed.length, 0); assert.equal(f.notified.length, 1); assert.equal(f.paused, false);
  for (const speciesId of ['bluegill', FISH_SPECIES.at(-1).id]) {
    const caught = f.catchFish(speciesId);
    f.coordinator.showResult(caught); f.drain();
    assert.equal(f.displayed.at(-1).speciesId, speciesId);
    f.coordinator.closeResult(); f.fishing.closeResult(); f.drain();
  }
  assert.equal(f.displayed.length, 2); f.coordinator.dispose();
});

test('display failure/disposal releases notifications and old completion callbacks cannot clear a newer discovery', () => {
  const f = fixture(), first = f.catchFish();
  f.coordinator.showResult(first); const oldFinish = f.completion;
  f.coordinator.closeResult(); f.fishing.closeResult();
  const next = f.catchFish('bluegill'); f.coordinator.showResult(next); f.drain();
  assert.equal(f.paused, true);
  oldFinish(); f.drain(); assert.equal(f.paused, true);
  f.coordinator.dispose(); f.drain(); assert.equal(f.paused, false);
  oldFinish(); f.drain(); assert.equal(f.paused, false);
  const failed = fixture(); failed.discoveryNotice.show = () => { throw Error('animation unavailable'); };
  failed.coordinator.showResult(failed.catchFish()); failed.drain();
  assert.equal(failed.paused, false); assert.equal(failed.notified.length, 1);
  failed.coordinator.dispose();
});
