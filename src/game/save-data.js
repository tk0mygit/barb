import { createCatchCollection } from './catch-collection.js';
import { createAchievements, validateAchievementData } from './achievements.js';
import { createBoatState, isNavigableBoatPosition } from './boat.js';
import { createGameClock } from './game-clock.js';
import { createFishing } from './fishing.js';
import { estimateWaterDepth } from '../world/depth.js';
import { shoreRadius } from '../world/config.js';
import { SAVE_LIMITS, SaveDataError, requireValid, objectFields, finite, timestamp, validateCollectionData } from './save-validation.js';

export { SAVE_LIMITS, SaveDataError } from './save-validation.js';
export const SAVE_VERSION = 1;

// Throws SaveDataError, returns a detached deeply frozen envelope. Unknown
// fields are rejected instead of being copied, recursively traversed or lost.
export function validateSaveData(value) {
  requireValid(value !== null && typeof value === 'object' && !Array.isArray(value), 'save');
  const version = Object.getOwnPropertyDescriptor(value, 'saveVersion');
  requireValid(version && 'value' in version && Number.isSafeInteger(version.value) && version.value >= 0, 'saveVersion');
  requireValid(version.value === SAVE_VERSION, 'saveVersion', 'unsupported-version');
  objectFields(value, ['saveVersion', 'savedAt', 'collection', 'achievements', 'boat', 'clock', 'settings'], [], 'save');
  timestamp(value.savedAt, 'savedAt');
  const collection = validateCollectionData(value.collection);
  const achievements = validateAchievementData(value.achievements, collection);
  objectFields(value.boat, ['x', 'z', 'heading'], [], 'boat');
  finite(value.boat.x, 'boat.x'); finite(value.boat.z, 'boat.z'); finite(value.boat.heading, 'boat.heading');
  requireValid(isNavigableBoatPosition(value.boat), 'boat');
  objectFields(value.clock, ['elapsedSeconds'], [], 'clock');
  finite(value.clock.elapsedSeconds, 'clock.elapsedSeconds', 0);
  objectFields(value.settings, [], [], 'settings');
  return Object.freeze({ saveVersion: SAVE_VERSION, savedAt: value.savedAt, collection, achievements,
    boat: Object.freeze({ x: value.boat.x, z: value.boat.z, heading: value.boat.heading }),
    clock: Object.freeze({ elapsedSeconds: value.clock.elapsedSeconds }), settings: Object.freeze({}) });
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
  const json = JSON.stringify(validateSaveData(data));
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
export function restoreSaveData(data, { now = Date.now } = {}) {
  const validated = validateSaveData(data);
  const collection = createCatchCollection({ initialData: validated.collection, now });
  const boat = createBoatState(validated.boat);
  const clock = createGameClock(undefined, validated.clock);
  const fishing = createFishing({ collection, now,
    isWater: (x, z) => Math.hypot(x, z) < shoreRadius(Math.atan2(z, x)) - 2,
    getBoatPosition: () => boat,
    getEnvironment: position => ({ depthM: estimateWaterDepth(position), ...clock.state }),
  });
  // Construct last: this is the only candidate object that subscribes to another.
  const achievements = createAchievements({ collection, initialData: validated.achievements, now });
  return Object.freeze({ collection, achievements, boat, clock, fishing });
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
