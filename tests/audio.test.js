import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGameClock } from '../src/game/game-clock.js';
import { sampleNightFog, FOG_TYPE } from '../src/world/night-fog.js';
import { sampleAudioMix, NATURE_BASE_GAIN } from '../src/audio/audio-mix.js';
import { createAudioSession } from '../src/audio/audio-session.js';
import { createAmbientAudio } from '../src/audio/ambient-audio.js';
import { createAmbientPlayer, AMBIENT_GAIN, AUDIO_FADE_SECONDS } from '../src/audio/ambient-player.js';
import { createGeneratedBuffers } from '../src/audio/generated-sources.js';
import { createFishingAudio, BITE_GAIN, BITE_OFFSET_SECONDS } from '../src/ui/fishing-audio.js';
import { fakeContext, fakeTimers } from './helpers/audio-fakes.js';
import { biteContext, fetchBite, readPcm, biteWav } from './helpers/bite-audio-fixture.js';
import { BIO_VARIANTS } from '../src/audio/bio-source-assets.js';
import { BIO_VOICE_GAIN } from '../src/audio/bio-player.js';

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
    const dense = fog.fogType === FOG_TYPE.DENSE_FOG ? fog.intensity : 0;
    near(target.day + target.night, 1 - dense);
    near(target.nature, NATURE_BASE_GAIN + (1 - NATURE_BASE_GAIN) * dense);
    near(target.day + target.night + target.nature, 1 + NATURE_BASE_GAIN * (1 - dense));
    assert.ok([target.day, target.night, target.nature].every(n => n >= 0 && n <= 1));
  }
  for (const [second, nature] of [[900, 0.25], [906, 0.625], [912, 1], [1068, 1], [1074, 0.625], [1080, 0.25]]) near(sampleAudioMix(at(second)).nature, nature);
  for (const boundary of [180, 360, 900, 1080]) {
    const a = sampleAudioMix(at(boundary - 1e-6)), b = sampleAudioMix(at(boundary + 1e-6));
    for (const kind of ['day', 'night', 'nature']) near(a[kind], b[kind], 1e-6);
  }
});

test('independent nature layer preserves full BGM and the exact 16s twilight envelope', () => {
  assert.equal(NATURE_BASE_GAIN, 0.25);
  for (const [second, day, night] of [[90, 1, 0], [172, 1, 0], [176, 0.84375, 0.15625],
    [180, 0.5, 0.5], [184, 0.15625, 0.84375], [188, 0, 1], [270, 0, 1],
    [352, 0, 1], [356, 0.15625, 0.84375], [360, 0.5, 0.5], [364, 0.84375, 0.15625], [368, 1, 0], [2790, 0, 1]]) {
    const mix = sampleAudioMix(at(second));
    near(mix.day, day); near(mix.night, night); near(mix.nature, 0.25);
  }
  // Dense fades retain their 12s endpoints and reverse symmetrically.
  for (const [second, bgm, nature] of [[903, 0.84375, 0.3671875], [906, 0.5, 0.625],
    [909, 0.15625, 0.8828125], [912, 0, 1], [1068, 0, 1],
    [1071, 0.15625, 0.8828125], [1074, 0.5, 0.625], [1077, 0.84375, 0.3671875]]) {
    const mix = sampleAudioMix(at(second));
    near(mix.day + mix.night, bgm); near(mix.nature, nature);
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
  assert.equal(ambient.state.playback, 'playing'); near(calls.at(-1)[2].nature, 0.625);
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

test('bite uses prepared Firefly PCM once on its own path; all failures are contained', async () => {
  const context = biteContext(), session = createAudioSession({ createContext: () => context });
  const bite = createFishingAudio({ session, fetcher: fetchBite });
  bite.bite(); assert.equal(context.nodes.length, 0);
  await bite.unlock(); assert.equal(await bite.preload(), true); bite.bite();
  const [source, gain] = context.nodes;
  assert.equal(source.type, 'source'); assert.equal(source.loop, false);
  assert.equal(source.buffer.duration, 1); assert.equal(source.startWhen, context.currentTime);
  assert.equal(source.offset, BITE_OFFSET_SECONDS);
  near(source.stopTime, 1 + source.buffer.duration - BITE_OFFSET_SECONDS);
  assert.deepEqual(gain.gain.events, [['set', 0, 1], ['linear', BITE_GAIN, 1.001],
    ['set', BITE_GAIN, 1.975], ['linear', 0, 1.98]]);
  assert.equal(gain.connections[0], context.destination);
  source.onended(); assert.ok(source.disconnected && gain.disconnected); assert.equal(source.buffer, null);
  context.createGain = () => { throw Error('allocation'); };
  assert.doesNotThrow(() => bite.bite()); assert.ok(context.nodes.at(-1).disconnected);
  context.change('interrupted'); assert.doesNotThrow(() => bite.bite()); bite.dispose(); session.dispose();
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
      assert.equal(fog.mode, 'NIGHT_FOG'); assert.equal(fog.nature, NATURE_BASE_GAIN);
      near(fog.day, clear.day); near(fog.night, clear.night);
    }
    const dense = sampleAudioMix(at(360 + 180 + phase));
    assert.equal(dense.mode, 'NIGHT_DENSE_FOG');
    near(dense.day + dense.night, 1 - dense.intensity);
    near(dense.nature, NATURE_BASE_GAIN + (1 - NATURE_BASE_GAIN) * dense.intensity);
  }
  const dense = sampleAudioMix(at(630)); assert.equal(dense.night, 0); assert.equal(dense.day, 0); assert.equal(dense.nature, 1);
});

test('layered PCM bounds target/independent-ramp peaks and normal RMS increase below 0.2dB', () => {
  const pcm = Object.fromEntries(Object.entries(createGeneratedBuffers(fakeContext()))
    .map(([kind, buffer]) => [kind, buffer.getChannelData(0)]));
  const peaks = {}, rms = {};
  for (const [kind, data] of Object.entries(pcm)) {
    let peak = 0, energy = 0;
    for (const value of data) { peak = Math.max(peak, Math.abs(value)); energy += value ** 2; }
    peaks[kind] = peak; rms[kind] = Math.sqrt(energy / data.length);
  }
  // Triangle inequality for every loop phase and dense/twilight target mix.
  const bound = AMBIENT_GAIN * Math.max(Math.max(peaks.day, peaks.night)
    + NATURE_BASE_GAIN * peaks.nature, peaks.nature);
  assert.ok(bound < 0.04, `ambient peak bound ${bound}`);
  const bitePeak = Math.max(...readPcm(biteWav).data.map(data => data.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0))) * BITE_GAIN;
  near(bitePeak, 0.196875);
  assert.ok(bound + bitePeak < 0.24, `ambient + measured bite peak bound ${bound + bitePeak}`);
  // Retargets may leave channels at different points in their 80ms ramps.
  // Each stays in [0, 1], so this conservative bound also covers rapid jumps.
  const rampBound = AMBIENT_GAIN * (peaks.day + peaks.night + peaks.nature);
  assert.ok(rampBound < 0.1, `independent ramp peak bound ${rampBound}`);
  assert.ok(rampBound + bitePeak < 0.30, `ramp + measured bite peak bound ${rampBound + bitePeak}`);
  const bioPeak = Math.max(...BIO_VARIANTS.map(variant => readPcm(readFileSync(
    new URL('../src/assets/audio/bio/' + variant.file, import.meta.url))).data[0]
    .reduce((peak, value) => Math.max(peak, Math.abs(value)), 0)));
  const bioBound = bioPeak * BIO_VOICE_GAIN * AMBIENT_GAIN; // At most one bio voice at volume 100.
  assert.ok(bioBound < 0.021);
  assert.ok(bound + bitePeak + bioBound < 0.27);
  assert.ok(rampBound + bitePeak + bioBound < 0.32);
  // The decoder accepts resampling overshoot only up to 1.25 (bite output 0.25).
  assert.ok(rampBound + 1.25 * BITE_GAIN + bioBound < 0.37);
  for (const kind of ['day', 'night']) {
    const relativeDb = 20 * Math.log10(NATURE_BASE_GAIN * rms.nature / rms[kind]);
    assert.ok(relativeDb > -15.3 && relativeDb < -13.6, `${kind}: nature relative RMS ${relativeDb}dB`);
    let energy = 0, peak = 0;
    for (let i = 0; i < pcm[kind].length; i++) {
      const value = (pcm[kind][i] + NATURE_BASE_GAIN * pcm.nature[i]) * AMBIENT_GAIN;
      assert.ok(Number.isFinite(value));
      energy += value ** 2; peak = Math.max(peak, Math.abs(value));
    }
    const changeDb = 20 * Math.log10(Math.sqrt(energy / pcm[kind].length) / (rms[kind] * AMBIENT_GAIN));
    assert.ok(changeDb >= 0 && changeDb < 0.2, `${kind}: mixed RMS change ${changeDb}dB`);
    assert.ok(peak < 0.04, `${kind}: mixed peak ${peak}`);
  }
});


// Golden observations of accepted F-0 solo/night-b.wav (SHA documented in
// night-source.js); these are reference data, not a second synthesis algorithm.
test('night B preserves the accepted score, level, phase and short seam correction', () => {
  const context = fakeContext(), buffers = createGeneratedBuffers(context);
  const data = buffers.night.getChannelData(0), repeated = createGeneratedBuffers(fakeContext()).night;
  assert.equal(buffers.night.sampleRate, 22050); assert.equal(buffers.night.numberOfChannels, 1);
  assert.equal(data.length, 529200); assert.equal(buffers.night.duration, 24);
  assert.deepEqual(data, repeated.getChannelData(0));
  const approvedSamples = [
    -0.0087890625, 0.0117492676, -0.0237426758, 0.0275573730, -0.0250854492, 0.0154418945, -0.0253295898, -0.0086975098,
    0.0211791992, -0.0127563477, -0.0012512207, 0.0164184570, -0.0219421387, 0.0065307617, 0.0010986328, 0.0015563965,
    0.0030212402, -0.0493774414, 0.0193786621, -0.0012207031, -0.0013122559, 0.0111999512, -0.0296325684, 0.0297851562,
    -0.0250244141, 0.0043029785, 0.0314331055, -0.0454406738, 0.0213317871, -0.0001525879, -0.0060729980, 0.0164489746,
    -0.0190124512, 0.0094909668, -0.0138854980, 0.0393676758, 0.0319824219, -0.0093383789, 0.0459289551, -0.0153808594,
    0.0204467773, 0.0344848633, -0.0391235352, 0.0292663574, -0.0020751953, -0.0040893555, 0.0247802734, -0.0200500488,
    0.0045471191, -0.0073242188, -0.0169677734, -0.0133972168, -0.0010375977, 0.0425720215, -0.0329284668, 0.0105895996,
    0.0119323730, -0.0398864746, 0.0403137207, -0.0133056641, -0.0084838867, 0.0043640137, -0.0046386719, -0.0014953613,
    -0.0039672852, 0.0161132812, -0.0095214844, 0.0254821777, -0.0022583008, -0.0188598633, 0.0297851562, -0.0365905762,
    0.0218200684, 0.0296020508, -0.0283203125, -0.0005493164, 0.0142211914, -0.0153503418, 0.0248413086, -0.0175781250,
    -0.0049743652, 0.0041503906, 0.0098266602, -0.0031127930, -0.0342407227, 0.0408325195, -0.0318908691, 0.0117492676,
    0.0231018066, -0.0355834961, 0.0273742676, -0.0217590332, 0.0054016113, 0.0243225098, -0.0320739746, 0.0138854980,
  ];
  approvedSamples.forEach((value, i) => near(data[221 + (i * 7919 + 173) % (data.length - 221)], value, 1 / 32768 + 1e-8));
  const approvedSecondRms = [
    // First observation excludes the 221-sample intentional seam correction.
    0.0249281587, 0.0246711024, 0.0367444657, 0.0312966753, 0.0269346094, 0.0265661144,
    0.0312063399, 0.0263114686, 0.0244886215, 0.0235403080, 0.0231517289, 0.0228787067,
    0.0287679761, 0.0294110092, 0.0248018780, 0.0233790238, 0.0228549237, 0.0254853203,
    0.0265598813, 0.0238122219, 0.0231173981, 0.0251379191, 0.0279754580, 0.0257497829,
  ];
  let energy = 0, dc = 0, peak = 0, minimumWindowRms = Infinity;
  for (let second = 0; second < 24; second++) {
    let localEnergy = 0;
    for (let i = second * 22050; i < (second + 1) * 22050; i++) {
      const value = data[i];
      if (i >= 221) localEnergy += value * value;
      energy += value * value; dc += value; peak = Math.max(peak, Math.abs(value));
    }
    near(Math.sqrt(localEnergy / (22050 - (second === 0 ? 221 : 0))), approvedSecondRms[second], 2e-7);
  }
  near(Math.sqrt(energy / data.length), .02643965138531395, 2e-7);
  near(peak, .09246826171875, 1 / 32768); assert.ok(Math.abs(dc / data.length) < 1e-6);
  for (let i = 0; i + 1103 <= data.length; i += 1103) {
    let local = 0; for (let j = i; j < i + 1103; j++) local += data[j] ** 2;
    minimumWindowRms = Math.min(minimumWindowRms, Math.sqrt(local / 1103));
  }
  assert.ok(minimumWindowRms > .02, `night 50ms RMS ${minimumWindowRms}`);
  near(data[0], data.at(-1), 1e-6);
  // With the endpoints equal, the two wrap curvatures reduce to these slopes.
  assert.ok(Math.abs(data[1] - data[0]) < .00015);
  assert.ok(Math.abs(data.at(-1) - data.at(-2)) < .00015);
});

test('accepted night keeps one real PCM bank across updates/menu and frees it on OFF/context replacement', () => {
  const context = fakeContext(); context.change('running');
  const timers = fakeTimers(); let generations = 0;
  const player = createAmbientPlayer({ ...timers, makeBuffers(owner) {
    generations++; const buffers = createGeneratedBuffers(owner);
    assert.equal(Object.values(buffers).reduce((sum, buffer) => sum + buffer.length * 4, 0), 6350400);
    return buffers;
  } });
  for (let i = 0; i < 120; i++) player.play(context, sampleAudioMix(at(240 + i / 60)), i % 2 ? 40 : 100, 240 + i / 60);
  assert.equal(generations, 1); assert.equal(context.nodes.filter(n => n.type === 'source').length, 3);
  player.stop(); timers.flush(); player.play(context, sampleAudioMix(at(241.337)), 40, 241.337);
  assert.equal(generations, 1); near(context.nodes.filter(n => n.type === 'source').at(-1).offset, 241.337 % 24);
  player.stop({ freeBuffers: true }); timers.flush();
  assert.ok(context.nodes.filter(n => n.type === 'source').every(n => n.buffer === null && n.disconnected));
  player.play(context, sampleAudioMix(at(242)), 40, 242); assert.equal(generations, 2);
  const next = fakeContext(); next.change('running'); player.play(next, sampleAudioMix(at(243)), 40, 243);
  assert.equal(generations, 3); assert.ok(context.nodes.every(n => n.disconnected));
  player.dispose(); assert.ok(next.nodes.filter(n => n.type === 'source').every(n => n.buffer === null && n.disconnected));
});
