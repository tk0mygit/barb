import { GAME_CLOCK_CONFIG } from '../game/game-clock.js';

export const NIGHT_FOG_CONFIG = Object.freeze({ probability: 0.3, fadeSeconds: 12 });
const cycleSeconds = GAME_CLOCK_CONFIG.daySeconds + GAME_CLOCK_CONFIG.nightSeconds;
const smoothstep = value => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

// Stable FNV-1a of the decimal index, followed by the MurmurHash3 32-bit
// avalanche. Hashing every digit avoids truncating the index at 2^32 nights.
// This mapping is part of save-v1 compatibility: keep it stable across releases.
export function hasNightFog(nightIndex) {
  if (!Number.isInteger(nightIndex) || nightIndex < 0) return false;
  let hash = 0x811c9dc5;
  for (const digit of String(nightIndex)) hash = Math.imul(hash ^ digit.charCodeAt(0), 0x01000193);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return hash / 0x100000000 < NIGHT_FOG_CONFIG.probability;
}

// Pure absolute sampling of the existing shared clock, with optional target
// reuse. Audio can later consume isFoggyNight/intensity without a renderer.
export function sampleNightFog(clock, target = {}) {
  target.nightIndex = Math.floor(clock.elapsedSeconds / cycleSeconds);
  target.isFoggyNight = clock.timeOfDay === 'night' && hasNightFog(target.nightIndex);
  const nightSeconds = clock.phaseProgress * GAME_CLOCK_CONFIG.nightSeconds;
  target.intensity = target.isFoggyNight
    ? smoothstep(nightSeconds / NIGHT_FOG_CONFIG.fadeSeconds)
      * smoothstep((GAME_CLOCK_CONFIG.nightSeconds - nightSeconds) / NIGHT_FOG_CONFIG.fadeSeconds)
    : 0;
  return target;
}
