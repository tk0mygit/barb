import { GAME_CLOCK_CONFIG } from '../game/game-clock.js';
import { sampleNightFog } from '../world/night-fog.js';

const smoothstep = value => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
export const AUDIO_TRANSITION_SECONDS = 8;

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
  target.mode = day ? 'DAY' : target.isFoggyNight ? 'NIGHT_FOG' : 'NIGHT_CLEAR';
  target.day = (1 - night) * (1 - target.intensity);
  target.night = night * (1 - target.intensity);
  target.nature = target.intensity;
  return target;
}
