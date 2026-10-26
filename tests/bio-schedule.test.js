import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createGameClock, GAME_CLOCK_CONFIG } from '../src/game/game-clock.js';
import { createBioCyclePlan, createBioScheduler, DEFAULT_BIO_SEED, BIO_SCHEDULE_CONFIG,
  MAX_BIO_CYCLE_INDEX, MAX_BIO_ELAPSED_SECONDS, MAX_BIO_EVENTS_PER_CYCLE } from '../src/audio/bio-schedule.js';
import manifest from '../src/assets/audio/bio/manifest.json' with { type: 'json' };

const at = elapsedSeconds => createGameClock(undefined, { elapsedSeconds }).state;
const period = GAME_CLOCK_CONFIG.daySeconds + GAME_CLOCK_CONFIG.nightSeconds;
const metadata = new Map(manifest.variants.map(v => [v.id, v]));
const shape = plan => plan.events.map(e => [e.sourceId, e.scheduledSeconds - plan.cycleStartSeconds]);
const close = (actual, expected, tolerance = 1e-8) => assert(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('each cycle has the right day/night sources, bounded variable start intervals, and all three balanced variants', () => {
  const spacings = { day: new Set(), night: new Set() };
  for (const seed of [0, DEFAULT_BIO_SEED, 0xffffffff]) for (let cycle = 0; cycle < 100; cycle++) {
    const plan = createBioCyclePlan(cycle, { seed });
    assert(plan.events.length <= MAX_BIO_EVENTS_PER_CYCLE);
    for (const timeOfDay of ['day', 'night']) {
      const events = plan.events.filter(e => e.timeOfDay === timeOfDay);
      const phaseStart = cycle * period + (timeOfDay === 'day' ? 0 : GAME_CLOCK_CONFIG.daySeconds);
      const config = BIO_SCHEDULE_CONFIG[timeOfDay], counts = new Map();
      let lastStart = phaseStart, previous;
      assert(events.length >= 3);
      for (const e of events) {
        const gap = e.scheduledSeconds - lastStart;
        assert(gap >= config.minIntervalSeconds - 1e-8 && gap <= config.maxIntervalSeconds + 1e-8);
        spacings[timeOfDay].add(gap.toFixed(3));
        assert.equal(at(e.scheduledSeconds).timeOfDay, timeOfDay);
        const asset = metadata.get(e.sourceId);
        assert.equal(asset.kind, timeOfDay === 'day' ? 'bird' : 'suzumushi');
        assert.equal(e.durationSeconds, asset.durationSeconds);
        assert(e.latestStartSeconds + e.durationSeconds <= e.phaseEndSeconds);
        close(e.latestStartSeconds - e.scheduledSeconds, .25);
        if (previous) { assert.notEqual(e.sourceId, previous.sourceId); assert(e.scheduledSeconds >= previous.scheduledSeconds + previous.durationSeconds); }
        counts.set(e.sourceId, (counts.get(e.sourceId) ?? 0) + 1);
        previous = e; lastStart = e.scheduledSeconds;
      }
      assert.equal(counts.size, 3); assert(Math.max(...counts.values()) - Math.min(...counts.values()) <= 1);
      for (let i = 0; i + 2 < events.length; i += 3) assert.equal(new Set(events.slice(i, i + 3).map(e => e.sourceId)).size, 3);
    }
  }
  assert(spacings.day.size > 100); assert(spacings.night.size > 100);
});

test('180/360 boundaries reserve full source duration and late-start margin, including across cycles', () => {
  const all = Array.from({ length: 5 }, (_, i) => createBioCyclePlan(i).events).flat();
  assert.equal(new Set(all.map(e => e.eventId)).size, all.length);
  for (const e of all) {
    const edge = (e.cycleIndex * period) + (e.timeOfDay === 'day' ? 180 : 360);
    assert.equal(e.phaseEndSeconds, edge);
    assert(e.scheduledSeconds + e.durationSeconds + BIO_SCHEDULE_CONFIG.endGuardSeconds <= edge + 1e-9);
  }
  for (let i = 1; i < all.length; i++) {
    assert(all[i - 1].latestStartSeconds + all[i - 1].durationSeconds < all[i].scheduledSeconds);
    assert.notEqual(all[i].sourceId, all[i - 1].sourceId);
  }
  const scheduler = createBioScheduler();
  for (const boundary of [180, 360, 540, 720]) {
    scheduler.sync(at(boundary - .1));
    assert.equal(scheduler.update(at(boundary)), null);
    assert.equal(scheduler.update(at(boundary + .01)), null);
    assert.equal(scheduler.getPlan(at(boundary)).cycleIndex, Math.floor(boundary / period));
  }
});

test('clock rounding just before boundaries uses the existing clock cycle and phase labels', () => {
  const scheduler = createBioScheduler();
  for (const t of [180 - 2e-10, 180, 360 - 2e-10, 360, 720 - 2e-10, 720]) {
    const state = at(t), plan = scheduler.getPlan(state);
    assert.equal(plan.cycleIndex, state.cycleSeconds === 0 ? Math.round(t / period) : Math.floor(t / period));
    scheduler.sync(state); assert.equal(scheduler.update(state), null);
  }
});

test('identical seeds/time produce exact plans, with different patterns per cycle, phase and seed', () => {
  for (const seed of [0, DEFAULT_BIO_SEED, 0xffffffff]) {
    const signatures = { day: new Set(), night: new Set() };
    for (const cycle of [0, 1, 2, 100, 2 ** 32, 2 ** 32 + 1]) {
      const plan = createBioCyclePlan(cycle, { seed });
      assert.deepEqual(plan, createBioCyclePlan(cycle, { seed }));
      for (const timeOfDay of ['day', 'night']) signatures[timeOfDay].add(JSON.stringify(
        shape({ ...plan, events: plan.events.filter(e => e.timeOfDay === timeOfDay) })));
    }
    for (const set of Object.values(signatures)) assert.equal(set.size, 6, 'both phases must depend on the full cycle index');
  }
  assert.notDeepEqual(shape(createBioCyclePlan(0, { seed: 1 })), shape(createBioCyclePlan(0, { seed: 2 })));
});

function runFrames(fps, cycles = 3) {
  const clock = createGameClock(), scheduler = createBioScheduler(), events = [];
  scheduler.update(clock.state);
  for (let frame = 0; frame < period * cycles * fps; frame++) {
    clock.step(1 / fps);
    const event = scheduler.update(clock.state);
    if (event) {
      assert(clock.state.elapsedSeconds >= event.scheduledSeconds);
      assert(clock.state.elapsedSeconds <= event.latestStartSeconds);
      assert.equal(event.timeOfDay, clock.state.timeOfDay);
      events.push(event);
      assert.equal(scheduler.update(clock.state), null, 'same snapshot must not dispatch twice');
    }
  }
  return events;
}
test('30/60/144fps return the exact same events and match three complete cycle plans', () => {
  const expected = Array.from({ length: 3 }, (_, i) => createBioCyclePlan(i).events).flat();
  for (const fps of [30, 60, 144]) assert.deepEqual(runFrames(fps), expected, `${fps}fps`);
});

test('irregular normal frame steps preserve the complete event plan', () => {
  const scheduler = createBioScheduler(), clock = createGameClock(), events = [];
  const steps = [1 / 144, 1 / 30, .12, 1 / 60, .05, .25];
  scheduler.update(clock.state);
  let frame = 0;
  while (clock.state.elapsedSeconds < period * 2) {
    clock.step(Math.min(steps[frame++ % steps.length], period * 2 - clock.state.elapsedSeconds));
    const event = scheduler.update(clock.state); if (event) events.push(event);
  }
  assert.deepEqual(events, [...createBioCyclePlan(0).events, ...createBioCyclePlan(1).events]);
});

test('late dispatch within 250ms is returned once; longer gaps are discarded without backlog', () => {
  const [first, second] = createBioCyclePlan(0).events;
  const scheduler = createBioScheduler(); scheduler.sync(at(first.scheduledSeconds - .01));
  assert.deepEqual(scheduler.update(at(first.latestStartSeconds - .001)), null, 'a frame gap over 250ms is a discontinuity');
  const other = createBioScheduler(); other.sync(at(first.scheduledSeconds));
  assert.equal(other.update(at(first.scheduledSeconds + .01)), null, 'sync consumes even an exact-start event');
  scheduler.sync(at(second.scheduledSeconds - .01));
  assert.deepEqual(scheduler.update(at(second.scheduledSeconds + .2)), second);
  for (let i = 0; i < 10; i++) assert.equal(scheduler.update(at(second.scheduledSeconds + .2 + i * .001)), null);
});

test('first update at restored elapsed time arms without replaying any previous event', () => {
  const scheduler = createBioScheduler(), plan = createBioCyclePlan(0), past = plan.events[3], next = plan.events[4];
  assert.equal(scheduler.update(at(past.scheduledSeconds + .05)), null);
  scheduler.sync(at(next.scheduledSeconds - .02));
  assert.deepEqual(scheduler.update(at(next.scheduledSeconds)), next);
});

test('paused updates and resume skip missed events, including when the supplied clock advanced', () => {
  const scheduler = createBioScheduler(), [first, second] = createBioCyclePlan(0).events;
  const clock = createGameClock(undefined, { elapsedSeconds: first.scheduledSeconds - .01 });
  scheduler.sync(clock.state);
  scheduler.update(clock.state, { paused: true });
  for (let i = 0; i < 100; i++) { clock.step(10, true); assert.equal(scheduler.update(clock.state, { paused: true }), null); }
  close(clock.state.elapsedSeconds, first.scheduledSeconds - .01);
  assert.equal(scheduler.update(at(first.scheduledSeconds + .01)), null);
  assert.equal(scheduler.update(at(first.scheduledSeconds + .02)), null);
  scheduler.sync(at(second.scheduledSeconds - .01));
  assert.deepEqual(scheduler.update(at(second.scheduledSeconds)), second);
});

test('explicit resume sync drops a due event even for a small jump that cannot identify a pause', () => {
  const scheduler = createBioScheduler(), event = createBioCyclePlan(0).events[0];
  scheduler.update(at(event.scheduledSeconds - .05));
  scheduler.sync(at(event.scheduledSeconds + .05));
  assert.equal(scheduler.update(at(event.scheduledSeconds + .06)), null);
});

test('large jumps generate only the destination plan and never return old phase/cycle events', () => {
  const scheduler = createBioScheduler(); scheduler.update(at(0));
  for (const cycle of [1, 2000, 2 ** 32]) {
    const events = createBioCyclePlan(cycle).events, missed = events[2], future = events[3];
    assert.equal(scheduler.update(at(missed.scheduledSeconds + .01)), null);
    assert.equal(scheduler.state.cachedCycleIndex, cycle);
    assert.equal(scheduler.update(at(missed.scheduledSeconds + .02)), null);
    scheduler.sync(at(future.scheduledSeconds - .02));
    assert.deepEqual(scheduler.update(at(future.scheduledSeconds)), future);
  }
});

test('rewinding the same instance never repeats dispatched IDs and retains only a scalar watermark', () => {
  const scheduler = createBioScheduler(), events = createBioCyclePlan(0).events;
  for (const event of events.slice(0, 4)) {
    scheduler.sync(at(event.scheduledSeconds - .01)); assert.deepEqual(scheduler.update(at(event.scheduledSeconds)), event);
  }
  const highWater = scheduler.state.consumedThroughSeconds;
  for (const event of events.slice(0, 4)) {
    scheduler.sync(at(event.scheduledSeconds - .01)); assert.equal(scheduler.update(at(event.scheduledSeconds)), null);
  }
  assert.equal(scheduler.state.consumedThroughSeconds, highWater);
  const future = events[4]; scheduler.sync(at(future.scheduledSeconds - .01));
  assert.deepEqual(scheduler.update(at(future.scheduledSeconds)), future);
});

test('plans are immutable, query order is irrelevant, and previewing does not consume events', () => {
  const scheduler = createBioScheduler(), now = at(0), plan = scheduler.getPlan(now);
  assert.equal(plan, scheduler.getPlan(at(25)));
  assert(Object.isFrozen(plan)); assert(Object.isFrozen(plan.events)); assert(Object.isFrozen(plan.events[0]));
  assert.throws(() => { plan.events[0].sourceId = 'bird-invalid'; }, TypeError);
  scheduler.getPlan(at(1000 * period)); assert.deepEqual(scheduler.getPlan(now), plan);
  assert.equal(scheduler.state.consumedThroughSeconds, null);
  const event = plan.events[0]; scheduler.update(at(event.scheduledSeconds - .01));
  assert.deepEqual(scheduler.update(at(event.scheduledSeconds)), event);
});

test('many cycles retain one bounded plan and no growing event/ID history', () => {
  const scheduler = createBioScheduler();
  assert.equal(scheduler.state.retainedCycleCount, 0);
  const fields = Object.keys(scheduler.state);
  for (let cycle = 0; cycle < 10000; cycle++) {
    scheduler.update(at(cycle * period));
    assert.equal(scheduler.state.retainedCycleCount, 1);
    assert.equal(scheduler.state.cachedCycleIndex, cycle);
    assert(scheduler.state.cachedEventCount <= MAX_BIO_EVENTS_PER_CYCLE);
    assert.deepEqual(Object.keys(scheduler.state), fields);
  }
  assert.equal(MAX_BIO_EVENTS_PER_CYCLE, 32);
});

test('large supported elapsed times are finite and unsupported values fail promptly', () => {
  const scheduler = createBioScheduler();
  for (const elapsed of [1e9, 1e12, MAX_BIO_ELAPSED_SECONDS - 100]) {
    const plan = scheduler.getPlan(at(elapsed));
    assert(plan.events.length > 0 && plan.events.length <= 32);
    for (const e of plan.events) {
      for (const n of [e.scheduledSeconds, e.latestStartSeconds, e.durationSeconds, e.phaseEndSeconds]) assert(Number.isFinite(n));
      assert(e.latestStartSeconds + e.durationSeconds <= e.phaseEndSeconds);
    }
  }
  for (const elapsed of [-1, NaN, Infinity, Number.MAX_VALUE, MAX_BIO_ELAPSED_SECONDS])
    assert.throws(() => scheduler.update({ elapsedSeconds: elapsed, cycleSeconds: 0, timeOfDay: 'day' }), RangeError);
  for (const index of [-1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER, MAX_BIO_CYCLE_INDEX + 1])
    assert.throws(() => createBioCyclePlan(index), RangeError);
  for (const seed of [-1, .5, NaN, Infinity, 2 ** 32, 'seed']) assert.throws(() => createBioScheduler({ seed }), RangeError);
  assert.throws(() => scheduler.update({ elapsedSeconds: 10, cycleSeconds: 0, timeOfDay: 'day' }), RangeError);
  assert.throws(() => scheduler.update(at(0), { paused: 'yes' }), TypeError);
});

test('fog state has no effect on plans or dispatch', () => {
  const event = createBioCyclePlan(0).events.find(e => e.timeOfDay === 'night');
  const a = createBioScheduler(), b = createBioScheduler();
  a.sync(at(event.scheduledSeconds - .01)); b.sync(at(event.scheduledSeconds - .01));
  assert.deepEqual(a.update({ ...at(event.scheduledSeconds), fogType: 'DENSE_FOG', intensity: 1 }),
    b.update({ ...at(event.scheduledSeconds), fogType: 'CLEAR', intensity: 0 }));
});

test('import/planning/dispatch require no wall clock, RNG, timers, DOM, fetch or AudioContext', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {createGameClock} from './src/game/game-clock.js';
    const forbidden=()=>{throw Error('forbidden dependency')};
    Math.random=forbidden;Date.now=forbidden;globalThis.setTimeout=forbidden;globalThis.setInterval=forbidden;
    globalThis.fetch=forbidden;globalThis.AudioContext=class {constructor(){forbidden()}};
    globalThis.OfflineAudioContext=globalThis.AudioContext;
    Object.defineProperty(globalThis,'document',{get:forbidden});
    const {createBioScheduler}=await import('./src/audio/bio-schedule.js');
    const scheduler=createBioScheduler(),clock=createGameClock();scheduler.update(clock.state);
    const event=scheduler.getPlan(clock.state).events[0];
    scheduler.sync(createGameClock(undefined,{elapsedSeconds:event.scheduledSeconds-.01}).state);
    assert.equal(scheduler.update(createGameClock(undefined,{elapsedSeconds:event.scheduledSeconds}).state).eventId,event.eventId);
  `], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
