import { FISHING_SPOTS } from '../world/fishing-spots.js';

// Pure boat-position query. Overlaps use only the strongest effect; equal
// effects choose the nearer centre, then configuration order for exact ties.
export function getFishingSpotStatus(boat, spots = FISHING_SPOTS) {
  let active = null, nearest = null, distance = Infinity, activeDistance = Infinity;
  for (const spot of spots) {
    const d = Math.hypot(boat.x - spot.x, boat.z - spot.z);
    if (d < distance) { nearest = spot; distance = d; }
    if (d <= spot.radius && (!active || spot.hitMultiplier > active.hitMultiplier
      || (spot.hitMultiplier === active.hitMultiplier && d < activeDistance))) {
      active = spot; activeDistance = d;
    }
  }
  return { active, nearest, distance, hitMultiplier: active?.hitMultiplier ?? 1 };
}
