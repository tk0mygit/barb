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
