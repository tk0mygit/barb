import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createGeneratedBuffers } from '../src/audio/generated-sources.js';
import { sampleAudioMix } from '../src/audio/audio-mix.js';
import { createGameClock } from '../src/game/game-clock.js';
import { AMBIENT_GAIN } from '../src/audio/ambient-player.js';

// Audition material only; no production endpoint, state-setting API or asset.
const rate = 22050, output = resolve(process.argv[2] || 'test-results/audio-preview');
const buffers = createGeneratedBuffers({ createBuffer(channels, length, sampleRate) {
  const data = new Float32Array(length);
  return { duration: length / sampleRate, getChannelData: () => data };
} });
await mkdir(output, { recursive: true });
for (const [name, start, seconds] of [['day', 60, 24], ['night-clear', 240, 24], ['night-fog', 2790, 24], ['night-dense-fog', 960, 24],
  ['sunset', 168, 24], ['dense-fog-arrives', 896, 24], ['dense-fog-clears-at-dawn', 1064, 24]]) {
  const count = Math.round(rate * seconds), wav = Buffer.alloc(44 + count * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(count * 2, 40);
  const clock = createGameClock(undefined, { elapsedSeconds: start }), mix = {};
  for (let i = 0; i < count; i++) {
    sampleAudioMix(clock.state, mix);
    const offset = (Math.round(start * rate) + i) % buffers.day.getChannelData(0).length;
    let value = 0;
    for (const kind of ['day', 'night', 'nature']) value += buffers[kind].getChannelData(0)[offset] * mix[kind];
    const fade = Math.min(1, i / (rate * 0.08), (count - 1 - i) / (rate * 0.08));
    value *= AMBIENT_GAIN * 0.4 * fade; // production default volume, not normalized
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + i * 2);
    clock.step(1 / rate);
  }
  const path = join(output, `${name}.wav`); await writeFile(path, wav); console.log(path);
}
console.log('Generated listening material; this does not establish listening quality or device/browser support.');
