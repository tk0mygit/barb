import { createCatchCollection } from './catch-collection.js';
import { validateAchievementData, validateAchievementContract, migrateAchievementData, ACHIEVEMENT_CONTRACT_VERSION } from './achievements.js';
import { createBoatState, isNavigableBoatPosition } from './boat.js';
import { createGameClock } from './game-clock.js';
import { createGameplay } from './gameplay.js';
import { ORIGINAL_FISH_SPECIES_IDS, PHASE6A_FISH_SPECIES_IDS, PHASE6B_FISH_SPECIES_IDS } from './fish-roster.js';
import { SAVE_LIMITS, SaveDataError, requireValid, objectFields, finite, timestamp, validateCollectionData, validateLegacyCollectionData } from './save-validation.js';

export { SAVE_LIMITS, SaveDataError } from './save-validation.js';
export const SAVE_VERSION = 3;
export const SAVE_ROSTER_REVISION = 3; // 36 species; revisions1/2 remain strict source formats.

// Throws SaveDataError, returns a detached deeply frozen envelope. Unknown
// fields are rejected instead of being copied, recursively traversed or lost.
export function validateSaveData(value) {
  requireValid(value !== null && typeof value === 'object' && !Array.isArray(value), 'save');
  const version = Object.getOwnPropertyDescriptor(value, 'saveVersion');
  requireValid(version && 'value' in version && Number.isSafeInteger(version.value) && version.value >= 0, 'saveVersion');
  requireValid([1, 2, SAVE_VERSION].includes(version.value), 'saveVersion', 'unsupported-version');
  const v3 = version.value === SAVE_VERSION;
  if (v3) {
    const roster = Object.getOwnPropertyDescriptor(value, 'rosterRevision');
    requireValid(roster && 'value' in roster && Number.isSafeInteger(roster.value) && roster.value >= 1, 'rosterRevision');
    requireValid([1, 2, SAVE_ROSTER_REVISION].includes(roster.value), 'rosterRevision', 'unsupported-version');
  }
  const revision1 = v3 && value.rosterRevision === 1;
  const revision2 = v3 && value.rosterRevision === 2;
  const contracts = v3 ? (revision1 ? [3] : revision2 ? [4] : [5, ACHIEVEMENT_CONTRACT_VERSION]) : [undefined, 2];
  // Future contracts protect storage even if their outer envelope introduces
  // new fields. Inspect a data descriptor, without executing an input getter.
  const achievement = Object.getOwnPropertyDescriptor(value, 'achievements');
  requireValid(achievement && 'value' in achievement, 'save.achievements');
  validateAchievementContract(achievement.value, contracts);
  objectFields(value, ['saveVersion', ...(v3 ? ['rosterRevision'] : []), 'savedAt', 'collection', 'achievements', 'boat', 'clock', 'settings'], [], 'save');
  timestamp(value.savedAt, 'savedAt');
  const collection = version.value === 1 ? validateLegacyCollectionData(value.collection)
    : validateCollectionData(value.collection, { speciesIds: !v3 ? ORIGINAL_FISH_SPECIES_IDS
      : revision1 ? PHASE6A_FISH_SPECIES_IDS : revision2 ? PHASE6B_FISH_SPECIES_IDS : undefined });
  const achievements = validateAchievementData(value.achievements, collection,
    { contracts });
  objectFields(value.boat, ['x', 'z', 'heading'], [], 'boat');
  finite(value.boat.x, 'boat.x'); finite(value.boat.z, 'boat.z'); finite(value.boat.heading, 'boat.heading');
  requireValid(isNavigableBoatPosition(value.boat), 'boat');
  objectFields(value.clock, ['elapsedSeconds'], [], 'clock');
  finite(value.clock.elapsedSeconds, 'clock.elapsedSeconds', 0);
  objectFields(value.settings, [], [], 'settings');
  return Object.freeze({ saveVersion: version.value, ...(v3 ? { rosterRevision: value.rosterRevision } : {}), savedAt: value.savedAt, collection, achievements,
    boat: Object.freeze({ x: value.boat.x, z: value.boat.z, heading: value.boat.heading }),
    clock: Object.freeze({ elapsedSeconds: value.clock.elapsedSeconds }), settings: Object.freeze({}) });
}

// Call only after the complete source-version schema has passed validation.
// Source wire shapes remain distinct: never accept new fields or species
// under an old discriminator on a later API call.
function migrateValidatedSaveData(data, options) {
  if (data.saveVersion === SAVE_VERSION && data.rosterRevision === SAVE_ROSTER_REVISION
    && data.achievements.contractVersion === ACHIEVEMENT_CONTRACT_VERSION) return data;
  const collection = data.saveVersion === 1 ? Object.freeze({ ...data.collection,
    catches: Object.freeze(data.collection.catches.map(record => Object.freeze({ ...record, qteSuccessCount: 0 }))) }) : data.collection;
  return validateSaveData({ ...data, saveVersion: SAVE_VERSION, rosterRevision: SAVE_ROSTER_REVISION,
    collection, achievements: migrateAchievementData(data.achievements, collection, options) });
}

// Assembly is separate from JSON and from domain reconstruction. No storage,
// wall-time catch-up, UI callbacks or changes to the supplied live objects.
export function createSaveData({ collection, achievements, boat, clock }, { savedAt = new Date().toISOString() } = {}) {
  return validateSaveData({ saveVersion: SAVE_VERSION, rosterRevision: SAVE_ROSTER_REVISION, savedAt,
    collection: { catches: collection.catches, wallet: collection.wallet, equipment: collection.equipment },
    achievements: achievements.snapshot, boat: { x: boat.x, z: boat.z, heading: boat.heading },
    clock: { elapsedSeconds: clock.state.elapsedSeconds }, settings: {} });
}

export function serializeSaveData(data, options) {
  const json = JSON.stringify(migrateValidatedSaveData(validateSaveData(data), options));
  requireValid(json.length <= SAVE_LIMITS.jsonCharacters, 'json', 'input-too-large');
  return json;
}

export function parseSaveData(json) {
  requireValid(typeof json === 'string', 'json');
  requireValid(json.length <= SAVE_LIMITS.jsonCharacters, 'json', 'input-too-large');
  let value;
  try { value = JSON.parse(json); }
  catch { throw new SaveDataError('invalid-json', 'json'); }
  return validateSaveData(value);
}

// A candidate is returned only after validation AND every constructor succeeds.
// No current game reference is accepted, so a failure cannot partially restore it.
export function restoreSaveData(data, { now = Date.now, gameplayFactory = createGameplay } = {}) {
  const validated = migrateValidatedSaveData(validateSaveData(data), { now });
  const collection = createCatchCollection({ initialData: validated.collection, now });
  const boat = createBoatState(validated.boat);
  const clock = createGameClock(undefined, validated.clock);
  return gameplayFactory({ collection, boat, clock, now, achievementData: validated.achievements });
}

// Expected input failures are classified. Programming/environment errors remain
// exceptions so callers do not silently mislabel them as corrupt player data.
export function tryRestoreSaveData(json, options) {
  try { return Object.freeze({ ok: true, state: restoreSaveData(parseSaveData(json), options) }); }
  catch (error) {
    if (!(error instanceof SaveDataError)) throw error;
    return Object.freeze({ ok: false, error: Object.freeze({ code: error.code, path: error.path }) });
  }
}
