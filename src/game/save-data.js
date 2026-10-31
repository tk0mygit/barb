import { createCatchCollection } from './catch-collection.js';
import { validateAchievementData } from './achievements.js';
import { createBoatState, isNavigableBoatPosition } from './boat.js';
import { createGameClock } from './game-clock.js';
import { createGameplay } from './gameplay.js';
import { SAVE_LIMITS, SaveDataError, requireValid, objectFields, finite, timestamp, validateCollectionData, validateLegacyCollectionData } from './save-validation.js';

export { SAVE_LIMITS, SaveDataError } from './save-validation.js';
export const SAVE_VERSION = 2;

// Throws SaveDataError, returns a detached deeply frozen envelope. Unknown
// fields are rejected instead of being copied, recursively traversed or lost.
export function validateSaveData(value) {
  requireValid(value !== null && typeof value === 'object' && !Array.isArray(value), 'save');
  const version = Object.getOwnPropertyDescriptor(value, 'saveVersion');
  requireValid(version && 'value' in version && Number.isSafeInteger(version.value) && version.value >= 0, 'saveVersion');
  requireValid(version.value === 1 || version.value === SAVE_VERSION, 'saveVersion', 'unsupported-version');
  objectFields(value, ['saveVersion', 'savedAt', 'collection', 'achievements', 'boat', 'clock', 'settings'], [], 'save');
  timestamp(value.savedAt, 'savedAt');
  const collection = version.value === 1 ? validateLegacyCollectionData(value.collection) : validateCollectionData(value.collection);
  const achievements = validateAchievementData(value.achievements, collection);
  objectFields(value.boat, ['x', 'z', 'heading'], [], 'boat');
  finite(value.boat.x, 'boat.x'); finite(value.boat.z, 'boat.z'); finite(value.boat.heading, 'boat.heading');
  requireValid(isNavigableBoatPosition(value.boat), 'boat');
  objectFields(value.clock, ['elapsedSeconds'], [], 'clock');
  finite(value.clock.elapsedSeconds, 'clock.elapsedSeconds', 0);
  objectFields(value.settings, [], [], 'settings');
  return Object.freeze({ saveVersion: version.value, savedAt: value.savedAt, collection, achievements,
    boat: Object.freeze({ x: value.boat.x, z: value.boat.z, heading: value.boat.heading }),
    clock: Object.freeze({ elapsedSeconds: value.clock.elapsedSeconds }), settings: Object.freeze({}) });
}

// Call only after the complete source-version schema has passed validation.
// Keeping validation's V1 wire shape distinct prevents canonical V2 records
// from being accepted under a V1 discriminator on a later API call.
function migrateValidatedSaveData(data) {
  if (data.saveVersion === SAVE_VERSION) return data;
  return Object.freeze({ ...data, saveVersion: SAVE_VERSION,
    collection: Object.freeze({ ...data.collection,
      catches: Object.freeze(data.collection.catches.map(record => Object.freeze({ ...record, qteSuccessCount: 0 }))) }) });
}

// Assembly is separate from JSON and from domain reconstruction. No storage,
// wall-time catch-up, UI callbacks or changes to the supplied live objects.
export function createSaveData({ collection, achievements, boat, clock }, { savedAt = new Date().toISOString() } = {}) {
  return validateSaveData({ saveVersion: SAVE_VERSION, savedAt,
    collection: { catches: collection.catches, wallet: collection.wallet, equipment: collection.equipment },
    achievements: achievements.snapshot, boat: { x: boat.x, z: boat.z, heading: boat.heading },
    clock: { elapsedSeconds: clock.state.elapsedSeconds }, settings: {} });
}

export function serializeSaveData(data) {
  const json = JSON.stringify(migrateValidatedSaveData(validateSaveData(data)));
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
  const validated = migrateValidatedSaveData(validateSaveData(data));
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
