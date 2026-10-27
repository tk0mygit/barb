import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from './diagnostics-fixture.js';

async function loadAudioModules(page) {
  // Serve the actual production modules through test-only routes, as in the UI
  // fixture. No game hooks or source changes are needed for offline rendering.
  await page.route('**/barb/src/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/barb/', '../../');
    const contentType = path.endsWith('.json') ? 'application/json' : path.endsWith('.wav') ? 'audio/wav' : 'text/javascript';
    return route.fulfill({ body: readFileSync(new URL(path, import.meta.url)), contentType });
  });
  await page.route('**/barb/audio-gain.html', route => route.fulfill({ body: '<!doctype html><title>Offline gain verification</title>', contentType: 'text/html' }));
  await page.goto('./audio-gain.html');
}

test('native offline gain output stays continuous at 30/60/144fps and irregular updates, including pause/resume', async ({ page }, info) => {
  await loadAudioModules(page);
  const results = await page.evaluate(async () => {
    const { createAmbientPlayer, AMBIENT_GAIN } = await import('./src/audio/ambient-player.js');
    const { sampleAudioMix, NATURE_BASE_GAIN } = await import('./src/audio/audio-mix.js');
    const { createGameClock } = await import('./src/game/game-clock.js');
    const results = [], rate = 22050, duration = 52;
    for (const fallback of [false, true]) {
      for (const cadence of [30, 60, 144, 'irregular']) {
        const offline = new OfflineAudioContext(1, rate * duration, rate);
        let sources = 0, generations = 0, timer, peakSources = 0, liveSources = 0;
        const gains = [];
        // Offline rendering is suspended at each simulated browser callback.
        // The facade retains the realtime player's running state while native
        // AudioParam automation and the audio clock remain entirely real.
        const context = {
          state: 'running', destination: offline.destination,
          get currentTime() { return offline.currentTime; },
          createGain() {
            const gain = offline.createGain(); gains.push(gain);
            if (fallback) gain.gain.cancelAndHoldAtTime = undefined;
            return gain;
          },
          createBufferSource() {
            const source = offline.createBufferSource(); sources++; liveSources++;
            peakSources = Math.max(peakSources, liveSources);
            const disconnect = source.disconnect.bind(source);
            source.disconnect = () => { liveSources--; disconnect(); };
            return source;
          },
        };
        const player = createAmbientPlayer({
          makeBuffers() {
            generations++;
            // Constant PCM makes every gap/discontinuity attributable to gain
            // automation rather than musical rests. Exercise actual 24s loops.
            const buffer = offline.createBuffer(1, rate * 24, rate);
            buffer.getChannelData(0).fill(1);
            return { day: buffer, night: buffer, nature: buffer };
          },
          setTimer(fn) { timer = fn; return 1; },
          clearTimer() { timer = undefined; },
        });
        const play = () => {
          // Start two seconds before dawn's 16s transition, so the initial
          // 80ms fade can be measured independently of changing mix targets.
          const clock = createGameClock(undefined, { elapsedSeconds: 350 + offline.currentTime }).state;
          player.play(context, sampleAudioMix(clock), 40, clock.elapsedSeconds);
        };
        play();
        const events = [], irregular = [1 / 144, 1 / 30, 0.19, 1 / 60, 0.009, 0.07, 0.25];
        let time = 0, frame = 0;
        while (time < 18) {
          time += cadence === 'irregular' ? irregular[frame++ % irregular.length] : 1 / cadence;
          if (time < 18) events.push({ time, action: play, label: 'mix-update' });
        }
        events.push({ time: 18.1, action: play, label: 'crossfade-end' },
          { time: 19, action: () => player.stop(), label: 'pause' },
          { time: 19.04, action: play, label: 'resume-mid-fade' }, // cancel a pending release mid-fade
          { time: 20, action: () => player.stop(), label: 'full-pause' },
          { time: 20.12, action: () => { timer?.(); timer = undefined; }, label: 'release-after-fade' },
          { time: 20.2, action: play, label: 'resume-after-release' }, // rebuild nodes, reuse PCM
          { time: 24.2, action: play, label: 'loop-update' }, { time: 48.2, action: play, label: 'loop-update' });
        let suspended = offline.suspend(events[0].time);
        const rendering = offline.startRendering();
        for (let i = 0; i < events.length; i++) {
          await suspended;
          events[i].actualTime = offline.currentTime;
          events[i].action();
          if (events[i + 1]) suspended = offline.suspend(events[i + 1].time);
          await offline.resume();
        }
        const data = (await rendering).getChannelData(0);
        const range = (start, end) => data.subarray(Math.ceil(start * rate), Math.floor(end * rate));
        const extremes = values => {
          let min = Infinity, max = -Infinity;
          for (const value of values) { min = Math.min(min, value); max = Math.max(max, value); }
          return { min, max };
        };
        let maximumStep = 0, maximumStepIndex = 0, crossfadeMinimumIndex = Math.ceil(0.12 * rate);
        for (let i = 1; i < data.length; i++) {
          const step = Math.abs(data[i] - data[i - 1]);
          if (step > maximumStep) { maximumStep = step; maximumStepIndex = i; }
          if (i >= 0.12 * rate && i < 18.9 * rate && data[i] < data[crossfadeMinimumIndex]) crossfadeMinimumIndex = i;
        }
        results.push({ cadence, fallback, initial: data[0], initialMidFade: data[Math.round(0.04 * rate)],
          crossfade: extremes(range(0.12, 18.9)), fullPause: extremes(range(20.095, 20.115)),
          repeatedLoops: extremes(range(21, 51.9)), maximumStep, sources, peakSources, generations,
          maximumStepTime: maximumStepIndex / rate,
          maximumStepAction: events.filter(event => event.actualTime <= maximumStepIndex / rate).at(-1)?.label ?? 'initial-play',
          stepSamples: [...data.subarray(Math.max(0, maximumStepIndex - 2), maximumStepIndex + 3)],
          crossfadeMinimumTime: crossfadeMinimumIndex / rate,
          crossfadeMinimumAction: events.filter(event => event.actualTime <= crossfadeMinimumIndex / rate).at(-1)?.label ?? 'initial-play',
          liveSources, gains: gains.length, expectedLevel: AMBIENT_GAIN * 0.4 * (1 + NATURE_BASE_GAIN) });
        player.dispose();
      }
    }
    return results;
  });
  const path = info.outputPath('native-gain-cadences.json');
  writeFileSync(path, JSON.stringify(results, null, 2));
  await info.attach('native-gain-cadences', { path, contentType: 'application/json' });
  expect(results).toHaveLength(8);
  for (const result of results) {
    expect(result.initial).toBe(0);
    expect(result.initialMidFade).toBeCloseTo(result.expectedLevel * 0.25, 3);
    expect(result.crossfade.min).toBeCloseTo(result.expectedLevel, 6);
    expect(result.crossfade.max).toBeCloseTo(result.expectedLevel, 6);
    expect(result.fullPause).toEqual({ min: 0, max: 0 });
    expect(result.repeatedLoops.min).toBeCloseTo(result.expectedLevel, 6);
    expect(result.repeatedLoops.max).toBeCloseTo(result.expectedLevel, 6);
    expect(result.maximumStep).toBeLessThan(0.0002);
    expect(result.sources).toBe(6); expect(result.peakSources).toBe(3);
    expect(result.liveSources).toBe(3); expect(result.generations).toBe(1); expect(result.gains).toBe(8);
  }
});

test('native production PCM bounds layered output and all twilight/dense transitions at volume 100', async ({ page }, info) => {
  await loadAudioModules(page);
  const results = await page.evaluate(async () => {
    const { createAmbientPlayer } = await import('./src/audio/ambient-player.js');
    const { sampleAudioMix } = await import('./src/audio/audio-mix.js');
    const { createGameClock } = await import('./src/game/game-clock.js');
    const results = [], duration = 24.24;
    for (const rate of [22050, 44100, 48000]) for (const [name, start, transition] of [['day', 60, false], ['night-clear', 240, false],
      ['night-fog', 2790, false], ['night-dense-fog', 960, false], ['sunset', 168, true],
      ['sunrise', 348, true], ['dense-fog-arrives', 896, true], ['dense-fog-clears', 1064, true]]) {
      const offline = new OfflineAudioContext(1, Math.round(rate * duration), rate);
      const player = createAmbientPlayer();
      const play = () => {
        const clock = createGameClock(undefined, { elapsedSeconds: start + offline.currentTime }).state;
        player.play(offline, sampleAudioMix(clock), 100, clock.elapsedSeconds);
      };
      play();
      // Exercise native AudioParam retargets using the real 24s PCM and player.
      const times = transition ? Array.from({ length: Math.floor(duration * 60) }, (_, i) => (i + 1) / 60)
        .filter(time => time < duration) : [];
      let suspended = times.length ? offline.suspend(times[0]) : undefined;
      const rendering = offline.startRendering();
      for (let i = 0; i < times.length; i++) {
        await suspended; play();
        if (times[i + 1]) suspended = offline.suspend(times[i + 1]);
        await offline.resume();
      }
      const data = (await rendering).getChannelData(0);
      let peak = 0, maximumStep = 0, clipped = 0, nonFinite = 0, energy = 0;
      for (let i = 0; i < data.length; i++) {
        peak = Math.max(peak, Math.abs(data[i]));
        if (i) maximumStep = Math.max(maximumStep, Math.abs(data[i] - data[i - 1]));
        if (Math.abs(data[i]) >= 1) clipped++;
        if (!Number.isFinite(data[i])) nonFinite++;
        // A complete 24s loop after the player's initial fade.
        if (i >= Math.round(0.12 * rate) && i < Math.round(24.12 * rate)) energy += data[i] ** 2;
      }
      results.push({ name, rate, start, peak, maximumStep, clipped, nonFinite, rms: Math.sqrt(energy / (rate * 24)) });
      player.dispose();
    }
    return results;
  });
  const path = info.outputPath('native-layered-pcm.json');
  writeFileSync(path, JSON.stringify(results, null, 2));
  await info.attach('native-layered-pcm', { path, contentType: 'application/json' });
  expect(results).toHaveLength(24);
  for (const result of results) {
    expect(result.nonFinite).toBe(0); expect(result.clipped).toBe(0);
    expect(result.peak).toBeGreaterThan(0.001); expect(result.peak).toBeLessThan(0.04);
    expect(result.maximumStep).toBeLessThan(0.0061);
  }
  for (const rate of [22050, 44100, 48000]) {
    const atRate = results.filter(result => result.rate === rate);
    for (const [index, originalRms] of [[0, 0.031305474682915224], [1, 0.02643966012632178], [2, 0.02643966012632178]]) {
      const changeDb = 20 * Math.log10(atRate[index].rms / (originalRms * 0.3));
      expect(changeDb).toBeGreaterThanOrEqual(0); expect(changeDb).toBeLessThan(0.2);
    }
    expect(atRate[1].rms).toBeCloseTo(atRate[2].rms, 8);
  }
});

test('night B loops through 24/48 seconds at 44.1/48kHz without seam impulses or silence', async ({ page }, info) => {
  await loadAudioModules(page);
  const results = await page.evaluate(async () => {
    const { createGeneratedBuffers } = await import('./src/audio/generated-sources.js');
    const results = [];
    for (const rate of [44100, 48000]) for (const offset of [0, 1.337]) {
      const offline = new OfflineAudioContext(1, rate * 50, rate);
      const buffer = createGeneratedBuffers(offline).night, source = offline.createBufferSource();
      source.buffer = buffer; source.loop = true; source.connect(offline.destination); source.start(0, offset);
      const data = (await offline.startRendering()).getChannelData(0);
      let peak = 0, energy = 0, clipped = 0, nonFinite = 0;
      for (const value of data) {
        peak = Math.max(peak, Math.abs(value)); energy += value * value;
        if (Math.abs(value) >= 1) clipped++; if (!Number.isFinite(value)) nonFinite++;
      }
      const seams = [24, 48].map(seconds => {
        const index = Math.round((seconds - offset) * rate), halfWindow = Math.round(rate * .1);
        let localEnergy = 0, curvature = 0, step = 0;
        for (let i = index - halfWindow; i < index + halfWindow; i++) localEnergy += data[i] ** 2;
        // Cover several interpolation samples, not just one boundary position.
        for (let i = index - 4; i <= index + 4; i++) {
          step = Math.max(step, Math.abs(data[i] - data[i - 1]));
          curvature = Math.max(curvature, Math.abs(data[i + 1] - 2 * data[i] + data[i - 1]));
        }
        return { seconds, index, step, curvature, rms200ms: Math.sqrt(localEnergy / (2 * halfWindow)),
          samples: Array.from(data.subarray(index - 8, index + 9)) };
      });
      results.push({ rate, offset, bufferRate: buffer.sampleRate, frames: buffer.length, peak,
        rms: Math.sqrt(energy / data.length), clipped, nonFinite, seams });
      source.disconnect(); source.buffer = null;
    }
    return results;
  });
  const path = info.outputPath('native-night-b-loops.json');
  writeFileSync(path, JSON.stringify(results, null, 2));
  await info.attach('native-night-b-loops', { path, contentType: 'application/json' });
  expect(results).toHaveLength(4);
  for (const result of results) {
    expect(result.bufferRate).toBe(22050); expect(result.frames).toBe(529200);
    expect(result.clipped).toBe(0); expect(result.nonFinite).toBe(0);
    expect(result.peak).toBeLessThan(.094); expect(result.rms).toBeGreaterThan(.025); expect(result.rms).toBeLessThan(.028);
    for (const seam of result.seams) {
      expect(seam.step).toBeLessThan(.0002); expect(seam.curvature).toBeLessThan(.00015);
      expect(seam.rms200ms).toBeGreaterThan(.022); expect(seam.rms200ms).toBeLessThan(.028);
    }
    result.seams[0].samples.forEach((sample, index) => expect(sample).toBeCloseTo(result.seams[1].samples[index], 7));
  }
});

test('native Firefly bite output has prompt onset, bounded peaks and full release at 44.1/48kHz', async ({ page }, info) => {
  await loadAudioModules(page);
  const results = await page.evaluate(async () => {
    const { createFishingAudio } = await import('./src/ui/fishing-audio.js');
    const { createAmbientPlayer } = await import('./src/audio/ambient-player.js');
    const { sampleAudioMix } = await import('./src/audio/audio-mix.js');
    const { createGameClock } = await import('./src/game/game-clock.js');
    const { sampleBioGain } = await import('./src/audio/bio-player.js');
    const results = [];
    for (const rate of [44100, 48000]) for (const [scene, seconds] of [['isolated', 0], ['day', 90], ['night', 270], ['dense', 990]]) {
      const offline = new OfflineAudioContext(2, Math.round(rate * 1.1), rate), nodes = [];
      let fetches = 0, decodes = 0;
      const context = Object.assign(new EventTarget(), {
        state: 'running', sampleRate: rate, destination: offline.destination,
        createBuffer: (...args) => offline.createBuffer(...args),
        decodeAudioData: bytes => { decodes++; return offline.decodeAudioData(bytes); },
      });
      Object.defineProperty(context, 'currentTime', { get: () => offline.currentTime });
      for (const [method, kind] of [['createGain', 'gain'], ['createBufferSource', 'source']]) context[method] = () => {
        const node = offline[method](), disconnect = node.disconnect.bind(node);
        node.disconnected = false; node.kind = kind;
        node.disconnect = () => { node.disconnected = true; return disconnect(); };
        if (kind === 'source') {
          const start = node.start.bind(node);
          node.start = (...args) => { node.startWhen = args[0]; node.offset = args[1]; return start(...args); };
        }
        nodes.push(node); return node;
      };
      const session = { context, status: 'ready', subscribe: () => () => {} };
      const bite = createFishingAudio({ session, fetcher: (...args) => { fetches++; return fetch(...args); } });
      if (!await bite.preload()) throw Error('Notification failed to prepare');
      const player = createAmbientPlayer();
      let bio;
      if (scene !== 'isolated') {
        const clock = createGameClock(undefined, { elapsedSeconds: seconds }).state, mix = sampleAudioMix(clock);
        player.play(context, mix, 100, seconds);
        const file = scene === 'day' ? 'bird-a' : 'suzumushi-a';
        const pcm = await offline.decodeAudioData(await (await fetch('./src/assets/audio/bio/wav/' + file + '.wav')).arrayBuffer());
        bio = offline.createBufferSource(); bio.buffer = pcm;
        const gain = offline.createGain(); gain.gain.value = sampleBioGain(mix, 100, clock.timeOfDay);
        bio.connect(gain).connect(offline.destination); bio.start(0);
      }
      const preparedFetches = fetches, preparedDecodes = decodes;
      bite.bite();
      const source = nodes.find(n => n.kind === 'source' && !n.loop);
      const ended = new Promise(resolve => source.addEventListener('ended', resolve, { once: true }));
      const decodedBytes = source.buffer.length * source.buffer.numberOfChannels * 4;
      const decodedFrames = source.buffer.length, decodedDuration = source.buffer.duration;
      const rendered = await offline.startRendering(); await ended;
      let peak = 0, energy = 0, nonFinite = 0, clipped = 0, first = Infinity, tailPeak = 0;
      for (let c = 0; c < rendered.numberOfChannels; c++) {
        const data = rendered.getChannelData(c);
        for (let i = 0; i < data.length; i++) {
          const v = data[i];
          peak = Math.max(peak, Math.abs(v));
          if (i < Math.round(rate * .98)) energy += v * v;
          if (!Number.isFinite(v)) nonFinite++;
          if (Math.abs(v) >= 1) clipped++;
          if (Math.abs(v) > .01) first = Math.min(first, i / rate);
          if (i >= Math.ceil(rate * .981)) tailPeak = Math.max(tailPeak, Math.abs(v));
        }
      }
      const liveNotificationNodes = nodes.filter(n => !n.disconnected).length - (scene === 'isolated' ? 0 : 7);
      results.push({ rate, scene, peak, rms: Math.sqrt(energy / (Math.round(rate * .98) * 2)), nonFinite, clipped,
        firstAboveMinus40Seconds: first, tailPeak, fetches, decodes, preparedFetches, preparedDecodes,
        scheduledStart: source.startWhen, offset: source.offset, decodedBytes, decodedFrames, decodedDuration, liveNotificationNodes,
        sourceBufferReleased: source.buffer === null });
      bite.dispose(); player.dispose(); if (bio) { bio.stop(); bio.disconnect(); bio.buffer = null; }
    }
    return results;
  });
  const path = info.outputPath('native-bite-output.json');
  writeFileSync(path, JSON.stringify(results, null, 2));
  await info.attach('native-bite-output', { path, contentType: 'application/json' });
  expect(results).toHaveLength(8);
  for (const result of results) {
    expect(result.nonFinite).toBe(0); expect(result.clipped).toBe(0);
    expect(result.peak).toBeGreaterThan(.05); expect(result.peak).toBeLessThan(.32);
    expect(result.fetches).toBe(1); expect(result.decodes).toBe(1);
    expect(result.preparedFetches).toBe(1); expect(result.preparedDecodes).toBe(1);
    expect(result.scheduledStart).toBe(0); expect(result.offset).toBe(.02);
    // Native 48k -> 44.1k resampling measured 44,099 frames in Chromium 154.
    // Retain a one-frame duration bound instead of assuming an exact 1s buffer.
    expect(result.decodedFrames).toBeGreaterThanOrEqual(result.rate === 48000 ? result.rate : result.rate - 1);
    expect(result.decodedFrames).toBeLessThanOrEqual(result.rate);
    expect(result.decodedBytes).toBe(result.decodedFrames * 2 * 4);
    expect(result.liveNotificationNodes).toBe(0); expect(result.sourceBufferReleased).toBe(true);
    if (result.scene === 'isolated') {
      expect(result.peak).toBeLessThan(.25);
      expect(result.firstAboveMinus40Seconds).toBeGreaterThan(0);
      expect(result.firstAboveMinus40Seconds).toBeLessThan(.02);
      expect(result.tailPeak).toBe(0);
    }
  }
});
