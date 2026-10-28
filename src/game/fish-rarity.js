import { exactRecord, orderedIds } from './encounter-validation.js';

// Encounter modifier categories, not biological rarity. Keep them separate from
// fish metadata, appearance weights, prices and catch/fight characteristics.
export const FISH_TIERS = Object.freeze(['Common', 'Uncommon', 'Rare']);
export const FISH_RARITY = Object.freeze({
  'black-bass': 'Common',
  'smallmouth-bass': 'Common',
  bluegill: 'Common',
  'rainbow-trout': 'Common',
  'brown-trout': 'Uncommon',
  iwana: 'Uncommon',
  'northern-pike': 'Rare',
  'european-perch': 'Common',
  walleye: 'Uncommon',
  catfish: 'Uncommon',
  'alligator-gar': 'Rare',
  arowana: 'Rare',
});

export function getFishTier(speciesId) {
  if (typeof speciesId !== 'string' || !Object.hasOwn(FISH_RARITY, speciesId)) {
    throw new RangeError(`Unknown fish species tier: ${String(speciesId)}`);
  }
  return FISH_RARITY[speciesId];
}

// Every injected registry needs an explicit, complete assignment. Additional
// IDs may be registered here by callers; the approved 12 assignments stay fixed.
export function defineFishRarity(speciesIds, tiers) {
  const ids = orderedIds(speciesIds, 'speciesIds');
  exactRecord(tiers, ids, 'tiers');
  return Object.freeze(Object.fromEntries(ids.map(id => {
    const tier = tiers[id];
    if (typeof tier !== 'string') throw new TypeError(`tiers.${id}: expected a Tier string`);
    if (!FISH_TIERS.includes(tier)) throw new RangeError(`tiers.${id}: unknown Tier ${tier}`);
    if (Object.hasOwn(FISH_RARITY, id) && tier !== FISH_RARITY[id]) {
      throw new RangeError(`tiers.${id}: approved Tier is ${FISH_RARITY[id]}`);
    }
    return [id, tier];
  })));
}
