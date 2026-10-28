import { defineFishSpecies } from './fish-species-registry.js';
import { defineFishRarity } from './fish-rarity.js';
import { getDepthBand } from '../world/depth.js';
import { record, exactRecord, denseArray, orderedIds, positive, positiveTable, immutableData } from './encounter-validation.js';

const DEPTHS = Object.freeze(['shallow', 'mid', 'deep']);
const TIMES = Object.freeze(['day', 'night']);

// Match the legacy normalizeEncounterConditions boundary without importing its
// production fish/lure registry. Invalid individual conditions are neutral.
function normalizeConditions(conditions) {
  const depthM = Number.isFinite(conditions?.depthM) && conditions.depthM >= 0 ? conditions.depthM : null;
  const timeOfDay = TIMES.includes(conditions?.timeOfDay) ? conditions.timeOfDay : null;
  const cycleProgress = Number.isFinite(conditions?.cycleProgress) && conditions.cycleProgress >= 0 && conditions.cycleProgress < 1 ? conditions.cycleProgress : null;
  return Object.freeze({ depthM, depthBand: getDepthBand(depthM), timeOfDay, cycleProgress });
}

export function createEncounterModel(config) {
  exactRecord(config, ['registry', 'baseWeights', 'lures', 'environmentAffinities', 'lureDepthExponents', 'tiers'], 'config');
  record(config.registry, 'registry');
  const sourceSpecies = denseArray(config.registry.species, 'registry.species');
  const speciesIds = orderedIds(sourceSpecies.map((fish, index) => record(fish, `registry.species[${index}]`).id), 'registry.species IDs');
  const species = Object.freeze(sourceSpecies.map((fish, index) => {
    const path = `registry.species[${index}] (${fish.id})`;
    const snapshot = immutableData(fish, path);
    try { return defineFishSpecies(snapshot); }
    catch (cause) { throw new TypeError(`${path}: ${cause.message}`, { cause }); }
  }));
  const baseWeights = positiveTable(config.baseWeights, speciesIds, 'baseWeights');
  const tiers = defineFishRarity(speciesIds, config.tiers);
  const sourceLures = denseArray(config.lures, 'lures');
  const lureIds = orderedIds(sourceLures.map((lure, index) => record(lure, `lures[${index}]`).id), 'lure IDs');
  const lures = Object.freeze(sourceLures.map(lure => Object.freeze({
    id: lure.id, affinities: positiveTable(lure.affinities, speciesIds, `lures.${lure.id}.affinities`),
  })));
  exactRecord(config.environmentAffinities, speciesIds, 'environmentAffinities');
  const environmentAffinities = Object.freeze(Object.fromEntries(speciesIds.map(id => {
    const path = `environmentAffinities.${id}`;
    const profile = exactRecord(config.environmentAffinities[id], ['depth', 'time'], path);
    return [id, Object.freeze({
      depth: positiveTable(profile.depth, DEPTHS, `${path}.depth`),
      time: positiveTable(profile.time, TIMES, `${path}.time`),
    })];
  })));
  exactRecord(config.lureDepthExponents, lureIds, 'lureDepthExponents');
  const lureDepthExponents = Object.freeze(Object.fromEntries(lureIds.map(id => [
    id, positiveTable(config.lureDepthExponents[id], DEPTHS, `lureDepthExponents.${id}`),
  ])));
  const definitions = Object.freeze({ species, speciesIds, lureIds, baseWeights, lures, environmentAffinities, lureDepthExponents, tiers });
  const byLure = new Map(lures.map(lure => [lure.id, lure]));

  // This is the only weight/normalization path, shared by all three methods.
  function calculate(lureId, conditions, modifiers) {
    const lure = byLure.get(lureId);
    if (!lure) throw new RangeError(`Unknown lure: ${String(lureId)}`);
    const environment = normalizeConditions(conditions);
    // Optional partial species multiplier record. Omitted IDs explicitly mean 1.
    const multipliers = {};
    if (modifiers !== undefined) {
      record(modifiers, 'modifiers');
      for (const id of Reflect.ownKeys(modifiers)) {
        if (!speciesIds.includes(id)) throw new RangeError(`modifiers.${String(id)}: unknown species ID`);
        Object.defineProperty(multipliers, id, { value: positive(modifiers[id], `modifiers.${id}`) });
      }
    }
    const entries = speciesIds.map(speciesId => {
      const path = `weights.${lureId}.${speciesId}`;
      const profile = environmentAffinities[speciesId];
      const depthAffinity = environment.depthBand === null ? 1 : profile.depth[environment.depthBand];
      const lureDepthExponent = environment.depthBand === null ? 1 : lureDepthExponents[lureId][environment.depthBand];
      const timeAffinity = environment.timeOfDay === null ? 1 : profile.time[environment.timeOfDay];
      const depthWeight = positive(depthAffinity ** lureDepthExponent, `${path}.depthWeight`);
      const environmentWeight = positive(depthWeight * timeAffinity, `${path}.environmentWeight`);
      const baseWeight = baseWeights[speciesId], lureAffinity = lure.affinities[speciesId];
      const baseLureWeight = positive(baseWeight * lureAffinity, `${path}.baseLureWeight`);
      // Retain legacy grouping: (B * A) * ((D ** L) * T), then the optional M.
      const unmodifiedWeight = positive(baseLureWeight * environmentWeight, `${path}.unmodifiedWeight`);
      const modifier = Object.hasOwn(multipliers, speciesId) ? multipliers[speciesId] : 1;
      const weight = positive(unmodifiedWeight * modifier, `${path}.weight`);
      return { speciesId, tier: tiers[speciesId], baseWeight, lureAffinity, depthAffinity, lureDepthExponent,
        depthWeight, timeAffinity, environmentWeight, modifier, weight };
    });
    const totalWeight = positive(entries.reduce((sum, entry) => sum + entry.weight, 0), `totalWeight.${lureId}`);
    const normalized = Object.freeze(entries.map(entry => Object.freeze({ ...entry,
      probability: positive(entry.weight / totalWeight, `probabilities.${lureId}.${entry.speciesId}`),
    })));
    const probabilitySum = normalized.reduce((sum, entry) => sum + entry.probability, 0);
    if (Math.abs(probabilitySum - 1) > 1e-12) throw new RangeError(`probabilities.${lureId}: sum must be within 1e-12 of 1`);
    return Object.freeze({ lureId, conditions: environment, totalWeight, entries: normalized });
  }

  function getProbabilities(lureId, conditions, modifiers) {
    return Object.freeze(calculate(lureId, conditions, modifiers).entries.map(({ speciesId, weight, probability }) =>
      Object.freeze({ speciesId, weight, probability })));
  }

  function sample(lureId, random = Math.random, conditions, modifiers) {
    const { entries } = calculate(lureId, conditions, modifiers);
    if (typeof random !== 'function') throw new TypeError('random: expected a function');
    const roll = random();
    if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new RangeError('Random value must be in [0, 1)');
    let cumulative = 0;
    for (const [index, entry] of entries.entries()) {
      cumulative += entry.probability;
      if (roll < cumulative) return species[index];
    }
    return species.at(-1); // Same final-interval rounding rescue as the legacy API.
  }

  return Object.freeze({ definitions, getProbabilities, sample, audit: calculate });
}
