import { auroraRoll } from '../../src/world/aurora.js';
import { getNightFogProfile } from '../../src/world/night-fog.js';
import { meteorRoll } from '../../src/world/meteor.js';

// Ordinary save clocks only. No replacement RNG, shader, visibility or update.
export function findAuroraNight({ selected = true, fogType = 'CLEAR', forward = false, meteor = false } = {}) {
  for (let night = 0; night < 200000; night++) {
    if ((auroraRoll(night) < .2) !== selected || getNightFogProfile(night).fogType !== fogType) continue;
    if (forward && Math.cos(auroraRoll(night, 'aurora-direction-sky4-v1') * Math.PI * 2) < .95) continue;
    if (meteor && !Array.from({ length: 18 }, (_, slot) => meteorRoll(night, slot) < .005).some(Boolean)) continue;
    return night;
  }
  throw new Error('No ordinary aurora saved clock found');
}
