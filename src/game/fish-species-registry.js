// Construction-time metadata validation only. Asset bytes are checked by the
// Node-side image validator; no fetch, DOM or image data enters game state.
export function defineFishSpecies(data) {
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const positive = value => Number.isFinite(value) && value > 0;
  if (!data || typeof data.id !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(data.id)
    || !text(data.name) || !text(data.description) || !text(data.image)
    || (data.alternateName !== undefined && !text(data.alternateName))
    || !positive(data.minLengthCm) || !positive(data.maxLengthCm) || data.minLengthCm >= data.maxLengthCm
    || !Number.isSafeInteger(data.basePricePerKg) || data.basePricePerKg <= 0
    || !['referenceLengthCm', 'referenceWeightKg', 'exponent'].every(key => positive(data.weight?.[key]))
    || data.weight.referenceLengthCm < data.minLengthCm || data.weight.referenceLengthCm > data.maxLengthCm
    || !['baseResistance', 'lengthScaleCm', 'surgeAmplitude', 'surgeFrequency'].every(key => positive(data.fight?.[key]))
    || data.fight.surgeAmplitude >= data.fight.baseResistance || !text(data.fight.style)) {
    throw new TypeError('Invalid fish species definition');
  }
  // Reuse immutable definitions (notably BLACK_BASS's legacy export identity).
  if (Object.isFrozen(data) && Object.isFrozen(data.weight) && Object.isFrozen(data.fight)) return data;
  return Object.freeze({ ...data, weight: Object.freeze({ ...data.weight }), fight: Object.freeze({ ...data.fight }) });
}

export function createFishSpeciesRegistry(definitions) {
  if (!Array.isArray(definitions) || definitions.length === 0) throw new TypeError('Expected fish species definitions');
  const byId = new Map();
  const species = Object.freeze(Array.from(definitions, data => {
    const fish = defineFishSpecies(data);
    if (byId.has(fish.id)) throw new TypeError(`Duplicate fish species ID: ${fish.id}`);
    byId.set(fish.id, fish);
    return fish;
  }));
  return Object.freeze({ species, get: id => byId.get(id) });
}
