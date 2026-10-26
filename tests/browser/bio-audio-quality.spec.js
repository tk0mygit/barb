import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from './diagnostics-fixture.js';

async function modules(page) {
  await page.route('**/barb/src/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/barb/', '../../');
    return route.fulfill({ body: readFileSync(new URL(path, import.meta.url)),
      contentType: path.endsWith('.json') ? 'application/json' : path.endsWith('.wav') ? 'audio/wav' : 'text/javascript' });
  });
  await page.route('**/barb/bio-quality.html', route => route.fulfill({ body: '<!doctype html><title>Native bio quality</title>', contentType: 'text/html' }));
  await page.goto('./bio-quality.html');
}
function wav16(samples, rate) {
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, i) => {
    // Audition-file edges only; native output metrics below are untapered.
    const fade = Math.max(0, Math.min(1, i / (rate * .08), (samples.length - 1 - i) / (rate * .08)));
    wav.writeInt16LE(Math.round(sample * fade * 32767), 44 + i * 2);
  });
  return wav;
}

test('native bio start/volume/stop ramps remain continuous, including a mid-attack stop', async ({ page }, info) => {
  await modules(page);
  const result = await page.evaluate(async () => {
    const { createBioPlayer } = await import('./src/audio/bio-player.js');
    const { createGameClock } = await import('./src/game/game-clock.js');
    const { sampleAudioMix } = await import('./src/audio/audio-mix.js');
    const offline = new OfflineAudioContext(1, 48000, 48000);
    let gameTime = 10, event = null, source;
    const clock = { get state() { return createGameClock(undefined, { elapsedSeconds: gameTime }).state; } };
    const context = { sampleRate: 48000, get state() { return offline.state === 'closed' ? 'closed' : 'running'; }, get currentTime() { return offline.currentTime; },
      destination: offline.destination, addEventListener() {}, removeEventListener() {},
      createBufferSource() { return source = offline.createBufferSource(); }, createGain: () => offline.createGain() };
    const buffer = offline.createBuffer(1, 48000 * 2.1, 48000); buffer.getChannelData(0).fill(1);
    const player = createBioPlayer({ clock, makeFactory: () => ({ get: async () => buffer, dispose() {} }),
      scheduler: { state: { retainedCycleCount: 1 }, sync() {}, update() { return event; } } });
    const update = (volume = 100, playing = true) => player.update({ context, mix: sampleAudioMix(clock.state), volume, enabled: true, playing, ready: true });
    update(); for (let i = 0; i < 8; i++) await Promise.resolve();
    const suspend = offline.suspend(.1), rendering = offline.startRendering();
    await suspend; gameTime = 10.1;
    event = { eventId: 'quality-one', sourceId: 'bird-a', scheduledSeconds: 10.1, latestStartSeconds: 10.35,
      durationSeconds: 2.1, phaseEndSeconds: 180, timeOfDay: 'day' };
    update(); await Promise.resolve();
    const second = offline.suspend(.12); await offline.resume(); await second;
    gameTime = 10.12; update(50);
    const third = offline.suspend(.14); await offline.resume(); await third;
    gameTime = 10.14; update(50, false); await offline.resume();
    const data = (await rendering).getChannelData(0);
    let peak = 0, maximumStep = 0, afterStopPeak = 0;
    for (let i = 0; i < data.length; i++) {
      peak = Math.max(peak, Math.abs(data[i]));
      if (i) maximumStep = Math.max(maximumStep, Math.abs(data[i] - data[i - 1]));
      if (i > .21 * 48000) afterStopPeak = Math.max(afterStopPeak, Math.abs(data[i]));
    }
    player.dispose();
    return { peak, maximumStep, afterStopPeak, first: data[0], last: data.at(-1), state: player.state,
      sourceBufferReleased: source.buffer === null, sourceHandlerReleased: source.onended === null };
  });
  const path = info.outputPath('native-bio-ramps.json'); writeFileSync(path, JSON.stringify(result, null, 2));
  await info.attach('native-bio-ramps', { path, contentType: 'application/json' });
  expect(result.peak).toBeGreaterThan(.05); expect(result.peak).toBeLessThanOrEqual(.135001);
  expect(result.maximumStep).toBeLessThan(.0002); expect(result.afterStopPeak).toBe(0);
  expect(result.first).toBe(0); expect(result.last).toBe(0); expect(result.state.activeVoices).toBe(0);
  expect(result.sourceBufferReleased).toBe(true); expect(result.sourceHandlerReleased).toBe(true);
});

for (const [name, gameStart] of [['day', 90], ['night-clear', 240], ['night-dense', 960]]) {
  test(`native real WAV/BGM/nature/bite mix peak and audition output: ${name}`, async ({ page }, info) => {
    await modules(page);
    const result = await page.evaluate(async ({ gameStart }) => {
      const { createBioPlayer } = await import('./src/audio/bio-player.js');
      const { createBioSourceFactory, BIO_VARIANTS } = await import('./src/audio/bio-sources.js');
      const { createAmbientPlayer } = await import('./src/audio/ambient-player.js');
      const { createFishingAudio } = await import('./src/ui/fishing-audio.js');
      const { sampleAudioMix } = await import('./src/audio/audio-mix.js');
      const { createGameClock } = await import('./src/game/game-clock.js');
      const rate = 48000, seconds = 30, offline = new OfflineAudioContext(1, rate * seconds, rate);
      const sources = []; let maxBio = 0, maxLoops = 0;
      const context = { sampleRate: rate, get state() { return offline.state === 'closed' ? 'closed' : 'running'; }, get currentTime() { return offline.currentTime; },
        destination: offline.destination, addEventListener() {}, removeEventListener() {},
        createBuffer: (...args) => offline.createBuffer(...args), decodeAudioData: (...args) => offline.decodeAudioData(...args),
        createGain: () => offline.createGain(), createOscillator: () => offline.createOscillator(),
        createBufferSource() {
          const s = offline.createBufferSource(); s.live = true; sources.push(s);
          const disconnect = s.disconnect.bind(s); s.disconnect = () => { s.live = false; disconnect(); }; return s;
        } };
      const factory = createBioSourceFactory(context);
      await Promise.all(BIO_VARIANTS.map(v => factory.get(v.id))); // eliminate test I/O timing, use native decoded originals
      const clock = createGameClock(undefined, { elapsedSeconds: gameStart });
      const bio = createBioPlayer({ clock, makeFactory: () => factory });
      const ambient = createAmbientPlayer(), bite = createFishingAudio({ session: { context } });
      const update = () => {
        const state = clock.state, mix = sampleAudioMix(state);
        ambient.play(context, mix, 100, state.elapsedSeconds);
        bio.update({ context, mix, volume: 100, enabled: true, playing: true, ready: true });
      };
      update(); for (let i = 0; i < 8; i++) await Promise.resolve();
      let pending = offline.suspend(1 / 30), prior = 0;
      const rendered = offline.startRendering();
      let bitten = false;
      for (let frame = 1; frame < seconds * 30; frame++) {
        await pending;
        const now = offline.currentTime; clock.step(now - prior); prior = now;
        update(); await Promise.resolve();
        if (!bitten && now >= 7.2) { bite.bite(); bitten = true; }
        maxBio = Math.max(maxBio, sources.filter(s => s.live && s.loop === false).length);
        maxLoops = Math.max(maxLoops, sources.filter(s => s.live && s.loop === true).length);
        if (frame + 1 < seconds * 30) pending = offline.suspend((frame + 1) / 30);
        await offline.resume();
      }
      const data = (await rendered).getChannelData(0);
      let peak = 0, rms = 0, clipped = 0, maximumStep = 0;
      for (let i = 0; i < data.length; i++) {
        const value = data[i]; peak = Math.max(peak, Math.abs(value)); rms += value * value;
        if (Math.abs(value) >= 1) clipped++; if (i) maximumStep = Math.max(maximumStep, Math.abs(value - data[i - 1]));
      }
      const stats = { peak, rms: Math.sqrt(rms / data.length), clipped, maximumStep, maxBio, maxLoops,
        bio: bio.state, rawFirstSample: data[0], gameStart, volume: 100, rate, seconds, biteAtAudioSeconds: 7.2 };
      bio.dispose(); ambient.dispose();
      stats.afterDispose = { bioVoices: bio.state.activeVoices, pcmBytes: bio.state.pcmBytes,
        connectedSources: sources.filter(s => s.live).length,
        handlersReleased: sources.every(s => s.onended === null), buffersReleased: sources.every(s => s.buffer === null) };
      return { stats, samples: Array.from(data) };
    }, { gameStart });
    const json = info.outputPath(`bio-${name}.json`), wav = info.outputPath(`bio-${name}.wav`);
    writeFileSync(json, JSON.stringify(result.stats, null, 2)); writeFileSync(wav, wav16(result.samples, result.stats.rate));
    await info.attach(`bio-${name}-metrics`, { path: json, contentType: 'application/json' });
    await info.attach(`bio-${name}-audition`, { path: wav, contentType: 'audio/wav' });
    expect(result.stats.peak).toBeGreaterThan(.05); expect(result.stats.peak).toBeLessThan(.25);
    expect(result.stats.clipped).toBe(0); expect(Math.abs(result.stats.rawFirstSample)).toBe(0);
    expect(result.stats.maxLoops).toBe(3); expect(result.stats.maxBio).toBe(1);
    expect(result.stats.bio.starts).toBeGreaterThan(0);
    expect(result.stats.afterDispose).toEqual({ bioVoices: 0, pcmBytes: 0, connectedSources: 0, handlersReleased: true, buffersReleased: true });
  });
}
