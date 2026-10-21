// Pure species/size/time calculation, shared by simulation and balance tests.
export function fishResistance(species, lengthCm, elapsedSeconds) {
  const { baseResistance, lengthScaleCm, surgeAmplitude, surgeFrequency } = species.fight;
  return baseResistance + (lengthCm - species.minLengthCm) / lengthScaleCm
    + surgeAmplitude * Math.sin(elapsedSeconds * surgeFrequency);
}
