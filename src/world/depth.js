import { shoreRadius } from './config.js';

// Radial shore clearance is a cheap proxy, not the shortest shoreline distance
// or a real lake bed. Replace estimateWaterDepth without changing fishing logic.
export const DEPTH_CONFIG = Object.freeze({
  maxDepthM: 12, offshoreDistanceM: 90, exponent: 1.2,
  shallowLimitM: 3, deepStartM: 8,
});

export function estimateWaterDepth(position, config = DEPTH_CONFIG) {
  if (!Number.isFinite(position?.x) || !Number.isFinite(position?.z)) return 0;
  const radius = Math.hypot(position.x, position.z);
  const clearance = Math.max(0, shoreRadius(Math.atan2(position.z, position.x)) - radius);
  const fraction = Math.min(1, clearance / config.offshoreDistanceM);
  return config.maxDepthM * fraction ** config.exponent;
}

export function getDepthBand(depthM, config = DEPTH_CONFIG) {
  if (!Number.isFinite(depthM) || depthM < 0) return null;
  return depthM < config.shallowLimitM ? 'shallow' : depthM < config.deepStartM ? 'mid' : 'deep';
}
