import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { createGameClock } from '../src/game/game-clock.js';
import { createBioPlayer, sampleBioGain, BIO_FADE_SECONDS, BIO_RETRY_SECONDS } from '../src/audio/bio-player.js';
import { createBioCyclePlan } from '../src/audio/bio-schedule.js';
import { BIO_VARIANTS } from '../src/audio/bio-sources.js';
import { sampleAudioMix } from '../src/audio/audio-mix.js';
import { createAmbientAudio } from '../src/audio/ambient-audio.js';
import { createAudioSession } from '../src/audio/audio-session.js';
import { fakeContext, deferred } from './helpers/audio-fakes.js';

const at = elapsedSeconds => createGameClock(undefined, { elapsedSeconds }).state;
const close = (a, b) => assert(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const buffers = new Map(BIO_VARIANTS.map(v => [v.id, { duration: v.durationSeconds, length: v.frames,
  numberOfChannels: 1, sampleRate: 44100 }]));
function setup({ seconds = 0, makeFactory, scheduler } = {}) {
  let secondsNow = seconds;
  const clock = { get state() { return at(secondsNow); } };
  const context = fakeContext(); context.sampleRate = 44100; context.change('running');
  const createSource = context.createBufferSource;
  context.createBufferSource = () => {
    const source = createSource(), start = source.start, stop = source.stop;
    source.start = function(when, ...args) { this.startedAt = when; return start.call(this, when, ...args); };
    source.stop = function(time) { this.stopTime = time; return stop.call(this, time); };
    return source;
  };
  const banks = [];
  const factoryMaker = makeFactory ?? (() => {
    const bank = { gets: [], disposed: false,
      get(id) { this.gets.push(id); return Promise.resolve(buffers.get(id)); },
      dispose() { this.disposed = true; } };
    banks.push(bank); return bank;
  });
  const player = createBioPlayer({ clock, makeFactory: factoryMaker, ...(scheduler ? { scheduler } : {}) });
  const update = (seconds = secondsNow, options = {}) => {
    secondsNow = seconds; context.currentTime = seconds + 1;
    player.update({ context, mix: sampleAudioMix(clock.state), volume: 40, enabled: true, playing: true, ready: true, ...options });
  };
  const live = () => context.nodes.filter(n => !n.disconnected);
  const end = () => { for (const n of [...live()]) if (n.type === 'source') n.onended?.(); };
  return { player, clock, context, banks, update, live, end, setTime: t => { secondsNow = t; } };
}

test('lazy until enabled and unlocked; current three preload in menus, next three 30s before boundary', async () => {
  const h = setup();
  for (const options of [{ enabled: false }, { ready: false }, { volume: 0 }]) h.update(0, { playing: false, ...options });
  await turn(); assert.equal(h.banks.length, 0); assert.equal(h.context.nodes.length, 0);
  h.update(10, { playing: false }); await turn();
  assert.deepEqual(h.banks[0].gets, ['bird-a', 'bird-b', 'bird-c']);
  assert.equal(h.player.state.decodedCount, 3); assert.equal(h.live().length, 0);
  h.update(149); await turn(); assert.equal(h.banks[0].gets.length, 3);
  h.update(150); await turn(); assert.equal(h.player.state.decodedCount, 6);
  assert.equal(h.banks[0].gets.length, 6);
  for (let t = 151; t < 400; t++) h.update(t);
  await turn(); assert.equal(h.banks[0].gets.length, 6); h.player.dispose();
});

test('six variants start only at scheduled events, non-looping, on the supplied context; finish frees nodes and handlers', async () => {
  const h = setup(); h.update(0); await turn();
  const events = createBioCyclePlan(0).events;
  for (const event of events) {
    h.update(event.scheduledSeconds - .01); await turn();
    h.update(event.scheduledSeconds); await turn();
    const source = h.live().find(n => n.type === 'source');
    assert(source, event.eventId); assert.equal(source.buffer, buffers.get(event.sourceId)); assert.equal(source.loop, false);
    assert.equal(h.player.state.activeVoices, 1); assert.equal(h.live().length, 2);
    assert.equal(source.connections[0].connections[0], h.context.destination);
    h.update(event.scheduledSeconds); await turn(); assert.equal(h.live().length, 2);
    h.end(); assert.equal(h.live().length, 0); assert.equal(source.buffer, null); assert.equal(source.onended, null);
  }
  assert.equal(h.player.state.starts, events.length); assert.equal(h.player.state.released, events.length);
  assert.equal(h.banks.length, 1); assert.equal(h.banks[0].gets.length, 6);
  h.player.dispose(); assert.equal(h.player.state.pcmBytes, 0);
});

test('one active or fading voice blocks overlap and duplicate events cannot replay after completion', async () => {
  const [one, two] = createBioCyclePlan(0).events;
  let event = null;
  const scheduler = { state: { retainedCycleCount: 1 }, sync() {}, update() { return event; } };
  const h = setup({ scheduler }); h.update(0); await turn();
  h.update(one.scheduledSeconds - .01); event = one; h.update(one.scheduledSeconds); await turn(); assert.equal(h.player.state.starts, 1);
  // Inject the same scheduler result repeatedly as a defensive ownership test.
  for (let i = 0; i < 20; i++) h.update(one.scheduledSeconds + i * .001);
  await turn(); assert.equal(h.player.state.starts, 1);
  event = { ...two, eventId: `${two.eventId}/overlap`, scheduledSeconds: one.scheduledSeconds + .05 };
  h.update(one.scheduledSeconds + .05); await turn(); assert.equal(h.player.state.starts, 1); assert.equal(h.player.state.busy, 1);
  h.end(); event = one; h.update(one.scheduledSeconds + .06); await turn(); assert.equal(h.player.state.starts, 1);
  event = null; h.update(two.scheduledSeconds - .01); event = two; h.update(two.scheduledSeconds); await turn();
  assert.equal(h.player.state.starts, 2); h.end(); h.player.dispose();
});

test('pending first decode misses its deadline without starting; later events can use the completed cache', async () => {
  const wait = deferred();
  const h = setup({ makeFactory: () => ({ get: id => wait.promise.then(() => buffers.get(id)), dispose() {} }) });
  const [first, second] = createBioCyclePlan(0).events;
  h.update(0); await turn();
  h.update(first.scheduledSeconds - .01); h.update(first.scheduledSeconds); await turn();
  assert(h.player.state.pendingEvent);
  h.setTime(first.latestStartSeconds + .01); wait.resolve(); await turn();
  assert.equal(h.player.state.starts, 0); assert.equal(h.player.state.pendingEvent, null);
  assert.equal(h.player.state.expired, 1);
  h.update(second.scheduledSeconds - .01); h.update(second.scheduledSeconds); await turn();
  assert.equal(h.player.state.starts, 1); h.end(); h.player.dispose();
});

for (const stop of ['menu', 'off', 'mute', 'interrupted', 'dispose']) {
  test(`${stop} while loading invalidates pending playback; old completion cannot start or overwrite a new bank`, async () => {
    const wait = deferred(), banks = [];
    const h = setup({ makeFactory: () => {
      const index = banks.length, bank = { disposed: false,
        get: id => index === 0 ? wait.promise.then(() => buffers.get(id)) : Promise.resolve(buffers.get(id)),
        dispose() { this.disposed = true; } };
      banks.push(bank); return bank;
    } });
    const event = createBioCyclePlan(0).events[0]; h.update(0); await turn();
    h.update(event.scheduledSeconds - .01); h.update(event.scheduledSeconds); await turn();
    if (stop === 'dispose') h.player.dispose();
    else if (stop === 'interrupted') h.context.change('interrupted');
    else h.update(event.scheduledSeconds, { playing: false,
      ...(stop === 'off' ? { enabled: false } : stop === 'mute' ? { volume: 0 } : {}) });
    wait.resolve(); await turn();
    assert.equal(h.player.state.starts, 0); assert.equal(h.live().length, 0);
    if (['off', 'dispose'].includes(stop)) assert.equal(h.player.state.decodedCount, 0);
    if (stop !== 'dispose') {
      h.context.change('running'); h.update(event.scheduledSeconds + .1); await turn();
      assert.equal(h.player.state.starts, 0, 'resume must not replay the old event');
      const next = createBioCyclePlan(0).events[1]; h.update(next.scheduledSeconds - .01); h.update(next.scheduledSeconds); await turn();
      assert.equal(h.player.state.starts, 1); h.end();
    }
    h.player.dispose();
  });
}

test('partial allocation and start failures release every node and are isolated from future events', async () => {
  for (const mode of ['gain', 'start', 'connect']) {
    const h = setup(); h.update(0); await turn();
    const gain = h.context.createGain, source = h.context.createBufferSource;
    if (mode === 'gain') h.context.createGain = () => { throw Error('intentional gain failure'); };
    else h.context.createBufferSource = () => {
      const node = source(); node[mode] = () => { throw Error(`intentional ${mode} failure`); }; return node;
    };
    const event = createBioCyclePlan(0).events[0]; h.update(event.scheduledSeconds - .01); h.update(event.scheduledSeconds); await turn();
    assert.equal(h.live().length, 0); assert.equal(h.player.state.starts, 0); assert.equal(h.player.state.playbackFailures, 1);
    h.context.createGain = gain; h.context.createBufferSource = source; h.player.dispose();
  }
});

test('40ms stop fades track the actual in-flight ramp, preserve caches, and release onended', async () => {
  const h = setup(); h.update(0); await turn();
  const event = createBioCyclePlan(0).events[0]; h.update(event.scheduledSeconds - .01); h.update(event.scheduledSeconds); await turn();
  const source = h.live().find(n => n.type === 'source'), gain = source.connections[0].gain;
  close(gain.value, .054);
  h.context.currentTime += BIO_FADE_SECONDS / 2;
  // Controller stop takes the same time; do not advance game/context clocks.
  h.player.update({ context: h.context, mix: sampleAudioMix(h.clock.state), volume: 40, enabled: true, playing: false, ready: true });
  const [cancel, anchor, end] = gain.events.slice(-3);
  assert.equal(cancel[0], 'cancel'); close(anchor[1], .027); close(end[1], 0);
  close(end[2] - anchor[2], BIO_FADE_SECONDS);
  close(source.stopTime, h.context.currentTime + BIO_FADE_SECONDS);
  assert.equal(h.player.state.activeVoices, 1); h.end(); assert.equal(h.live().length, 0);
  h.update(event.scheduledSeconds + .2); await turn(); assert.equal(h.banks.length, 1); assert.equal(h.banks[0].gets.length, 3);
  h.player.dispose();
});

test('context close/replacement and final disposal release cached PCM, listeners, and fading nodes', async () => {
  const h = setup(); h.update(0); await turn();
  const e = createBioCyclePlan(0).events[0]; h.update(e.scheduledSeconds - .01); h.update(e.scheduledSeconds); await turn();
  h.player.dispose(); assert.equal(h.player.state.decodedCount, 0);
  h.context.change('closed'); assert.equal(h.live().length, 0); assert.equal(h.player.state.activeVoices, 0);
  const other = setup(); other.update(0); await turn();
  const old = other.banks[0]; other.context.change('closed'); assert.equal(old.disposed, true); assert.equal(other.player.state.pcmBytes, 0);
  const next = fakeContext(); next.sampleRate = 44100; next.change('running');
  other.player.update({ context: next, mix: sampleAudioMix(at(1)), volume: 40, enabled: true, playing: true, ready: true });
  await turn(); assert.equal(other.banks.length, 2); other.player.dispose();
});

test('load failure has game-time backoff, explicit retry resets it, and failures do not become per-frame fetches', async () => {
  let calls = 0, failing = true;
  const h = setup({ makeFactory: () => ({ get(id) { calls++; return failing ? Promise.reject(Error('load failed')) : Promise.resolve(buffers.get(id)); }, dispose() {} }) });
  h.update(0); await turn(); assert.equal(calls, 3);
  for (let i = 1; i < BIO_RETRY_SECONDS * 60; i++) h.update(i / 60);
  await turn(); assert.equal(calls, 3);
  h.update(BIO_RETRY_SECONDS); await turn(); assert.equal(calls, 6);
  failing = false; h.player.retry(); h.update(BIO_RETRY_SECONDS + .01); await turn();
  assert.equal(calls, 9); assert.equal(h.player.state.decodedCount, 3); h.player.dispose();
});

test('factory-construction failure is also bounded by backoff', () => {
  let attempts = 0;
  const h = setup({ makeFactory() { attempts++; throw Error('factory failed'); } });
  for (let i = 0; i < 60 * 14; i++) h.update(i / 60);
  assert.equal(attempts, 1); h.update(15); assert.equal(attempts, 2); h.player.dispose();
});

test('shared fog intensity attenuates only night dense calls to 40%, with continuous existing fades', () => {
  for (const seconds of [90, 270, 2790]) close(sampleBioGain(sampleAudioMix(at(seconds)), 100, at(seconds).timeOfDay), .135);
  for (const [seconds, factor] of [[900, 1], [906, .7], [912, .4], [1068, .4], [1074, .7], [1080, 1]])
    close(sampleBioGain(sampleAudioMix(at(seconds)), 100, at(seconds).timeOfDay), .135 * factor);
  close(sampleBioGain(sampleAudioMix(at(990)), 40, 'night'), .0216);
});

test('30 minutes retain at most six buffers and one voice, with no repeated preload; long frames are measured and dropped', async t => {
  const h = setup(); h.update(0); await turn();
  let maxNodes = 0, maxPCM = 0;
  for (let tick = 1; tick <= 1800 * 4; tick++) {
    const seconds = tick / 4;
    for (const source of [...h.live()].filter(n => n.type === 'source'))
      if (source.started && seconds + 1 >= source.startedAt + source.buffer.duration) source.onended?.();
    h.update(seconds); await turn();
    maxNodes = Math.max(maxNodes, h.live().length); maxPCM = Math.max(maxPCM, h.player.state.pcmBytes);
    assert(h.player.state.activeVoices <= 1); assert(h.player.state.decodedCount <= 6); assert(h.player.state.retainedCycles <= 1);
  }
  assert.equal(maxNodes, 2); assert.equal(maxPCM, 3360420); assert.equal(h.banks[0].gets.length, 6);
  assert(h.player.state.starts > 80);
  const before = h.player.state.starts;
  for (let i = 0; i < 10; i++) h.update(1801 + i);
  assert.equal(h.player.state.starts, before); assert.equal(h.player.state.largeSteps, 10);
  assert.equal(h.player.state.largestStepSeconds, 1);
  t.diagnostic(JSON.stringify({ simulatedSeconds: 1800, frameSeconds: .25, maxNodes, maxPCM,
    factoryGets: h.banks[0].gets.length, ...h.player.state }));
  h.player.dispose(); h.end(); assert.equal(h.live().length, 0); assert.equal(h.player.state.pcmBytes, 0);
});

test('bio component exceptions never change ambient playback state, settings, or regular loop lifecycle', async () => {
  const context = fakeContext(), clock = createGameClock();
  const session = createAudioSession({ createContext: () => context });
  let plays = 0, stops = 0, disposed = 0;
  const ambient = createAmbientAudio({ session, clock,
    preferencesStore: { load: () => ({ preferences: { version: 1, enabled: true, volume: 40 }, persistence: 'default' }), save: () => 'saved' },
    player: { play() { plays++; }, stop() { stops++; }, dispose() { disposed++; } },
    bioPlayer: { update() { throw Error('bio failure'); }, retry() { throw Error('retry failure'); }, dispose() { throw Error('dispose failure'); } } });
  await session.unlock(); ambient.update(); assert.equal(ambient.state.playback, 'playing'); assert(plays > 0);
  ambient.setPaused('menu', true); assert.equal(ambient.state.playback, 'paused'); assert(stops > 0);
  ambient.setPaused('menu', false); assert.equal(ambient.state.playback, 'playing');
  ambient.unlock(); await turn(); assert.equal(ambient.state.playback, 'playing');
  ambient.dispose(); session.dispose(); assert.equal(disposed, 1);
});

test('ordinary trusted unlock calls on a ready session do not bypass failed-load backoff', async () => {
  const context = fakeContext(); context.sampleRate = 44100;
  const clock = createGameClock(), session = createAudioSession({ createContext: () => context });
  let gets = 0;
  const bioPlayer = createBioPlayer({ clock, makeFactory: () => ({
    get() { gets++; return Promise.reject(Error('offline')); }, dispose() {},
  }) });
  const ambient = createAmbientAudio({ session, clock, bioPlayer,
    preferencesStore: { load: () => ({ preferences: { version: 1, enabled: true, volume: 40 }, persistence: 'default' }), save: () => 'saved' },
    player: { play() {}, stop() {}, dispose() {} } });
  await session.unlock(); await turn(); assert.equal(gets, 3);
  for (let i = 0; i < 100; i++) ambient.unlock();
  await turn(); assert.equal(gets, 3); assert.equal(ambient.state.playback, 'playing');
  context.change('interrupted'); ambient.unlock(); await turn();
  assert.equal(gets, 6); assert.equal(ambient.state.playback, 'playing');
  ambient.dispose(); session.dispose();
});
