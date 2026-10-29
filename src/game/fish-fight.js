import { getQteDifficulty } from './fight-qte.js';

// Pure species/size/time calculation, shared by simulation and balance tests.
export function fishResistance(species, lengthCm, elapsedSeconds) {
  const { baseResistance, lengthScaleCm, surgeAmplitude, surgeFrequency } = species.fight;
  return baseResistance + (lengthCm - species.minLengthCm) / lengthScaleCm
    + surgeAmplitude * Math.sin(elapsedSeconds * surgeFrequency);
}

// Use the already rounded encounter length and the canonical species range.
export function isLargeFish(species, lengthCm) {
  const relativeLength = (lengthCm - species.minLengthCm) / (species.maxLengthCm - species.minLengthCm);
  return lengthCm >= 70 || (lengthCm >= 40 && relativeLength >= 0.75);
}

// Descriptive weights only. They never alter resistance, movement or RNG.
export function createFightProfile(species, lengthCm, difficulty = getQteDifficulty(species, lengthCm)) {
  const { baseResistance: b, surgeAmplitude: a, surgeFrequency: f } = species.fight;
  const ratio = difficulty.ratio;
  const surge = a * f * (1 + ratio), endurance = b * (1 + ratio) / (1 + a), sway = a * f / (1 + b);
  const total = surge + endurance + sway;
  return Object.freeze({ baseResistance: b, surgeAmplitude: a, surgeFrequency: f, ratio,
    surge: surge / total, endurance: endurance / total, sway: sway / total });
}
