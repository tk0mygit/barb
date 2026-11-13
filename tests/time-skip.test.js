import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameClock } from '../src/game/game-clock.js';
import { createTimeSkip, TIME_SKIP_RATE, TIME_SKIP_MAX_SECONDS } from '../src/game/time-skip.js';
import { createGameplay } from '../src/game/gameplay.js';
import { createSaveData, restoreSaveData } from '../src/game/save-data.js';
import { sampleDayNight } from '../src/world/day-night.js';
import { sampleNightFog, getNightFogProfile } from '../src/world/night-fog.js';
import { sampleStars } from '../src/world/stars.js';
import { sampleMeteor } from '../src/world/meteor.js';
import { sampleAurora } from '../src/world/aurora.js';
import { sampleAudioMix } from '../src/audio/audio-mix.js';

const clockAt = elapsedSeconds => createGameClock(undefined, { elapsedSeconds });

for (const fps of [30, 60, 144, 7, 1, .5]) {
  for (const [start, end] of [[0, 180], [90, 180], [179, 180], [180, 360], [270, 360], [359, 360]]) {
    test(`${fps}fps: ${start}→${end}, 18x only until the fixed boundary`, () => {
      const clock = clockAt(start), skip = createTimeSkip(clock), phase = clock.state.timeOfDay;
      assert.equal(skip.start(), false);
      assert.equal(skip.start(true), true);
      let frames = 0;
      const required = (end - start) / TIME_SKIP_RATE;
      while (skip.active) {
        assert.equal(skip.start(true), false);
        assert.equal(skip.step(1 / fps), true);
        frames++;
        const expected = Math.min(end, start + frames / fps * 18);
        assert.ok(Math.abs(clock.state.elapsedSeconds - expected) < 1e-8);
        assert.ok(clock.state.elapsedSeconds <= end);
        assert.ok(frames <= Math.ceil(required * fps));
      }
      assert.equal(frames, Math.ceil(required * fps));
      assert.equal(clock.state.elapsedSeconds, end);
      assert.notEqual(clock.state.timeOfDay, phase);
      assert.ok(required <= TIME_SKIP_MAX_SECONDS);
      // No residual dt from the finishing frame enters the following phase.
      assert.equal(skip.step(.125), false);
      assert.equal(clock.state.elapsedSeconds, end + .125);
    });
  }
}

test('large/invalid deltas, repeated start, cancellation and explicit restart never re-arm or catch up', () => {
  for (const dt of [10, 35, 600000, Number.MAX_VALUE]) {
    const clock = clockAt(179), skip = createTimeSkip(clock);
    skip.start(true); skip.step(dt);
    assert.equal(clock.state.elapsedSeconds, 180); assert.equal(skip.active, false);
  }
  for (const invalid of [NaN, Infinity, -Infinity, -1, undefined]) {
    const clock = clockAt(90), skip = createTimeSkip(clock);
    skip.start(true); skip.step(invalid);
    assert.equal(clock.state.elapsedSeconds, 90); assert.equal(skip.active, false);
  }
  const clock = clockAt(0), skip = createTimeSkip(clock);
  skip.start(true); skip.step(0); assert.equal(skip.active, true);
  skip.step(1); assert.equal(clock.state.elapsedSeconds, 18);
  skip.cancel(); assert.equal(skip.active, false);
  skip.step(.5); assert.equal(clock.state.elapsedSeconds, 18.5);
  assert.equal(skip.start(false), false); assert.equal(skip.start(true), true);
  skip.step(100); assert.equal(clock.state.elapsedSeconds, 180);
  assert.equal(skip.start(true), true); skip.step(10); assert.equal(clock.state.elapsedSeconds, 360);
});

test('external time jumps cancel the old target without adding any further clock delta', () => {
  for (const jump of [.1, 90, 360000]) {
    const clock = clockAt(90), skip = createTimeSkip(clock);
    skip.start(true); skip.step(1); clock.step(jump);
    const before = clock.state;
    assert.equal(skip.step(1), true); assert.equal(skip.active, false);
    assert.deepEqual(clock.state, before);
  }
});

test('restored high clocks and clock-rounded boundaries end at the representable next boundary', () => {
  for (const start of [179.9999999995, 359.9999999995, 360 * 2 ** 32 + 90, 1e15 + 90, Number.MAX_SAFE_INTEGER - 100]) {
    for (const fps of [30, 60, 144]) {
      const clock = clockAt(start), skip = createTimeSkip(clock);
      const phase = clock.state.timeOfDay;
      let expected = Math.ceil(start / 180) * 180;
      if (clockAt(expected).state.timeOfDay === phase) expected += 180;
      assert.equal(skip.start(true), true);
      let frames = 0;
      while (skip.active) { skip.step(1 / fps); assert.ok(++frames <= fps * 10); }
      assert.equal(clock.state.elapsedSeconds, expected);
      assert.notEqual(clock.state.timeOfDay, phase);
    }
  }
  const unrepresentable = createTimeSkip(clockAt(Number.MAX_VALUE));
  assert.equal(unrepresentable.start(true), false);
});

test('ordinary 1x timing remains identical, including long active frames and rejected deltas', () => {
  const actual = clockAt(0), expected = clockAt(0), skip = createTimeSkip(actual);
  for (const dt of [1 / 30, 1 / 60, 1 / 144, 35, 180, 36000, 0, -1, NaN, Infinity]) {
    assert.equal(skip.step(dt), false); expected.step(dt);
    assert.deepEqual(actual.state, expected.state);
  }
});

test('save only the real clock; a restored mid-skip checkpoint has no running skip or domain progress', () => {
  let randomCalls = 0;
  const game = createGameplay({ qteEnabled: true, random: () => { randomCalls++; return .5; } });
  const before = createSaveData(game, { savedAt: '2026-11-13T00:00:00Z' });
  const fishingBefore = structuredClone(game.fishing.state), callsBefore = randomCalls;
  const skip = createTimeSkip(game.clock); skip.start(true); skip.step(4);
  const saved = createSaveData(game, { savedAt: before.savedAt });
  assert.equal(saved.clock.elapsedSeconds, 72);
  assert.deepEqual({ ...saved, clock: before.clock }, before);
  assert.deepEqual(game.fishing.state, fishingBefore);
  assert.equal(randomCalls, callsBefore);
  const restored = restoreSaveData(saved), restoredSkip = createTimeSkip(restored.clock);
  assert.equal(restoredSkip.active, false); restoredSkip.step(1);
  assert.equal(restored.clock.state.elapsedSeconds, 73);
  assert.deepEqual(saved.settings, {});
});

test('intermediate sky, fog, stars, meteors, aurora and audio use the same independent clock samples', () => {
  const profiles = new Map();
  for (let i = 0; profiles.size < 3; i++) profiles.set(getNightFogProfile(i).fogType, i);
  for (const index of profiles.values()) {
    const start = index * 360 + 180, clock = clockAt(start), skip = createTimeSkip(clock);
    const sample = c => {
      const fog = sampleNightFog(c);
      return { day: sampleDayNight(c), fog, stars: sampleStars(c, fog.fogType),
        meteor: sampleMeteor(c, fog.fogType), aurora: sampleAurora(c, fog.fogType), audio: sampleAudioMix(c) };
    };
    skip.start(true);
    for (let frame = 1; frame <= 40; frame++) {
      skip.step(.25);
      assert.deepEqual(sample(clock.state), sample(clockAt(start + frame * 4.5).state));
    }
    assert.equal(skip.active, false);
    const nightClock = clockAt(start + 85.5), game = createGameplay({ clock: nightClock });
    const restored = restoreSaveData(createSaveData(game, { savedAt: '2026-11-13T00:00:00Z' }));
    assert.deepEqual(sample(restored.clock.state), sample(nightClock.state));
  }
});
