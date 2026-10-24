import { createGeneratedBuffers } from './generated-sources.js';

export const AMBIENT_GAIN = 0.3;
export const AUDIO_FADE_SECONDS = 0.08;
// Owns a single bank of three loops. Pause fades then releases nodes. A rapid
// resume cancels that one pending release and reuses the same bank.
export function createAmbientPlayer({ makeBuffers = createGeneratedBuffers, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let context, buffers, master, voices = [], releaseTimer, targets = {}, dropBuffers = false;
  const ramps = new Map();
  function ramp(parameter, target, now) {
    // Anchor the known linear envelope on the audio clock. AudioParam.value
    // can still contain the intrinsic default before the first render. Explicit
    // anchors also avoid browser-specific hold/cancel behavior during retargets.
    const previous = ramps.get(parameter);
    const progress = previous ? Math.max(0, Math.min(1, (now - previous.start) / AUDIO_FADE_SECONDS)) : 0;
    const from = previous ? previous.from + (previous.target - previous.from) * progress : 0;
    parameter.cancelScheduledValues(now);
    parameter.setValueAtTime(from, now);
    parameter.linearRampToValueAtTime(target, now + AUDIO_FADE_SECONDS);
    ramps.set(parameter, { from, target, start: now });
  }
  function release() {
    if (releaseTimer !== undefined) clearTimer(releaseTimer);
    releaseTimer = undefined;
    for (const { source, gain } of voices) {
      try { source.stop(); } catch { /* Already stopped. */ }
      source.disconnect(); gain?.disconnect(); source.buffer = null;
    }
    voices = [];
    master?.disconnect(); master = null; targets = {}; ramps.clear();
    if (dropBuffers) buffers = null;
  }
  return {
    play(nextContext, mix, volume, elapsedSeconds) {
      if (releaseTimer !== undefined) { clearTimer(releaseTimer); releaseTimer = undefined; }
      dropBuffers = false;
      if (context !== nextContext) { dropBuffers = true; release(); context = nextContext; dropBuffers = false; }
      try {
        buffers ??= makeBuffers(context);
        if (!master) {
          master = context.createGain(); master.gain.setValueAtTime(0, context.currentTime); master.connect(context.destination);
          for (const kind of ['day', 'night', 'nature']) {
            const source = context.createBufferSource();
            // Track each allocation before the next potentially failing call.
            const voice = { source, kind }; voices.push(voice);
            const gain = voice.gain = context.createGain();
            source.buffer = buffers[kind]; source.loop = true;
            gain.gain.setValueAtTime(0, context.currentTime);
            source.connect(gain).connect(master);
            // No historical event scheduling. Resume at the current game phase.
            source.start(0, elapsedSeconds % buffers[kind].duration);
          }
        }
        const now = context.currentTime;
        const masterTarget = AMBIENT_GAIN * volume / 100;
        if (targets.master !== masterTarget) { ramp(master.gain, masterTarget, now); targets.master = masterTarget; }
        for (const { gain, kind } of voices) {
          if (targets[kind] === mix[kind]) continue;
          ramp(gain.gain, mix[kind], now); targets[kind] = mix[kind];
        }
      } catch (error) { dropBuffers = true; release(); throw error; }
    },
    stop({ immediate = false, freeBuffers = false } = {}) {
      dropBuffers ||= freeBuffers;
      if (immediate || context?.state !== 'running' || !master) { release(); return; }
      if (releaseTimer !== undefined) return;
      try { ramp(master.gain, 0, context.currentTime); targets.master = 0; }
      catch { release(); return; }
      releaseTimer = setTimer(release, (AUDIO_FADE_SECONDS + 0.04) * 1000);
    },
    dispose() { dropBuffers = true; release(); context = null; },
  };
}
