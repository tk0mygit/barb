// Original F-0 B "遠い短い句", accepted for musical direction on 2026-10-27.
// Port of compose_b/pad/note/reflections in F-0 compose.py, not a new score.
// Reference PCM16 WAV SHA-256: 0c38e60a2d6119ce734e60e86741fc6c4c3ebf25182b5b39edcff80f0a761ecd.
const RATE = 22050, SECONDS = 24, TAU = Math.PI * 2;

function addPad(data, hz, level, phase, sway, color) {
  const step = TAU * (Math.round(hz * SECONDS) / SECONDS) / RATE;
  const ds = Math.sin(step), dc = Math.cos(step);
  const breathStep = TAU / data.length, bs = Math.sin(breathStep), bc = Math.cos(breathStep);
  let s = Math.sin(phase), c = Math.cos(phase), breath = s, breathCos = c;
  for (let i = 0; i < data.length; i++) {
    // sin(2p)=2sin(p)cos(p), sin(3p)=sin(p)(3-4sin²(p)).
    data[i] += level * (1 + sway * breath) * s * (1 + 2 * color * c + .025 * (3 - 4 * s * s));
    const nextS = s * dc + c * ds; c = c * dc - s * ds; s = nextS;
    const nextBreath = breath * bc + breathCos * bs;
    breathCos = breathCos * bc - breath * bs; breath = nextBreath;
  }
}

function addNote(data, hz, start, duration, level) {
  const from = Math.ceil(start * RATE), count = Math.ceil((start + duration) * RATE) - from;
  const age0 = from / RATE - start, step = TAU * hz / RATE;
  const ds = Math.sin(step), dc = Math.cos(step), decayStep = Math.exp(-1 / (RATE * 1.85));
  const as = Math.sin(Math.PI / (.16 * RATE)), ac = Math.cos(Math.PI / (.16 * RATE));
  const rs = Math.sin(Math.PI / (1.2 * RATE)), rc = Math.cos(Math.PI / (1.2 * RATE));
  let s = Math.sin(TAU * hz * age0), c = Math.cos(TAU * hz * age0), decay = Math.exp(-age0 / 1.85);
  let attackS = Math.sin(Math.PI * age0 / .16), attackC = Math.cos(Math.PI * age0 / .16);
  let releaseS, releaseC;
  let index = from % data.length, tap1 = (index + 6990) % data.length;
  let tap2 = (index + 16096) % data.length, tap3 = (index + 28886) % data.length;
  for (let i = 0; i < count; i++) {
    const age = age0 + i / RATE;
    let attack = 1, release = 1;
    if (age < .16) {
      attack = .5 - .5 * attackC;
      const next = attackS * ac + attackC * as; attackC = attackC * ac - attackS * as; attackS = next;
    }
    const remaining = duration - age;
    if (remaining < 1.2) {
      if (releaseC === undefined) {
        releaseS = Math.sin(Math.PI * remaining / 1.2); releaseC = Math.cos(Math.PI * remaining / 1.2);
      }
      release = .5 - .5 * releaseC;
      const next = releaseS * rc - releaseC * rs; releaseC = releaseC * rc + releaseS * rs; releaseS = next;
    }
    const value = level * attack * release * decay * s * (1 + .36 * c + .0396 * (3 - 4 * s * s));
    data[index] += value;
    // Exact round-to-even sample delays from F-0 np.roll (including .73s tie).
    data[tap1] += value * .12; data[tap2] += value * .075; data[tap3] += value * .045;
    if (++index === data.length) index = 0;
    if (++tap1 === data.length) tap1 = 0;
    if (++tap2 === data.length) tap2 = 0;
    if (++tap3 === data.length) tap3 = 0;
    const nextS = s * dc + c * ds; c = c * dc - s * ds; s = nextS;
    decay *= decayStep;
  }
}

// Called once per bank creation, into the existing mono/22,050Hz/24s buffer.
// Oscillator rotations avoid per-sample trig on the sustained voices. No
// scratch PCM, fetch/decode, nodes, timers or retained cache are introduced.
export function fillNightSource(data) {
  addPad(data, 82.4069, .023, .38, .055, .10);
  addPad(data, 123.4708, .013, 1.76, .07, .055);
  addPad(data, 164.8138, .006, 2.9, .08, .05);
  for (const [hz, start, duration, level] of [
    [196, 2, 4.9, .040], [246.942, 5.8, 5.3, .033], [220, 12.5, 5.5, .037],
    [164.814, 17.6, 5.6, .034], [184.997, 21.7, 5.1, .026],
  ]) addNote(data, hz, start, duration, level);
  let mean = 0;
  for (let i = 0; i < data.length; i++) mean += data[i];
  mean /= data.length;
  // Preserve the approved PCM16 audition's fixed 1.235 gain and quantization.
  for (let i = 0; i < data.length; i++) data[i] = Math.round((data[i] - mean) * 1.235 * 32767) / 32768;
  // A 10ms raised-cosine correction meets the existing equal-endpoint contract
  // without fading the music to silence or changing notes, timing or gain.
  const offset = data.at(-1) - data[0], seam = Math.round(RATE * .01);
  for (let i = 0; i < seam; i++) data[i] += offset * .5 * (1 + Math.cos(Math.PI * i / seam));
}
