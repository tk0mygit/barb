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
function wav16(samples, rate, edgeSeconds = .08) {
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, i) => {
    // Audition-file edges only; native output metrics below are untapered.
    const fade = edgeSeconds ? Math.max(0, Math.min(1, i / (rate * edgeSeconds), (samples.length - 1 - i) / (rate * edgeSeconds))) : 1;
    wav.writeInt16LE(Math.round(sample * fade * 32767), 44 + i * 2);
  });
  return wav;
}

for (const sourceId of ['bird-a', 'suzumushi-a']) {
  test(`native ${sourceId} start/volume/stop ramps remain continuous, including a mid-attack stop`, async ({ page }, info) => {
    await modules(page);
    const result = await page.evaluate(async sourceId => {
      const { createBioPlayer } = await import('./src/audio/bio-player.js');
      const { createGameClock } = await import('./src/game/game-clock.js');
      const { sampleAudioMix } = await import('./src/audio/audio-mix.js');
      const offline = new OfflineAudioContext(1, 48000, 48000);
      const base = sourceId === 'bird-a' ? 10 : 240, duration = sourceId === 'bird-a' ? 2.1 : 3.6, gains = [];
      let gameTime = base, event = null, source;
      const clock = { get state() { return createGameClock(undefined, { elapsedSeconds: gameTime }).state; } };
      const context = { sampleRate: 48000, get state() { return offline.state === 'closed' ? 'closed' : 'running'; }, get currentTime() { return offline.currentTime; },
        destination: offline.destination, addEventListener() {}, removeEventListener() {},
        createBufferSource() { return source = offline.createBufferSource(); }, createGain() {
          const gain = offline.createGain(); gains.push(gain);
          const disconnect = gain.disconnect.bind(gain);
          gain.disconnect = () => { gain.detached = true; disconnect(); }; return gain;
        } };
      const buffer = offline.createBuffer(1, 48000 * duration, 48000); buffer.getChannelData(0).fill(1);
      const player = createBioPlayer({ clock, makeFactory: () => ({ get: async () => buffer, dispose() {} }),
        scheduler: { state: { retainedCycleCount: 1 }, sync() {}, update() { return event; } } });
      const update = (volume = 100, playing = true) => player.update({ context, mix: sampleAudioMix(clock.state), volume, enabled: true, playing, ready: true });
      update(); for (let i = 0; i < 8; i++) await Promise.resolve();
      const suspend = offline.suspend(.1), rendering = offline.startRendering();
      await suspend; gameTime = base + .1;
      event = { eventId: 'quality-one', sourceId, scheduledSeconds: gameTime, latestStartSeconds: gameTime + .25,
        durationSeconds: duration, phaseEndSeconds: base < 180 ? 180 : 360, timeOfDay: base < 180 ? 'day' : 'night' };
      update(); await Promise.resolve();
      const second = offline.suspend(.12); await offline.resume(); await second;
      gameTime = base + .12; update(50);
      const third = offline.suspend(.14); await offline.resume(); await third;
      gameTime = base + .14; update(50, false); await offline.resume();
      const data = (await rendering).getChannelData(0);
      let peak = 0, maximumStep = 0, afterStopPeak = 0;
      for (let i = 0; i < data.length; i++) {
        peak = Math.max(peak, Math.abs(data[i]));
        if (i) maximumStep = Math.max(maximumStep, Math.abs(data[i] - data[i - 1]));
        if (i > .21 * 48000) afterStopPeak = Math.max(afterStopPeak, Math.abs(data[i]));
      }
      player.dispose();
      return { peak, maximumStep, afterStopPeak, first: data[0], last: data.at(-1), state: player.state,
        sourceBufferReleased: source.buffer === null, sourceHandlerReleased: source.onended === null,
        gainsAllocated: gains.length, allGainsDetached: gains.every(gain => gain.detached) };
    }, sourceId);
    const path = info.outputPath('native-bio-ramps.json'); writeFileSync(path, JSON.stringify(result, null, 2));
    await info.attach('native-bio-ramps', { path, contentType: 'application/json' });
    expect(result.peak).toBeGreaterThan(sourceId === 'bird-a' ? .04 : .0001);
    expect(result.peak).toBeLessThanOrEqual(sourceId === 'bird-a' ? .108001 : .003);
    expect(result.maximumStep).toBeLessThan(sourceId === 'bird-a' ? .00016 : .00001); expect(result.afterStopPeak).toBe(0);
    expect(result.first).toBe(0); expect(result.last).toBe(0); expect(result.state.activeVoices).toBe(0);
    expect(result.sourceBufferReleased).toBe(true); expect(result.sourceHandlerReleased).toBe(true);
    expect(result.gainsAllocated).toBe(sourceId === 'bird-a' ? 1 : 2); expect(result.allGainsDetached).toBe(true);
  });
}

for (const id of ['suzumushi-a', 'suzumushi-b', 'suzumushi-c']) {
  test(`native real ${id} follows smooth natural attack/sustain/release and frees its envelope`, async ({ page }, info) => {
    await modules(page);
    const result = await page.evaluate(async id => {
      const { createBioPlayer } = await import('./src/audio/bio-player.js');
      const { createBioSourceFactory } = await import('./src/audio/bio-sources.js');
      const { createGameClock } = await import('./src/game/game-clock.js');
      const { sampleAudioMix } = await import('./src/audio/audio-mix.js');
      const rate = 48000, offline = new OfflineAudioContext(1, rate * 5, rate), nodes = [];
      let source, gameTime = 240, event = null;
      const context = { sampleRate: rate, get state() { return offline.state === 'closed' ? 'closed' : 'running'; },
        get currentTime() { return offline.currentTime; }, destination: offline.destination,
        addEventListener() {}, removeEventListener() {}, decodeAudioData: (...args) => offline.decodeAudioData(...args),
        createBufferSource() {
          source = offline.createBufferSource(); nodes.push(source);
          const disconnect = source.disconnect.bind(source);
          source.disconnect = () => { source.detached = true; disconnect(); }; return source;
        },
        createGain() {
          const gain = offline.createGain(); nodes.push(gain);
          const disconnect = gain.disconnect.bind(gain);
          gain.disconnect = () => { gain.detached = true; disconnect(); }; return gain;
        } };
      const factory = createBioSourceFactory(context), buffer = await factory.get(id);
      await Promise.all(['suzumushi-a', 'suzumushi-b', 'suzumushi-c'].map(key => factory.get(key)));
      const clock = { get state() { return createGameClock(undefined, { elapsedSeconds: gameTime }).state; } };
      const player = createBioPlayer({ clock, makeFactory: () => factory,
        scheduler: { state: { retainedCycleCount: 1 }, sync() {}, update() { return event; } } });
      const update = () => player.update({ context, mix: sampleAudioMix(clock.state), volume: 100, enabled: true, playing: true, ready: true });
      update(); for (let i = 0; i < 8; i++) await Promise.resolve();
      gameTime = 240.01;
      event = { eventId: id, sourceId: id, scheduledSeconds: gameTime, latestStartSeconds: gameTime + .25,
        phaseEndSeconds: 360, timeOfDay: 'night' };
      update(); for (let i = 0; i < 8; i++) await Promise.resolve();
      const data = (await offline.startRendering()).getChannelData(0), raw = buffer.getChannelData(0);
      const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
      const regions = { attack: [0, .5], sustain: [.5, buffer.duration - .75], release: [buffer.duration - .75, buffer.duration] };
      const energy = Object.fromEntries(Object.keys(regions).map(key => [key, { raw: 0, actual: 0, expected: 0 }]));
      let peak = 0, rawPeak = 0, clipped = 0, maximumError = 0, maximumStep = 0, afterEndPeak = 0;
      for (let i = 0; i < data.length; i++) {
        const time = i / rate, normalized = (raw[i] ?? 0) * .108;
        const envelope = smooth(time / .5) * smooth((buffer.duration - time) / .75);
        const expected = normalized * Math.min(1, time / .04) * envelope;
        maximumError = Math.max(maximumError, Math.abs(data[i] - expected));
        peak = Math.max(peak, Math.abs(data[i])); rawPeak = Math.max(rawPeak, Math.abs(raw[i] ?? 0));
        if (Math.abs(data[i]) >= 1) clipped++;
        if (i) maximumStep = Math.max(maximumStep, Math.abs(data[i] - data[i - 1]));
        if (i >= raw.length) afterEndPeak = Math.max(afterEndPeak, Math.abs(data[i]));
        for (const [key, [start, end]] of Object.entries(regions)) if (time >= start && time < end) {
          energy[key].raw += normalized ** 2; energy[key].actual += data[i] ** 2; energy[key].expected += expected ** 2;
        }
      }
      player.dispose();
      return { stats: { id, rate, duration: buffer.duration, nodesAllocated: nodes.length, peak, rawPeak, clipped, maximumError, maximumStep,
        afterEndPeak, first: data[0], last: data.at(-1),
        ratios: Object.fromEntries(Object.entries(energy).map(([key, e]) => [key, {
          actual: Math.sqrt(e.actual / e.raw), expected: Math.sqrt(e.expected / e.raw) }])),
        allNodesDetached: nodes.every(n => n.detached), bufferReleased: source.buffer === null,
        handlerReleased: source.onended === null, voices: player.state.activeVoices, pcmBytes: player.state.pcmBytes },
      samples: Array.from(data.subarray(0, raw.length)) };
    }, id);
    const json = info.outputPath(`${id}-envelope.json`), wav = info.outputPath(`${id}-envelope.wav`);
    writeFileSync(json, JSON.stringify(result.stats, null, 2)); writeFileSync(wav, wav16(result.samples, result.stats.rate, 0));
    await info.attach(`${id}-envelope-metrics`, { path: json, contentType: 'application/json' });
    await info.attach(`${id}-envelope-audition`, { path: wav, contentType: 'audio/wav' });
    expect(result.stats.nodesAllocated).toBe(3); expect(result.stats.peak).toBeGreaterThan(.002);
    expect(result.stats.peak).toBeLessThanOrEqual(result.stats.rawPeak * .108 + 1e-7); expect(result.stats.clipped).toBe(0);
    // Compare native rendering with an analytic smoothstep, rather than the implementation's sampled curve.
    expect(result.stats.maximumError).toBeLessThan(.000001);
    expect(result.stats.ratios.sustain.actual).toBeCloseTo(1, 6);
    for (const key of ['attack', 'release']) {
      expect(result.stats.ratios[key].actual).toBeGreaterThan(0); expect(result.stats.ratios[key].actual).toBeLessThan(1);
      expect(result.stats.ratios[key].actual).toBeCloseTo(result.stats.ratios[key].expected, 4);
    }
    expect(Math.abs(result.stats.first)).toBe(0); expect(Math.abs(result.stats.last)).toBe(0); expect(result.stats.afterEndPeak).toBe(0);
    expect(result.stats.allNodesDetached).toBe(true); expect(result.stats.bufferReleased).toBe(true);
    expect(result.stats.handlerReleased).toBe(true); expect(result.stats.voices).toBe(0); expect(result.stats.pcmBytes).toBe(0);
  });
}

for (const [name, gameStart] of [['day', 90], ['night-clear', 240], ['night-dense', 960]]) {
  test('native real WAV/BGM/nature/bite mix peak and audition output: ' + name, async ({ page }, info) => {
    await modules(page);
    const result = await page.evaluate(async ({ gameStart }) => {
      const { createBioPlayer } = await import('./src/audio/bio-player.js');
      const { createBioSourceFactory, BIO_VARIANTS } = await import('./src/audio/bio-sources.js');
      const { createAmbientPlayer } = await import('./src/audio/ambient-player.js');
      const { createFishingAudio } = await import('./src/ui/fishing-audio.js');
      const { sampleAudioMix } = await import('./src/audio/audio-mix.js');
      const { createGameClock } = await import('./src/game/game-clock.js');
      const rate = 48000, seconds = 30, offline = new OfflineAudioContext(1, rate * seconds, rate);
      const sources = [], gains = [], bioBuffers = new Set(), stateListeners = new Set(), subscribers = new Set();
      let maxBio = 0, maxBite = 0, maxLoops = 0, maxSources = 0, decodes = 0, stats;
      const context = new EventTarget(), add = context.addEventListener.bind(context), remove = context.removeEventListener.bind(context);
      // Offline suspend/resume controls test frames, not a realtime interruption.
      // Keep native closure observable instead of presenting a permanently ready context.
      Object.defineProperties(context, {
        state: { get: () => offline.state === 'closed' ? 'closed' : 'running' },
        currentTime: { get: () => offline.currentTime },
      });
      Object.assign(context, { sampleRate: rate, destination: offline.destination,
        addEventListener(type, listener, options) { if (type === 'statechange') stateListeners.add(listener); add(type, listener, options); },
        removeEventListener(type, listener, options) { if (type === 'statechange') stateListeners.delete(listener); remove(type, listener, options); },
        createBuffer: (...args) => offline.createBuffer(...args),
        decodeAudioData: (...args) => { decodes++; return offline.decodeAudioData(...args); },
        createGain() {
          const gain = offline.createGain(), disconnect = gain.disconnect.bind(gain);
          gain.detached = false; gains.push(gain);
          gain.disconnect = () => { gain.detached = true; disconnect(); }; return gain;
        },
        createBufferSource() {
          const source = offline.createBufferSource(), start = source.start.bind(source), disconnect = source.disconnect.bind(source);
          source.live = true; sources.push(source);
          source.start = (...args) => {
            const pcm = source.buffer;
            source.voiceKind = source.loop ? 'loop' : bioBuffers.has(pcm) ? 'bio'
              : pcm?.numberOfChannels === 2 && Math.abs(pcm.duration - 1) <= 2 / rate ? 'bite' : 'unknown';
            source.startWhen = args[0] ?? context.currentTime; source.offset = args[1] ?? 0;
            source.bufferSeconds = pcm?.duration; return start(...args);
          };
          source.disconnect = () => { source.live = false; disconnect(); }; return source;
        },
      });
      const forwardState = () => context.dispatchEvent(new Event('statechange'));
      offline.addEventListener('statechange', forwardState);
      const session = {
        context,
        get status() { return context.state === 'running' ? 'ready' : 'interrupted'; },
        subscribe(listener) {
          const notify = () => listener(); subscribers.add(notify); context.addEventListener('statechange', notify);
          return () => { subscribers.delete(notify); context.removeEventListener('statechange', notify); };
        },
        unlock: async () => context.state === 'running',
      };
      const factory = createBioSourceFactory(context), clock = createGameClock(undefined, { elapsedSeconds: gameStart });
      const bio = createBioPlayer({ clock, makeFactory: () => factory }), ambient = createAmbientPlayer();
      let bite;
      try {
        for (const buffer of await Promise.all(BIO_VARIANTS.map(v => factory.get(v.id)))) bioBuffers.add(buffer);
        const bioDecodes = decodes, requests = [];
        bite = createFishingAudio({ session, fetcher: (url, options) => { requests.push(url); return fetch(url, options); } });
        const prepared = await bite.preload(); // Real Firefly WAV, native decoder; never substitute synthetic PCM.
        if (!prepared) throw Error('Native Firefly bite preload failed');
        const biteDecodes = decodes - bioDecodes, readyBeforeRender = session.status;
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
          maxBio = Math.max(maxBio, sources.filter(s => s.live && s.voiceKind === 'bio').length);
          maxBite = Math.max(maxBite, sources.filter(s => s.live && s.voiceKind === 'bite').length);
          maxLoops = Math.max(maxLoops, sources.filter(s => s.live && s.voiceKind === 'loop').length);
          maxSources = Math.max(maxSources, sources.filter(s => s.live).length);
          if (frame + 1 < seconds * 30) pending = offline.suspend((frame + 1) / 30);
          await offline.resume();
        }
        const data = (await rendered).getChannelData(0), notification = sources.filter(s => s.voiceKind === 'bite');
        const cue = notification[0];
        let peak = 0, rms = 0, clipped = 0, nonFinite = 0, maximumStep = 0, biteWindowPeak = 0;
        for (let i = 0; i < data.length; i++) {
          const value = data[i]; peak = Math.max(peak, Math.abs(value)); rms += value * value;
          if (!Number.isFinite(value)) nonFinite++;
          if (Math.abs(value) >= 1) clipped++; if (i) maximumStep = Math.max(maximumStep, Math.abs(value - data[i - 1]));
          if (cue && i / rate >= cue.startWhen && i / rate < cue.startWhen + cue.bufferSeconds - cue.offset)
            biteWindowPeak = Math.max(biteWindowPeak, Math.abs(value));
        }
        stats = { peak, rms: Math.sqrt(rms / data.length), clipped, nonFinite, maximumStep, maxBio, maxBite, maxLoops, maxSources,
          bio: bio.state, rawFirstSample: data[0], gameStart, volume: 100, rate, seconds, biteAtAudioSeconds: cue?.startWhen,
          unknownSources: sources.filter(s => !['loop', 'bio', 'bite'].includes(s.voiceKind)).length,
          bioSources: sources.filter(s => s.voiceKind === 'bio').length,
          bite: { prepared, readyBeforeRender, requests, bioDecodes, biteDecodes, totalDecodes: decodes,
            sourceCount: notification.length, offset: cue?.offset, sourceSeconds: cue?.bufferSeconds, windowPeak: biteWindowPeak } };
        return { stats, samples: Array.from(data) };
      } finally {
        bite?.dispose(); bio.dispose(); ambient.dispose(); factory.dispose(); bioBuffers.clear();
        offline.removeEventListener('statechange', forwardState);
        if (stats) stats.afterDispose = { bioVoices: bio.state.activeVoices, pcmBytes: bio.state.pcmBytes,
          connectedSources: sources.filter(s => s.live).length,
          handlersReleased: sources.every(s => s.onended === null), buffersReleased: sources.every(s => s.buffer === null),
          biteVoices: sources.filter(s => s.live && s.voiceKind === 'bite').length,
          allGainsDetached: gains.every(gain => gain.detached), sessionSubscriptions: subscribers.size,
          contextListeners: stateListeners.size, biteUnavailable: await bite.preload() === false };
      }
    }, { gameStart });
    const json = info.outputPath('bio-' + name + '.json'), wav = info.outputPath('bio-' + name + '.wav');
    writeFileSync(json, JSON.stringify(result.stats, null, 2)); writeFileSync(wav, wav16(result.samples, result.stats.rate));
    await info.attach('bio-' + name + '-metrics', { path: json, contentType: 'application/json' });
    await info.attach('bio-' + name + '-audition', { path: wav, contentType: 'audio/wav' });
    expect(result.stats.peak).toBeGreaterThan(.05); expect(result.stats.peak).toBeLessThan(.25);
    expect(result.stats.clipped).toBe(0); expect(result.stats.nonFinite).toBe(0); expect(Math.abs(result.stats.rawFirstSample)).toBe(0);
    expect(Number.isFinite(result.stats.rms)).toBe(true);
    expect(result.stats.maxLoops).toBe(3); expect(result.stats.maxBio).toBe(1); expect(result.stats.maxBite).toBe(1);
    expect(result.stats.maxSources).toBeLessThanOrEqual(5); expect(result.stats.unknownSources).toBe(0);
    expect(result.stats.bio.starts).toBeGreaterThan(0); expect(result.stats.bioSources).toBe(result.stats.bio.starts);
    expect(result.stats.bite.prepared).toBe(true); expect(result.stats.bite.readyBeforeRender).toBe('ready');
    expect(result.stats.bite.requests).toHaveLength(1);
    expect(new URL(result.stats.bite.requests[0]).pathname).toBe('/barb/src/assets/audio/bite/waterdrop.wav');
    expect(result.stats.bite.bioDecodes).toBe(6); expect(result.stats.bite.biteDecodes).toBe(1); expect(result.stats.bite.totalDecodes).toBe(7);
    expect(result.stats.bite.sourceCount).toBe(1); expect(result.stats.bite.offset).toBe(.02);
    expect(result.stats.bite.sourceSeconds).toBe(1);
    expect(result.stats.biteAtAudioSeconds).toBeGreaterThanOrEqual(7.2);
    expect(result.stats.biteAtAudioSeconds).toBeLessThanOrEqual(7.2 + 128 / result.stats.rate);
    // Stereo-to-mono PCM peak 0.89453125 * 0.2, with <0.061 background headroom.
    expect(result.stats.bite.windowPeak).toBeGreaterThan(.11); expect(result.stats.bite.windowPeak).toBeLessThan(.25);
    expect(result.stats.afterDispose).toEqual({ bioVoices: 0, pcmBytes: 0, connectedSources: 0, handlersReleased: true, buffersReleased: true,
      biteVoices: 0, allGainsDetached: true, sessionSubscriptions: 0, contextListeners: 0, biteUnavailable: true });
  });
}
