import { FISH_SPECIES, getFishSpecies } from './fish-species.js';
import { getLure } from './lures.js';

// Relative weights, not percentages. New species default to weight 1 and
// neutral affinity until explicitly balanced. No location/time/depth rules yet.
export const APPEARANCE_WEIGHTS = Object.freeze({
  'black-bass': 24, 'smallmouth-bass': 14, bluegill: 18,
  'rainbow-trout': 12, 'brown-trout': 9, iwana: 8,
  'northern-pike': 6, 'european-perch': 12, walleye: 8,
  catfish: 10, 'alligator-gar': 3, arowana: 4,
});

export function getSpeciesProbabilities(lureId) {
  const lure = getLure(lureId);
  if (!lure) throw new RangeError(`Unknown lure: ${lureId}`);
  // Future environmental factors belong in this weight calculation, not the UI
  // or state machine. Normalization keeps species mix separate from bite tempo.
  const entries = FISH_SPECIES.map(fish => ({
    speciesId: fish.id,
    weight: (APPEARANCE_WEIGHTS[fish.id] ?? 1) * (lure.affinities[fish.id] ?? 1),
  }));
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  return entries.map(entry => ({ ...entry, probability: entry.weight / total }));
}

export function sampleFishSpecies(lureId, random = Math.random) {
  const entries = getSpeciesProbabilities(lureId);
  const roll = random();
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new RangeError('Random value must be in [0, 1)');
  let cumulative = 0;
  for (const entry of entries) {
    cumulative += entry.probability;
    if (roll < cumulative) return getFishSpecies(entry.speciesId);
  }
  return getFishSpecies(entries.at(-1).speciesId); // floating-point rounding
}
