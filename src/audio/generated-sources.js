// Original procedural placeholders. No recordings, samples, imported melodies
// or network assets. This factory is the replacement boundary for future files.
import { fillNightSource } from './night-source.js';

export const AUDIO_LOOP_SECONDS = 24;
const RATE = 22050;
const TAU = Math.PI * 2;
const sine = phase => Math.sin(TAU * phase);
function tone(data, start, duration, frequency, level, wrap = false) {
  const from = Math.round(start * RATE), count = Math.round(duration * RATE);
  // Rotate the oscillators instead of evaluating three trig functions per
  // sample. This is the same sine² envelope and 88/12 harmonic balance.
  const step = TAU * frequency / RATE, envelopeStep = TAU / count;
  const sinStep = Math.sin(step), cosStep = Math.cos(step);
  const sinEnvelopeStep = Math.sin(envelopeStep), cosEnvelopeStep = Math.cos(envelopeStep);
  let sinTone = 0, cosTone = 1, sinEnvelope = 0, cosEnvelope = 1;
  for (let i = 0; i < count && (wrap || from + i < data.length); i++) {
    const envelope = (1 - cosEnvelope) * 0.5;
    const index = wrap ? (from + i + data.length) % data.length : from + i;
    data[index] += level * envelope * sinTone * (0.88 + 0.24 * cosTone);
    const nextSinTone = sinTone * cosStep + cosTone * sinStep;
    cosTone = cosTone * cosStep - sinTone * sinStep; sinTone = nextSinTone;
    const nextSinEnvelope = sinEnvelope * cosEnvelopeStep + cosEnvelope * sinEnvelopeStep;
    cosEnvelope = cosEnvelope * cosEnvelopeStep - sinEnvelope * sinEnvelopeStep; sinEnvelope = nextSinEnvelope;
  }
}
export function createGeneratedBuffers(context) {
  const buffers = {};
  for (const mode of ['day', 'night', 'nature']) {
    const buffer = context.createBuffer(1, RATE * AUDIO_LOOP_SECONDS, RATE);
    const data = buffer.getChannelData(0);
    if (mode === 'night') {
      fillNightSource(data);
    } else if (mode === 'day') {
      const notes = [261.63, 329.63, 293.66, 392, 329.63, 293.66, 246.94, 293.66];
      notes.forEach((frequency, i) => { if (frequency) tone(data, i * 3, 2.8, frequency, 0.075); });
      const roots = [130.81, 146.83, 164.81, 146.83];
      roots.forEach((root, i) => {
        // Keep chord centres and melody, but overlap the quiet chord edges.
        // Equal per-note energy avoids raising the whole BGM to fill valleys.
        const energyScale = Math.sqrt(6 / 8);
        tone(data, i * 6 - 1, 8, root, 0.035 * energyScale, true);
        tone(data, i * 6 - 1, 8, root * 1.5, 0.018 * energyScale, true);
      });
      // Preserve exact wrap-sample continuity; the very small correction fades
      // over 10ms, without silencing the accompaniment at the loop boundary.
      const offset = data.at(-1) - data[0], seam = Math.round(RATE * 0.01);
      for (let i = 0; i < seam; i++) data[i] += offset * (1 - i / seam);
    } else {
      let seed = 0x42415242, low = 0, water = 0;
      for (let i = 0; i < data.length; i++) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        const noise = (seed >>> 0) / 0x80000000 - 1, t = i / RATE;
        low += 0.012 * (noise - low); water += 0.07 * (noise - water);
        const wind = low * (0.55 + 0.15 * sine(t / 12));
        const ripple = water * (0.25 + 0.15 * sine(t / 6));
        data[i] = (wind + ripple) * 0.45;
      }
      // Quiet distant calls with rounded envelopes, below the bite's register.
      tone(data, 5, 0.7, 620, 0.012); tone(data, 5.9, 0.6, 540, 0.009);
      tone(data, 16, 1.2, 710, 0.008);
      // Crossfade the noise seam without silencing the lake between loops.
      const seam = RATE;
      for (let i = 0; i < seam; i++) {
        const t = i / seam, tail = data[data.length - seam + i];
        data[i] = tail * (1 - t) + data[i] * t;
      }
      // Make the actual wrap sample continuous (the crossfade above smooths
      // the surrounding texture; this short taper removes DC seam steps).
      const offset = data[data.length - 1] - data[0];
      for (let i = 0; i < seam; i++) data[i] += offset * (1 - i / seam);
    }
    buffers[mode] = buffer;
  }
  return buffers;
}
