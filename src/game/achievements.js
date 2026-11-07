import { objectFields, arrayData, timestamp, requireValid } from './save-validation.js';
import { ORIGINAL_FISH_SPECIES_IDS } from './fish-roster.js';

// Stable public IDs. Definitions are shared by evaluation and presentation.
export const NORMAL_ACHIEVEMENTS = Object.freeze([
  { id: 'normal-first-catch', name: '始まり', description: '魚を初めて1匹釣り上げる。', metric: 'catches', target: 1 },
  { id: 'normal-catch-10', name: '収集せよ', description: '魚を累計10匹以上釣り上げる。', metric: 'catches', target: 10 },
  { id: 'normal-catch-50', name: '積み重なる記録', description: '魚を累計50匹以上釣り上げる。', metric: 'catches', target: 50 },
  { id: 'normal-catch-100', name: 'ノスタルジア', description: '魚を累計100匹以上釣り上げる。', metric: 'catches', target: 100 },
  { id: 'normal-species-5', name: '記録、収集', description: '異なる通常魚を5種以上捕獲する。', metric: 'species', target: 5 },
  { id: 'normal-species-12', name: '多様性', description: '最初の通常魚12種すべてを捕獲する。', metric: 'original-species', target: 12 },
  { id: 'normal-length-100', name: '特異個体', description: '体長100.0cm以上の魚を捕獲する。', metric: 'length', target: 100 },
  { id: 'normal-sales-10000', name: '等価交換', description: '累計売却額が10,000 Value以上になる。', metric: 'sales', target: 10000 },
  { id: 'normal-first-upgrade', name: '更新', description: 'ロッドまたはリールをLv.2以上に強化する。', metric: 'first-upgrade', target: 2 },
  { id: 'normal-equipment-max', name: '適合', description: 'ロッドとリールの両方をLv.5にする。', metric: 'equipment-max', target: 5 },
  { id: 'normal-rod-level-5', name: '手に馴染む', description: 'ロッドをLv.5以上に強化する。', metric: 'rod-level', target: 5 },
  { id: 'normal-reel-level-5', name: '反復動作', description: 'リールをLv.5以上に強化する。', metric: 'reel-level', target: 5 },
  { id: 'normal-rod-level-10', name: '手が覚えている', description: 'ロッドをLv.10に強化する。', metric: 'rod-level', target: 10 },
  { id: 'normal-reel-level-10', name: '円環', description: 'リールをLv.10に強化する。', metric: 'reel-level', target: 10 },
  { id: 'normal-equipment-level-10', name: '日が暮れる', description: 'ロッドとリールの両方をLv.10にする。', metric: 'equipment-max', target: 10 },
].map(Object.freeze));

const LEGACY_ACHIEVEMENTS = Object.freeze(NORMAL_ACHIEVEMENTS.slice(0, 10));
export const ACHIEVEMENT_CONTRACT_VERSION = 3;

function achievementValues(collection) {
  const { rodLevel, reelLevel } = collection.equipment;
  const speciesIds = new Set(collection.catches.map(record => record.speciesId));
  return {
    catches: collection.catches.length,
    species: speciesIds.size,
    'original-species': ORIGINAL_FISH_SPECIES_IDS.filter(id => speciesIds.has(id)).length,
    length: collection.catches.reduce((max, record) => Math.max(max, record.lengthCm), 0),
    sales: collection.wallet.lifetimeSales,
    'first-upgrade': Math.max(rodLevel, reelLevel),
    'equipment-max': Math.min(rodLevel, reelLevel),
    'rod-level': rodLevel,
    'reel-level': reelLevel,
  };
}

export function validateAchievementContract(value, contracts) {
  // Check a future discriminator before rejecting its unknown fields. A future
  // contract is protected, not mistaken for a corrupt replaceable slot.
  requireValid(value !== null && typeof value === 'object' && !Array.isArray(value), 'achievements');
  const version = Object.getOwnPropertyDescriptor(value, 'contractVersion');
  if (version) {
    requireValid('value' in version && Number.isSafeInteger(version.value) && version.value >= 0, 'achievements.contractVersion');
    requireValid(contracts.includes(version.value), 'achievements.contractVersion', 'unsupported-version');
  } else requireValid(contracts.includes(undefined), 'achievements.contractVersion');
  return version?.value;
}

export function validateAchievementData(value, collection, { contracts = [undefined, 2, ACHIEVEMENT_CONTRACT_VERSION] } = {}) {
  validateAchievementContract(value, contracts);
  objectFields(value, ['unlocked'], ['contractVersion'], 'achievements');
  const currentContract = Object.hasOwn(value, 'contractVersion');
  if (!currentContract) {
    // Only the original Lv.1–5 domains could produce the unversioned contract.
    for (const kind of ['rod', 'reel']) requireValid(collection.equipment[`${kind}Level`] <= 5, `collection.equipment.${kind}Level`);
  }
  if (value.contractVersion !== ACHIEVEMENT_CONTRACT_VERSION) {
    requireValid(collection.catches.every(record => ORIGINAL_FISH_SPECIES_IDS.includes(record.speciesId)), 'achievements.contractVersion');
  }
  const definitions = currentContract ? NORMAL_ACHIEVEMENTS : LEGACY_ACHIEVEMENTS;
  arrayData(value.unlocked, definitions.length, 'achievements.unlocked');
  const ids = new Set();
  const unlocked = value.unlocked.map((record, i) => {
    const path = `achievements.unlocked[${i}]`;
    objectFields(record, ['id', 'unlockedAt'], [], path);
    requireValid(definitions.some(definition => definition.id === record.id) && !ids.has(record.id), `${path}.id`);
    timestamp(record.unlockedAt, `${path}.unlockedAt`); ids.add(record.id);
    return Object.freeze({ id: record.id, unlockedAt: record.unlockedAt });
  });
  // All conditions are monotonic. Missing earned awards or impossible unlocked
  // awards indicate corruption; never manufacture historical timestamps.
  const values = achievementValues(collection);
  for (const definition of definitions) requireValid(ids.has(definition.id)
    === (values[definition.metric] >= definition.target), `achievements.${definition.id}`);
  return Object.freeze({ ...(currentContract ? { contractVersion: value.contractVersion } : {}), unlocked: Object.freeze(unlocked) });
}

// Source contracts must already be valid. Preserve every historical date;
// only awards introduced after an unversioned contract use migration time,
// matching the existing contract-2 equipment-award migration policy.
export function migrateAchievementData(value, collection, { now = Date.now } = {}) {
  const validated = validateAchievementData(value, collection);
  if (validated.contractVersion === ACHIEVEMENT_CONTRACT_VERSION) return validated;
  const ids = new Set(validated.unlocked.map(record => record.id));
  const values = achievementValues(collection);
  const pending = NORMAL_ACHIEVEMENTS.filter(definition => !ids.has(definition.id) && values[definition.metric] >= definition.target);
  const unlockedAt = pending.length ? new Date(now()).toISOString() : null;
  return validateAchievementData({ contractVersion: ACHIEVEMENT_CONTRACT_VERSION,
    unlocked: [...validated.unlocked, ...pending.map(({ id }) => ({ id, unlockedAt }))] }, collection);
}

// No DOM/renderer or independent progress counters.
export function createAchievements({ collection, now = Date.now, initialData }) {
  const restored = initialData === undefined ? [] : validateAchievementData(initialData, collection).unlocked;
  const unlocked = new Map(restored.map(record => [record.id, record.unlockedAt])), listeners = new Set();
  function entries() {
    const { rodLevel, reelLevel } = collection.equipment;
    const values = achievementValues(collection);
    return Object.freeze(NORMAL_ACHIEVEMENTS.map(definition => Object.freeze({
      ...definition,
      progress: Object.freeze({ value: values[definition.metric], target: definition.target,
        ...(['first-upgrade', 'equipment-max', 'rod-level', 'reel-level'].includes(definition.metric) ? { rodLevel, reelLevel } : {}) }),
      unlocked: unlocked.has(definition.id), unlockedAt: unlocked.get(definition.id) ?? null,
    })));
  }
  function evaluate() {
    const pending = entries().filter(entry => !entry.unlocked && (entry.metric === 'equipment-max'
      ? entry.progress.rodLevel >= entry.target && entry.progress.reelLevel >= entry.target
      : entry.progress.value >= entry.target));
    if (!pending.length) return Object.freeze([]);
    const unlockedAt = new Date(now()).toISOString();
    // Commit the entire batch before calling any presentation subscribers.
    for (const entry of pending) unlocked.set(entry.id, unlockedAt);
    const awards = Object.freeze(pending.map(entry => Object.freeze({ ...entry, unlocked: true, unlockedAt })));
    for (const listener of listeners) {
      try { listener(awards); } catch (error) { console.error('Achievement subscriber failed', error); }
    }
    return awards;
  }
  // Seed the complete restore history before the first evaluation or listener.
  evaluate();
  const unsubscribe = collection.subscribe(evaluate);
  return Object.freeze({
    evaluate,
    get entries() { return entries(); },
    get unlockedCount() { return unlocked.size; },
    get snapshot() {
      return Object.freeze({ contractVersion: ACHIEVEMENT_CONTRACT_VERSION,
        unlocked: Object.freeze([...unlocked].map(([id, unlockedAt]) => Object.freeze({ id, unlockedAt }))) });
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { unsubscribe(); listeners.clear(); },
  });
}
