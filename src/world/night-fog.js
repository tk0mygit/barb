import { GAME_CLOCK_CONFIG } from '../game/game-clock.js';

export const FOG_TYPE = Object.freeze({ CLEAR: 'CLEAR', FOG: 'FOG', DENSE_FOG: 'DENSE_FOG' });
export const NIGHT_FOG_CONFIG = Object.freeze({ clearProbability: 0.5, fogProbability: 0.35,
  denseProbability: 0.15, minFogAmount: 0.3, maxFogAmount: 0.7, denseFogAmount: 0.95,
  fadeSeconds: 12, referenceDistance: 30, baseDensity: 0.0018 });
const cycleSeconds = GAME_CLOCK_CONFIG.daySeconds + GAME_CLOCK_CONFIG.nightSeconds;
const smoothstep = value => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
function randomForNight(nightIndex, salt) {
  let hash = 0x811c9dc5;
  // Salted decimal hashing retains high bits of night indices beyond 2^32.
  for (const digit of `${salt}:${nightIndex}`) hash = Math.imul(hash ^ digit.charCodeAt(0), 0x01000193);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x100000000;
}
let cachedProfile;
// Pure deterministic profiles, with a bounded one-entry memo shared by render
// and audio. No per-frame redraw of random state, wall time, or saved fields.
export function getNightFogProfile(nightIndex) {
  if (cachedProfile?.nightIndex === nightIndex) return cachedProfile;
  const valid = Number.isInteger(nightIndex) && nightIndex >= 0;
  const roll = valid ? randomForNight(nightIndex, 'type-v2') : 0;
  const fogType = roll < NIGHT_FOG_CONFIG.clearProbability ? FOG_TYPE.CLEAR
    : roll < NIGHT_FOG_CONFIG.clearProbability + NIGHT_FOG_CONFIG.fogProbability ? FOG_TYPE.FOG : FOG_TYPE.DENSE_FOG;
  const targetFogAmount = fogType === FOG_TYPE.CLEAR ? 0 : fogType === FOG_TYPE.DENSE_FOG ? NIGHT_FOG_CONFIG.denseFogAmount
    : NIGHT_FOG_CONFIG.minFogAmount + (NIGHT_FOG_CONFIG.maxFogAmount - NIGHT_FOG_CONFIG.minFogAmount) * randomForNight(nightIndex, 'amount-v2');
  const profile = Object.freeze({ nightIndex, fogType, targetFogAmount, visibilityClarity: 1 - targetFogAmount });
  if (valid) cachedProfile = profile;
  return profile;
}

export function sampleNightFog(clock, target = {}) {
  const nightIndex = Math.floor(clock.elapsedSeconds / cycleSeconds);
  const profile = clock.timeOfDay === 'night' ? getNightFogProfile(nightIndex) : null;
  target.nightIndex = nightIndex;
  target.fogType = profile?.fogType ?? FOG_TYPE.CLEAR;
  target.targetFogAmount = profile?.targetFogAmount ?? 0;
  target.visibilityClarity = 1 - target.targetFogAmount;
  const seconds = clock.phaseProgress * GAME_CLOCK_CONFIG.nightSeconds;
  target.intensity = target.fogType === FOG_TYPE.CLEAR ? 0
    : smoothstep(seconds / NIGHT_FOG_CONFIG.fadeSeconds)
      * smoothstep((GAME_CLOCK_CONFIG.nightSeconds - seconds) / NIGHT_FOG_CONFIG.fadeSeconds);
  target.effectiveFogAmount = target.targetFogAmount * target.intensity;
  return target;
}

// At D=30m, T_fog(D)/T_base(D) is exactly 1-effectiveFogAmount.
export function getNightFogDensity(effectiveFogAmount) {
  if (!Number.isFinite(effectiveFogAmount) || effectiveFogAmount < 0 || effectiveFogAmount >= 1) throw new RangeError('Fog amount must be in [0, 1)');
  return Math.sqrt(NIGHT_FOG_CONFIG.baseDensity ** 2
    - Math.log1p(-effectiveFogAmount) / NIGHT_FOG_CONFIG.referenceDistance ** 2);
}
