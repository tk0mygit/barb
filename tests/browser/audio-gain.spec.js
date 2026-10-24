import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from './diagnostics-fixture.js';

test('native offline gain output stays continuous at 30/60/144fps and irregular updates, including pause/resume', async ({ page }, info) => {
  // Serve the actual production modules through test-only routes, as in the UI
  // fixture. No game hooks or source changes are needed for offline rendering.
  await page.route('**/barb/src/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/barb/', '../../');
    return route.fulfill({ body: readFileSync(new URL(path, import.meta.url)), contentType: 'text/javascript' });
  });
  await page.route('**/barb/audio-gain.html', route => route.fulfill({ body: '<!doctype html><title>Offline gain verification</title>', contentType: 'text/html' }));
  await page.goto('./audio-gain.html');
  const results = await page.evaluate(async () => {
    const { createAmbientPlayer, AMBIENT_GAIN } = await import('./src/audio/ambient-player.js');
    const { sampleAudioMix } = await import('./src/audio/audio-mix.js');
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
          liveSources, gains: gains.length, expectedLevel: AMBIENT_GAIN * 0.4 });
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
