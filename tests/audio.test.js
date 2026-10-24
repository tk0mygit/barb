import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameClock } from '../src/game/game-clock.js';
import { sampleNightFog, FOG_TYPE } from '../src/world/night-fog.js';
import { sampleAudioMix } from '../src/audio/audio-mix.js';
import { createAudioSession } from '../src/audio/audio-session.js';
import { createAmbientAudio } from '../src/audio/ambient-audio.js';
import { createAmbientPlayer, AMBIENT_GAIN, AUDIO_FADE_SECONDS } from '../src/audio/ambient-player.js';
import { createGeneratedBuffers } from '../src/audio/generated-sources.js';
import { createFishingAudio } from '../src/ui/fishing-audio.js';
import { fakeContext, fakeTimers } from './helpers/audio-fakes.js';

const at = seconds => createGameClock(undefined, { elapsedSeconds: seconds }).state;
const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const buffers = { day: { duration: 24 }, night: { duration: 24 }, nature: { duration: 24 } };

test('DAY/NIGHT_CLEAR/NIGHT_FOG/NIGHT_DENSE_FOG and exact world fog envelopes, including 180/360 boundaries', () => {
  for (const [seconds, mode] of [[90, 'DAY'], [180, 'NIGHT_CLEAR'], [270, 'NIGHT_CLEAR'], [360, 'DAY'], [900, 'NIGHT_DENSE_FOG'], [990, 'NIGHT_DENSE_FOG'], [2790, 'NIGHT_FOG'], [1080, 'DAY']])
    assert.equal(sampleAudioMix(at(seconds)).mode, mode);
  const target = {};
  for (let second = 0; second <= 1080; second += 0.5) {
    assert.equal(sampleAudioMix(at(second), target), target);
    const fog = sampleNightFog(at(second));
    near(target.nature, fog.fogType === FOG_TYPE.DENSE_FOG ? fog.intensity : 0);
    near(target.day + target.night + target.nature, 1);
    assert.ok([target.day, target.night, target.nature].every(n => n >= 0 && n <= 1));
  }
  for (const [second, nature] of [[900, 0], [906, 0.5], [912, 1], [1068, 1], [1074, 0.5], [1080, 0]]) near(sampleAudioMix(at(second)).nature, nature);
  for (const boundary of [180, 360, 900, 1080]) {
    const a = sampleAudioMix(at(boundary - 1e-6)), b = sampleAudioMix(at(boundary + 1e-6));
    for (const kind of ['day', 'night', 'nature']) near(a[kind], b[kind], 1e-6);
  }
});

test('30/60/144fps, paused clock, low fps and large jumps always match absolute sampling', () => {
  for (const fps of [30, 60, 144]) {
    const clock = createGameClock();
    for (let seconds = 1; seconds <= 1080; seconds++) {
      for (let frame = 0; frame < fps; frame++) clock.step(1 / fps);
      const a = sampleAudioMix(clock.state), b = sampleAudioMix(at(seconds));
      assert.equal(a.mode, b.mode);
      for (const kind of ['day', 'night', 'nature']) near(a[kind], b[kind]);
    }
    const before = sampleAudioMix(clock.state); clock.step(360000, true);
    assert.deepEqual(sampleAudioMix(clock.state), before);
    for (const dt of [0.5, 4, 360 * 100000 + 186]) {
      clock.step(dt); assert.deepEqual(sampleAudioMix(clock.state), sampleAudioMix(at(clock.state.elapsedSeconds)));
    }
  }
});

test('context is lazy, unsupported/throw/rejection are isolated and interruptions retry in a gesture', async () => {
  const context = fakeContext(); let constructions = 0;
  const session = createAudioSession({ createContext: () => { constructions++; return context; } });
  assert.equal(constructions, 0); assert.equal(session.status, 'waiting');
  assert.equal(await session.unlock(), true); assert.equal(constructions, 1); assert.equal(context.resumes, 1);
  await session.unlock(); assert.equal(context.resumes, 1);
  context.change('interrupted'); assert.equal(session.status, 'interrupted');
  context.resume = () => { context.resumes++; return Promise.reject(new Error('denied')); };
  assert.equal(await session.unlock(), false); assert.equal(session.status, 'blocked');
  context.resume = () => { context.change('running'); return Promise.resolve(); };
  assert.equal(await session.unlock(), true); assert.equal(session.status, 'ready');
  session.dispose(); assert.equal(context.state, 'closed'); assert.equal(await session.unlock(), false);
  const unsupported = createAudioSession({ createContext: () => null });
  assert.equal(await unsupported.unlock(), false); assert.equal(unsupported.status, 'unsupported');
  const broken = createAudioSession({ createContext: () => { throw Error('failed'); } });
  assert.equal(await broken.unlock(), false); assert.equal(broken.status, 'blocked');
});

test('one bounded bank, smooth volume/fades, release on pause/off and no backlog after jumps', () => {
  const context = fakeContext(); context.change('running'); const timers = fakeTimers(); let generations = 0;
  const player = createAmbientPlayer({ ...timers, makeBuffers: () => { generations++; return buffers; } });
  for (let i = 0; i < 100; i++) {
    player.play(context, sampleAudioMix(at(i * 186)), i % 101, i * 186);
    player.stop(); assert.equal(timers.timers.size, 1);
    player.play(context, sampleAudioMix(at(i * 186)), 70, i * 186); // rapid resume reuses voices
    assert.equal(timers.timers.size, 0);
    assert.equal(context.nodes.filter(n => n.type === 'source').length, 3);
  }
  assert.equal(generations, 1);
  const master = context.nodes[0]; near(master.gain.value, AMBIENT_GAIN * 0.7);
  assert.deepEqual(master.gain.events[0], ['set', 0, context.currentTime]);
  for (let i = 0; i < master.gain.events.length; i++) {
    if (master.gain.events[i][0] !== 'linear') continue;
    const anchor = master.gain.events[i - 1];
    assert.equal(anchor[0], 'set');
    near(master.gain.events[i][2] - anchor[2], AUDIO_FADE_SECONDS);
  }
  player.stop(); timers.flush();
  assert.ok(context.nodes.every(n => n.disconnected));
  assert.ok(context.nodes.filter(n => n.type === 'source').every(n => n.stopped && n.buffer === null));
  for (let i = 0; i < 30; i++) {
    player.play(context, sampleAudioMix(at(990)), 50, 360000 + i);
    assert.equal(context.nodes.filter(n => !n.disconnected && n.type === 'source').length, 3);
    assert.equal(context.nodes.at(-2).offset, (360000 + i) % 24);
    player.stop({ freeBuffers: true }); timers.flush();
    assert.ok(context.nodes.every(n => n.disconnected));
  }
  context.change('suspended'); player.stop(); assert.equal(timers.timers.size, 0);
  player.dispose(); assert.ok(context.nodes.every(n => n.disconnected));
});

test('gain retargeting follows the audio clock through irregular volume, pause and resume changes', () => {
  const context = fakeContext(); context.change('running');
  const timers = fakeTimers(), player = createAmbientPlayer({ ...timers, makeBuffers: () => buffers });
  const mix = sampleAudioMix(at(90));
  player.play(context, mix, 40, 90);
  const master = context.nodes[0].gain;
  const expectRamp = (from, to, time) => {
    const [cancel, anchor, end] = master.events.slice(-3);
    assert.deepEqual(cancel, ['cancel', time]);
    assert.equal(anchor[0], 'set'); near(anchor[1], from); near(anchor[2], time);
    assert.equal(end[0], 'linear'); near(end[1], to); near(end[2], time + AUDIO_FADE_SECONDS);
  };
  expectRamp(0, 0.12, 1);
  // An intrinsic/default AudioParam value must never replace the in-flight envelope.
  master.value = 1;
  context.currentTime = 1.04; player.play(context, mix, 80, 90);
  expectRamp(0.06, 0.24, 1.04);
  context.currentTime = 1.06; player.stop();
  expectRamp(0.105, 0, 1.06);
  context.currentTime = 1.08; player.play(context, mix, 40, 90);
  expectRamp(0.07875, 0.12, 1.08); assert.equal(timers.timers.size, 0);
  context.currentTime = 1.5; player.play(context, mix, 60, 90);
  expectRamp(0.12, 0.18, 1.5);
  assert.equal(context.nodes.filter(node => node.type === 'source').length, 3);
  player.dispose();
});

test('partial source failure releases every allocated node', () => {
  const context = fakeContext(); context.change('running');
  const create = context.createBufferSource; let n = 0;
  context.createBufferSource = () => { if (++n === 2) throw Error('allocation'); return create(); };
  const player = createAmbientPlayer({ makeBuffers: () => buffers });
  assert.throws(() => player.play(context, sampleAudioMix(at(90)), 50, 90));
  assert.ok(context.nodes.every(node => node.disconnected)); player.dispose();
});


test('channel-gain allocation failure releases the source created immediately before it', () => {
  const context = fakeContext(); context.change('running');
  const create = context.createGain; let count = 0;
  context.createGain = () => { if (++count === 2) throw Error('gain allocation'); return create(); };
  const player = createAmbientPlayer({ makeBuffers: () => buffers });
  assert.throws(() => player.play(context, sampleAudioMix(at(90)), 50, 90));
  assert.ok(context.nodes.every(node => node.disconnected)); player.dispose();
});

test('controller pauses compose, mute/off stay cheap, storage failure stays independent and failures retry', async () => {
  const context = fakeContext(), clock = createGameClock(undefined, { elapsedSeconds: 906 });
  const session = createAudioSession({ createContext: () => context });
  const calls = [], writes = [];
  let fail = false;
  const player = { play(...args) { calls.push(['play', ...args]); if (fail) throw Error('failed'); }, stop: options => calls.push(['stop', options]), dispose() {} };
  const ambient = createAmbientAudio({ session, clock, player,
    preferencesStore: { load: () => ({ preferences: { version: 1, enabled: false, volume: 40 }, persistence: 'default' }),
      save(value) { writes.push(value); return 'failed'; } } });
  assert.equal(session.context, undefined); assert.equal(writes.length, 0); assert.equal(ambient.state.playback, 'off');
  ambient.setPreferences({ enabled: true }); assert.equal(ambient.state.playback, 'waiting');
  assert.equal(ambient.state.persistence, 'failed'); await session.unlock();
  assert.equal(ambient.state.playback, 'playing'); near(calls.at(-1)[2].nature, 0.5);
  for (const reason of ['menu', 'hidden', 'blur', 'page']) ambient.setPaused(reason, true);
  assert.equal(ambient.state.playback, 'paused');
  for (const reason of ['menu', 'hidden', 'blur']) { ambient.setPaused(reason, false); assert.equal(ambient.state.playback, 'paused'); }
  clock.step(360 * 1000); ambient.setPaused('page', false);
  assert.equal(ambient.state.playback, 'playing'); assert.equal(calls.at(-1)[4], clock.state.elapsedSeconds);
  context.change('interrupted'); assert.equal(ambient.state.playback, 'interrupted'); assert.equal(calls.at(-1)[1].immediate, true);
  ambient.setPaused('blur', true); ambient.setPaused('blur', false); assert.equal(context.resumes, 1);
  await session.unlock(); assert.equal(ambient.state.playback, 'playing');
  fail = true; ambient.update(); assert.equal(ambient.state.playback, 'blocked');
  fail = false; ambient.unlock(); await Promise.resolve(); assert.equal(ambient.state.playback, 'playing');
  ambient.setPreferences({ volume: 0 }); assert.equal(ambient.state.playback, 'muted');
  ambient.setPreferences({ enabled: false }); assert.equal(ambient.state.playback, 'off');
  assert.equal(calls.at(-1)[1].freeBuffers, true);
  const count = writes.length; ambient.setPreferences({ volume: NaN }); assert.equal(writes.length, count);
  ambient.dispose(); session.dispose();
});

test('bite keeps the original pitch, 0.12 gain and 0.32s timing on its own path; all failures are contained', async () => {
  const context = fakeContext(), session = createAudioSession({ createContext: () => context });
  const bite = createFishingAudio({ session }); bite.bite(); assert.equal(context.nodes.length, 0);
  await bite.unlock(); bite.bite();
  const [oscillator, gain] = context.nodes;
  assert.deepEqual(oscillator.frequency.events, [['set', 880, 1], ['linear', 1320, 1.16]]);
  assert.deepEqual(gain.gain.events, [['set', 0.0001, 1], ['exponential', 0.12, 1.02], ['exponential', 0.0001, 1.3]]);
  assert.equal(oscillator.stopTime, 1.32); assert.equal(gain.connections[0], context.destination);
  oscillator.onended(); assert.ok(oscillator.disconnected && gain.disconnected);
  context.createGain = () => { throw Error('allocation'); };
  assert.doesNotThrow(() => bite.bite()); assert.ok(context.nodes.at(-1).disconnected);
  context.change('interrupted'); assert.doesNotThrow(() => bite.bite()); session.dispose();
});

test('original buffers have bounded memory/peaks, smooth seams, distinct music and no recurring allocations', () => {
  const buffers = createGeneratedBuffers(fakeContext()); let bytes = 0;
  for (const buffer of Object.values(buffers)) {
    const data = buffer.getChannelData(0); let peak = 0, energy = 0, step = 0;
    for (let i = 0; i < data.length; i++) {
      assert.ok(Number.isFinite(data[i])); peak = Math.max(peak, Math.abs(data[i])); energy += data[i] ** 2;
      if (i) step = Math.max(step, Math.abs(data[i] - data[i - 1]));
    }
    assert.ok(peak > 0.01 && peak * AMBIENT_GAIN < 0.05); assert.ok(energy / data.length > 0.00001);
    assert.ok(step < 0.03); near(data[0], data.at(-1), 1e-6); bytes += data.byteLength;
  }
  assert.ok(bytes < 7 * 1024 * 1024);
  assert.notDeepEqual(buffers.day.getChannelData(0), buffers.night.getChannelData(0));
});

test('FOG retains the complete clear-night BGM throughout both fades; only DENSE_FOG silences it', () => {
  for (const phase of [0, 3, 6, 12, 90, 168, 174, 180 - 1e-4]) {
    const clear = sampleAudioMix(at(180 + phase));
    for (const index of [7, 8, 9, 10]) {
      const fog = sampleAudioMix(at(index * 360 + 180 + phase));
      assert.equal(fog.mode, 'NIGHT_FOG'); assert.equal(fog.nature, 0);
      near(fog.day, clear.day); near(fog.night, clear.night);
    }
    const dense = sampleAudioMix(at(360 + 180 + phase));
    assert.equal(dense.mode, 'NIGHT_DENSE_FOG');
    near(dense.day + dense.night, 1 - dense.intensity); near(dense.nature, dense.intensity);
  }
  const dense = sampleAudioMix(at(630)); assert.equal(dense.night, 0); assert.equal(dense.day, 0); assert.equal(dense.nature, 1);
});
