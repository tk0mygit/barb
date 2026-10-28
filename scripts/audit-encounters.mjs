// Development-only production-definition audit. No game state, save or RNG use.
import { FISH_SPECIES } from '../src/game/fish-species.js';
import { APPEARANCE_WEIGHTS } from '../src/game/fish-encounters.js';
import { LURES } from '../src/game/lures.js';
import { FISH_ENVIRONMENT_AFFINITIES, LURE_DEPTH_AFFINITIES } from '../src/game/encounter-affinities.js';
import { FISH_RARITY } from '../src/game/fish-rarity.js';
import { createEncounterModel } from '../src/game/encounter-model.js';

const model = createEncounterModel({
  registry: { species: FISH_SPECIES }, baseWeights: APPEARANCE_WEIGHTS, lures: LURES,
  environmentAffinities: FISH_ENVIRONMENT_AFFINITIES, lureDepthExponents: LURE_DEPTH_AFFINITIES, tiers: FISH_RARITY,
});
const rows = LURES.flatMap(lure => [1, 5, 12].flatMap(depthM => ['day', 'night'].flatMap(timeOfDay => {
  const audit = model.audit(lure.id, { depthM, timeOfDay });
  return audit.entries.map(entry => ({ lureId: audit.lureId, ...audit.conditions, ...entry, totalWeight: audit.totalWeight }));
})));
process.stdout.write(`${JSON.stringify({ speciesCount: FISH_SPECIES.length, conditionCount: 24, cellCount: rows.length, rows }, null, 2)}\n`);
