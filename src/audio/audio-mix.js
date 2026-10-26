import { GAME_CLOCK_CONFIG } from '../game/game-clock.js';
import { sampleNightFog, FOG_TYPE } from '../world/night-fog.js';

const smoothstep = value => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
export const AUDIO_TRANSITION_SECONDS = 8;
// Raw 24s PCM at 0.25 is 15.17/13.69 dB below day/night BGM RMS.
// Keep BGM at its existing level; see docs/AUDIO_SYSTEM.md for output bounds.
export const NATURE_BASE_GAIN = 0.25;

// Absolute shared-clock sampling only. The 16-second twilight blend straddles
// each day/night boundary; fog uses the world's exact 12-second envelope.
export function sampleAudioMix(clock, target = {}) {
  sampleNightFog(clock, target);
  const day = clock.timeOfDay === 'day';
  const duration = day ? GAME_CLOCK_CONFIG.daySeconds : GAME_CLOCK_CONFIG.nightSeconds;
  const seconds = clock.phaseProgress * duration;
  const edge = AUDIO_TRANSITION_SECONDS;
  const local = smoothstep((seconds + edge) / (2 * edge))
    + smoothstep((duration - seconds + edge) / (2 * edge)) - 1;
  const night = day ? 1 - local : local;
  const denseMix = target.fogType === FOG_TYPE.DENSE_FOG ? target.intensity : 0;
  target.mode = day ? 'DAY' : `NIGHT_${target.fogType}`;
  target.day = (1 - night) * (1 - denseMix);
  target.night = night * (1 - denseMix);
  target.nature = NATURE_BASE_GAIN + (1 - NATURE_BASE_GAIN) * denseMix;
  return target;
}
