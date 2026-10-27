import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeneratedBuffers } from '../src/audio/generated-sources.js';
import { fakeContext } from './helpers/audio-fakes.js';

const buffers = createGeneratedBuffers(fakeContext());
function rms(data, from, count) {
  let energy = 0;
  for (let i = 0; i < count; i++) energy += data[(from + i + data.length) % data.length] ** 2;
  return Math.sqrt(energy / count);
}

test('accompaniment remains present across every chord/loop boundary without raising overall BGM level', () => {
  for (const [kind, minimumRms, maximumRms] of [['day', 0.03, 0.033], ['night', 0.025, 0.028]]) {
    const buffer = buffers[kind], data = buffer.getChannelData(0), rate = buffer.sampleRate;
    const window = Math.round(rate * 0.05);
    for (let from = 0; from < data.length; from += window)
      assert.ok(rms(data, from, Math.min(window, data.length - from)) > 0.002, `${kind}: quiet valley at ${from / rate}s`);
    for (const boundary of [0, 6, 12, 18, 24])
      assert.ok(rms(data, Math.round((boundary - 0.05) * rate), Math.round(rate * 0.1)) > 0.002);
    const overall = rms(data, 0, data.length);
    assert.ok(overall > minimumRms && overall < maximumRms, `${kind}: overall RMS ${overall}`);
    assert.ok(Math.abs(data[0] - data.at(-1)) < 1e-6);
  }
});

test('accepted night B retains its unequal rests while the E/B pedal bridges them', () => {
  const buffer = buffers.night, data = buffer.getChannelData(0), rate = buffer.sampleRate;
  const window = Math.round(rate * 0.3);
  // F-0 B's first phrase is at 2s and its long rests precede 12.5s/17.6s.
  // The old 1.35s note / 4.35s rest belonged to the replaced night score.
  const note = rms(data, Math.round(rate * 2.15), window);
  for (const seconds of [11.3, 16.3]) {
    const rest = rms(data, Math.round(rate * seconds), window);
    assert.ok(rest > 0.005 && rest < note * 0.7, `note ${note}, rest ${rest}`);
  }
});
