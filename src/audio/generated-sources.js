// Original procedural placeholders. No recordings, samples, imported melodies
// or network assets. This factory is the replacement boundary for future files.
export const AUDIO_LOOP_SECONDS = 24;
const RATE = 22050;
const TAU = Math.PI * 2;
const sine = phase => Math.sin(TAU * phase);
function tone(data, start, duration, frequency, level) {
  const from = Math.round(start * RATE), count = Math.round(duration * RATE);
  for (let i = 0; i < count && from + i < data.length; i++) {
    const t = i / RATE, progress = i / count;
    const envelope = Math.sin(Math.PI * progress) ** 2;
    data[from + i] += level * envelope * (0.88 * sine(frequency * t) + 0.12 * sine(2 * frequency * t));
  }
}
export function createGeneratedBuffers(context) {
  const buffers = {};
  for (const mode of ['day', 'night', 'nature']) {
    const buffer = context.createBuffer(1, RATE * AUDIO_LOOP_SECONDS, RATE);
    const data = buffer.getChannelData(0);
    if (mode !== 'nature') {
      const notes = mode === 'day'
        ? [261.63, 329.63, 293.66, 392, 329.63, 293.66, 246.94, 293.66]
        : [164.81, 0, 196, 146.83, 0, 174.61, 130.81, 0];
      notes.forEach((frequency, i) => { if (frequency) tone(data, i * 3, 2.8, frequency, 0.075); });
      const roots = mode === 'day' ? [130.81, 146.83, 164.81, 146.83] : [65.41, 73.42, 87.31, 73.42];
      roots.forEach((root, i) => {
        tone(data, i * 6, 6, root, 0.035);
        tone(data, i * 6, 6, root * 1.5, 0.018);
      });
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
