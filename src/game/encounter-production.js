import { createEncounterModel } from './encounter-model.js';
import { FISH_SPECIES } from './fish-species.js';
import { APPEARANCE_WEIGHTS } from './fish-encounters.js';
import { FISH_RARITY } from './fish-rarity.js';
import { LURES } from './lures.js';
import { FISH_ENVIRONMENT_AFFINITIES, LURE_DEPTH_AFFINITIES } from './encounter-affinities.js';
import { EQUIPMENT_LEVELS } from './equipment.js';

// One strict production model; the factory remains independent of game data.
export const encounterModel = createEncounterModel({
  registry: { species: FISH_SPECIES }, baseWeights: APPEARANCE_WEIGHTS, lures: LURES,
  environmentAffinities: FISH_ENVIRONMENT_AFFINITIES,
  lureDepthExponents: LURE_DEPTH_AFFINITIES, tiers: FISH_RARITY,
});

const rodModifiers = new Map(EQUIPMENT_LEVELS.rod.map(row => [row.level,
  Object.freeze(Object.fromEntries(FISH_SPECIES.map(fish => [
    fish.id, row.tierMultipliers?.[FISH_RARITY[fish.id]] ?? 1,
  ]))),
]));

export function getRodEncounterModifiers(level) {
  if (!rodModifiers.has(level)) throw new RangeError(`Unknown rod level: ${String(level)}`);
  return rodModifiers.get(level);
}
