import { fishResistance } from '../../src/game/fish-fight.js';

// Independent specification oracle, using exactly 60 endpoint samples/second.
// Existing 1e-11 equation tolerances remain unchanged in the callers.
export function stoppedDistance({ species, lengthCm, startDistance, distance = startDistance, from = 0, seconds, pushbackSpeed = .80 }) {
  const scale = Math.max(0, Math.min(1, (startDistance - 4.5) / 27.5));
  for (let k = 1; k <= Math.round(seconds * 60); k++) {
    const r = Math.max(.8, Math.min(1.5, fishResistance(species, lengthCm, from + k / 60)));
    distance = Math.min(startDistance + 4, distance + pushbackSpeed * scale * r / 60);
  }
  return distance;
}
