import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sampleAudioMix } from '../src/audio/audio-mix.js';
import { createGameClock } from '../src/game/game-clock.js';
import { AMBIENT_GAIN } from '../src/audio/ambient-player.js';

// Audition/analysis only. --source accepts a previously extracted synthesis module.
const args = process.argv.slice(2), sourceIndex = args.indexOf('--source');
const output = resolve(args[0] || 'test-results/audio-preview');
const source = sourceIndex < 0 ? new URL('../src/audio/generated-sources.js', import.meta.url)
  : pathToFileURL(resolve(args[sourceIndex + 1]));
const { createGeneratedBuffers } = await import(source.href);
const rate = 22050, windowSamples = Math.round(rate * 0.05), silenceThreshold = 0.001;
const context = { createBuffer(channels, length, sampleRate) {
  const data = new Float32Array(length);
  return { duration: length / sampleRate, getChannelData: () => data };
} };
const generationMs = [];
let buffers;
for (let i = 0; i < 4; i++) {
  const start = performance.now(); buffers = createGeneratedBuffers(context);
  generationMs.push(performance.now() - start);
}
await mkdir(output, { recursive: true });
const pcm = Object.fromEntries(Object.entries(buffers).map(([kind, buffer]) => [kind, buffer.getChannelData(0)]));
function rms(data, from, count) {
  let energy = 0;
  for (let i = 0; i < count; i++) energy += data[(from + i + data.length) % data.length] ** 2;
  return Math.sqrt(energy / count);
}
function analyze(data, loopSeconds = data.length / rate) {
  const windows = [];
  let peak = 0, maximumStep = 0, longestSilentSamples = 0, silentSamples = 0;
  for (let i = 0; i < data.length; i++) {
    peak = Math.max(peak, Math.abs(data[i]));
    maximumStep = Math.max(maximumStep, Math.abs(data[i] - data[(i + data.length - 1) % data.length]));
    silentSamples = data[i] === 0 ? silentSamples + 1 : 0;
    longestSilentSamples = Math.max(longestSilentSamples, silentSamples);
  }
  for (let i = 0; i < data.length; i += windowSamples)
    windows.push({ seconds: i / rate, rms: rms(data, i, Math.min(windowSamples, data.length - i)) });
  let quiet = 0, longestQuiet = 0;
  for (const window of [...windows, ...windows]) {
    quiet = window.rms < silenceThreshold ? Math.min(windows.length, quiet + 1) : 0;
    longestQuiet = Math.max(longestQuiet, quiet);
  }
  const centeredRms = seconds => rms(data, Math.round((seconds - 0.05) * rate), Math.round(rate * 0.1));
  return { durationSeconds: data.length / rate, peak, rms: rms(data, 0, data.length), maximumStep,
    seamStep: Math.abs(data[0] - data.at(-1)), longestExactSilenceSeconds: longestSilentSamples / rate,
    minimumWindowRms: Math.min(...windows.map(window => window.rms)),
    maximumWindowRms: Math.max(...windows.map(window => window.rms)),
    longestQuietSeconds: longestQuiet * windowSamples / rate,
    boundary100msRms: Array.from({ length: Math.floor(loopSeconds / 6) + 1 }, (_, i) => i * 6)
      .map(seconds => ({ seconds, rms: centeredRms(seconds) })),
    nightRest100msRms: [4.5, 13.5, 22.5].map(seconds => ({ seconds, rms: centeredRms(seconds) })),
    startPhase100msRms: [0, 1, 3, 6, 12, 18, 23.9].map(seconds => ({ seconds,
      rms: rms(data, Math.round(seconds * rate), Math.round(rate * 0.1)) })), windows };
}
const metrics = { source: source.href, rate, windowSeconds: windowSamples / rate, silenceThreshold, generationMs,
  pcmBytes: Object.values(pcm).reduce((sum, data) => sum + data.byteLength, 0),
  limitations: 'Numerical PCM analysis and pure game-clock mixing. No listening/device verification; AudioParam smoothing and hardware output are not simulated.',
  tracks: Object.fromEntries(Object.entries(pcm).map(([kind, data]) => [kind, analyze(data)])), previews: {} };

function waveforms() {
  const left = 70, plotWidth = 1080, rows = [];
  for (const [index, [kind, data]] of Object.entries(pcm).entries()) {
    const top = 40 + index * 200, centre = top + 55;
    let waveform = '', rmsPath = '';
    for (let x = 0; x < plotWidth; x++) {
      const from = Math.floor(x / plotWidth * data.length), to = Math.floor((x + 1) / plotWidth * data.length);
      let min = 0, max = 0;
      for (let i = from; i < to; i++) { min = Math.min(min, data[i]); max = Math.max(max, data[i]); }
      waveform += `M${left + x},${(centre - max / 0.15 * 50).toFixed(2)}V${(centre - min / 0.15 * 50).toFixed(2)}`;
    }
    for (const [i, window] of metrics.tracks[kind].windows.entries())
      rmsPath += `${i ? 'L' : 'M'}${(left + window.seconds / 24 * plotWidth).toFixed(2)},${(top + 170 - window.rms / 0.06 * 55).toFixed(2)}`;
    rows.push(`<text x="10" y="${top + 12}">${kind}</text><text x="10" y="${centre}">PCM</text><text x="10" y="${top + 145}">RMS</text>`);
    for (const second of [0, 6, 12, 18, 24]) {
      const x = left + second / 24 * plotWidth;
      rows.push(`<path d="M${x},${top}V${top + 170}" stroke="#d5dce4"/><text x="${x}" y="${top + 188}">${second}s</text>`);
    }
    rows.push(`<path d="${waveform}" fill="none" stroke="#4074a8" stroke-width="0.8"/><path d="${rmsPath}" fill="none" stroke="#ac4b26" stroke-width="1.5"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="660" viewBox="0 0 1200 660"><rect width="1200" height="660" fill="white"/><g font-family="sans-serif" font-size="12" fill="#253344"><text x="15" y="20">Raw 24s PCM: fixed ±0.15 waveform scale; 50ms RMS fixed 0–0.06. No normalization.</text>${rows.join('')}</g></svg>`;
}

for (const [name, start, seconds] of [['day', 60, 24], ['night-clear', 240, 24], ['night-fog', 2790, 24], ['night-dense-fog', 960, 24],
  ['sunset', 168, 24], ['sunrise', 348, 24], ['dense-fog-arrives', 896, 24], ['dense-fog-clears-at-dawn', 1064, 24],
  ['day-two-loops', 48, 48], ['night-two-loops', 240, 48]]) {
  const count = Math.round(rate * seconds), wav = Buffer.alloc(44 + count * 2), rendered = new Float32Array(count);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(count * 2, 40);
  const clock = createGameClock(undefined, { elapsedSeconds: start }), mix = {};
  for (let i = 0; i < count; i++) {
    sampleAudioMix(clock.state, mix);
    const offset = (Math.round(start * rate) + i) % pcm.day.length;
    let value = 0;
    for (const kind of ['day', 'night', 'nature']) value += pcm[kind][offset] * mix[kind];
    const fade = Math.min(1, i / (rate * 0.08), (count - 1 - i) / (rate * 0.08));
    value *= AMBIENT_GAIN * 0.4 * fade; // production default volume, not normalized
    rendered[i] = value;
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + i * 2);
    clock.step(1 / rate);
  }
  metrics.previews[name] = { gameStartSeconds: start, ...analyze(rendered) };
  const path = join(output, `${name}.wav`); await writeFile(path, wav); console.log(path);
}
await writeFile(join(output, 'metrics.json'), JSON.stringify(metrics, null, 2));
await writeFile(join(output, 'waveforms.svg'), waveforms());
console.log(join(output, 'metrics.json')); console.log(join(output, 'waveforms.svg'));
console.log('Generated comparison material; this does not establish listening quality or device/browser support.');
