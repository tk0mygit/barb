import { getFishSpecies } from './fish-species.js';
import { getEquipmentLevel } from './equipment.js';
import { calculateSalePrice, addMoney } from './fish-sales.js';
import { getLure } from './lures.js';
import { getDepthBand } from '../world/depth.js';

// Transport limits, not gameplay/storage capacity. Keep traversal shallow and
// bounded even for direct object input; never recursively copy unknown fields.
export const SAVE_LIMITS = Object.freeze({ jsonCharacters: 64 * 1024 * 1024, catches: 100000, idCharacters: 256 });

export class SaveDataError extends Error {
  constructor(code, path) {
    super(`${code}: ${path}`);
    this.name = 'SaveDataError'; this.code = code; this.path = path;
  }
}
export function requireValid(condition, path, code = 'invalid-data') {
  if (!condition) throw new SaveDataError(code, path);
}
export function objectFields(value, required, optional, path) {
  requireValid(value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)), path);
  const keys = Reflect.ownKeys(value);
  requireValid(keys.length <= required.length + optional.length, path);
  for (const key of required) requireValid(Object.hasOwn(value, key), `${path}.${key}`);
  for (const key of keys) {
    requireValid(required.includes(key) || optional.includes(key), path);
    // JSON has data properties only. Avoid invoking getters in object APIs.
    requireValid('value' in Object.getOwnPropertyDescriptor(value, key), `${path}.${key}`);
  }
}
export function arrayData(value, maxLength, path) {
  requireValid(Array.isArray(value), path);
  requireValid(value.length <= maxLength, path, 'input-too-large');
  requireValid(Reflect.ownKeys(value).length === value.length + 1, path);
  for (let i = 0; i < value.length; i++) {
    requireValid(Object.hasOwn(value, i) && 'value' in Object.getOwnPropertyDescriptor(value, i), path);
  }
}
export function finite(value, path, min = -Infinity, max = Infinity) {
  requireValid(Number.isFinite(value) && value >= min && value <= max, path);
}
export function money(value, path) {
  requireValid(Number.isSafeInteger(value) && value >= 0, path);
}
export function timestamp(value, path) {
  requireValid(typeof value === 'string' && value.length <= 32, path);
  // Permit UTC ISO timestamps with or without milliseconds, including the
  // extended years emitted by Date.toISOString(). Reject calendar rollover.
  requireValid(/^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value), path);
  const milliseconds = Date.parse(value);
  requireValid(Number.isFinite(milliseconds), path);
  const canonical = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction = '') => `.${fraction.padEnd(3, '0')}Z`);
  requireValid(new Date(milliseconds).toISOString() === canonical, path);
}

function conditionsData(value, path) {
  const keys = ['depthM', 'depthBand', 'timeOfDay', 'cycleProgress', 'lureId', 'lurePosition'];
  objectFields(value, [], keys, path);
  const result = {};
  if (Object.hasOwn(value, 'depthM')) {
    if (value.depthM !== null) finite(value.depthM, `${path}.depthM`, 0);
    result.depthM = value.depthM;
  }
  if (Object.hasOwn(value, 'depthBand')) {
    requireValid([null, 'shallow', 'mid', 'deep'].includes(value.depthBand), `${path}.depthBand`);
    if (Object.hasOwn(value, 'depthM')) requireValid(value.depthBand === getDepthBand(value.depthM), `${path}.depthBand`);
    result.depthBand = value.depthBand;
  }
  if (Object.hasOwn(value, 'timeOfDay')) {
    requireValid([null, 'day', 'night'].includes(value.timeOfDay), `${path}.timeOfDay`);
    result.timeOfDay = value.timeOfDay;
  }
  if (Object.hasOwn(value, 'cycleProgress')) {
    if (value.cycleProgress !== null) {
      finite(value.cycleProgress, `${path}.cycleProgress`, 0);
      requireValid(value.cycleProgress < 1, `${path}.cycleProgress`);
    }
    result.cycleProgress = value.cycleProgress;
  }
  if (Object.hasOwn(value, 'lureId')) {
    requireValid(typeof value.lureId === 'string' && !!getLure(value.lureId), `${path}.lureId`);
    result.lureId = value.lureId;
  }
  if (Object.hasOwn(value, 'lurePosition')) {
    objectFields(value.lurePosition, ['x', 'z'], [], `${path}.lurePosition`);
    finite(value.lurePosition.x, `${path}.lurePosition.x`); finite(value.lurePosition.z, `${path}.lurePosition.z`);
    result.lurePosition = Object.freeze({ x: value.lurePosition.x, z: value.lurePosition.z });
  }
  return Object.freeze(result);
}

// Returns detached, frozen canonical data. Constructors can also use this
// boundary directly without depending on the outer save-version envelope.
export function validateCollectionData(value) {
  objectFields(value, ['catches', 'wallet', 'equipment'], [], 'collection');
  arrayData(value.catches, SAVE_LIMITS.catches, 'collection.catches');
  const ids = new Set();
  let totalSales = 0;
  const catches = value.catches.map((record, i) => {
    const path = `collection.catches[${i}]`;
    objectFields(record, ['schemaVersion', 'id', 'speciesId', 'lengthCm', 'weightKg', 'caughtAt', 'disposition'],
      ['conditions', 'salePrice', 'soldAt'], path);
    requireValid(record.schemaVersion === 1, `${path}.schemaVersion`);
    requireValid(typeof record.id === 'string' && record.id.trim().length > 0, `${path}.id`);
    requireValid(record.id.length <= SAVE_LIMITS.idCharacters, `${path}.id`, 'input-too-large');
    requireValid(!ids.has(record.id), `${path}.id`); ids.add(record.id);
    requireValid(typeof record.speciesId === 'string' && !!getFishSpecies(record.speciesId), `${path}.speciesId`);
    finite(record.lengthCm, `${path}.lengthCm`); finite(record.weightKg, `${path}.weightKg`);
    requireValid(record.lengthCm > 0 && record.weightKg > 0, path);
    // Keep positive legacy sizes, but ensure each fish can still be quoted.
    try { calculateSalePrice(record); } catch { throw new SaveDataError('invalid-data', `${path}.weightKg`); }
    timestamp(record.caughtAt, `${path}.caughtAt`);
    requireValid(['unassigned', 'stored', 'sold'].includes(record.disposition), `${path}.disposition`);
    const copy = { schemaVersion: 1, id: record.id, speciesId: record.speciesId, lengthCm: record.lengthCm,
      weightKg: record.weightKg, caughtAt: record.caughtAt, disposition: record.disposition };
    if (Object.hasOwn(record, 'conditions')) copy.conditions = conditionsData(record.conditions, `${path}.conditions`);
    if (record.disposition === 'sold') {
      money(record.salePrice, `${path}.salePrice`); timestamp(record.soldAt, `${path}.soldAt`);
      try { totalSales = addMoney(totalSales, record.salePrice); }
      catch { throw new SaveDataError('invalid-data', 'collection.wallet.lifetimeSales'); }
      copy.salePrice = record.salePrice; copy.soldAt = record.soldAt;
    } else requireValid(!Object.hasOwn(record, 'salePrice') && !Object.hasOwn(record, 'soldAt'), path);
    return Object.freeze(copy);
  });
  objectFields(value.wallet, ['balance', 'lifetimeSales'], [], 'collection.wallet');
  money(value.wallet.balance, 'collection.wallet.balance'); money(value.wallet.lifetimeSales, 'collection.wallet.lifetimeSales');
  requireValid(value.wallet.lifetimeSales === totalSales && value.wallet.balance <= totalSales, 'collection.wallet');
  objectFields(value.equipment, ['rodLevel', 'reelLevel'], [], 'collection.equipment');
  for (const kind of ['rod', 'reel']) requireValid(!!getEquipmentLevel(kind, value.equipment[`${kind}Level`]), `collection.equipment.${kind}Level`);
  return Object.freeze({ catches: Object.freeze(catches),
    wallet: Object.freeze({ balance: value.wallet.balance, lifetimeSales: value.wallet.lifetimeSales }),
    equipment: Object.freeze({ rodLevel: value.equipment.rodLevel, reelLevel: value.equipment.reelLevel }) });
}
