import { objectFields, arrayData, timestamp, requireValid } from './save-validation.js';

// Stable public IDs. Definitions are shared by evaluation and presentation.
export const NORMAL_ACHIEVEMENTS = Object.freeze([
  { id: 'normal-first-catch', name: '初めての一匹', description: '魚を初めて1匹釣り上げる。', metric: 'catches', target: 1 },
  { id: 'normal-catch-10', name: '累計10匹', description: '魚を累計10匹以上釣り上げる。', metric: 'catches', target: 10 },
  { id: 'normal-catch-50', name: '累計50匹', description: '魚を累計50匹以上釣り上げる。', metric: 'catches', target: 50 },
  { id: 'normal-catch-100', name: '累計100匹', description: '魚を累計100匹以上釣り上げる。', metric: 'catches', target: 100 },
  { id: 'normal-species-5', name: '5種発見', description: '異なる通常魚を5種以上捕獲する。', metric: 'species', target: 5 },
  { id: 'normal-species-12', name: '全12種発見', description: '通常魚12種すべてを捕獲する。', metric: 'species', target: 12 },
  { id: 'normal-length-100', name: '大物ハンター', description: '体長100.0cm以上の魚を捕獲する。', metric: 'length', target: 100 },
  { id: 'normal-sales-10000', name: '累計売却10,000', description: '累計売却額が10,000通貨以上になる。', metric: 'sales', target: 10000 },
  { id: 'normal-first-upgrade', name: '初強化', description: 'ロッドまたはリールをLv.2以上に強化する。', metric: 'first-upgrade', target: 2 },
  { id: 'normal-equipment-max', name: '最大強化', description: 'ロッドとリールの両方をLv.5にする。', metric: 'equipment-max', target: 5 },
  { id: 'normal-rod-level-5', name: 'ロッドLv.5', description: 'ロッドをLv.5以上に強化する。', metric: 'rod-level', target: 5 },
  { id: 'normal-reel-level-5', name: 'リールLv.5', description: 'リールをLv.5以上に強化する。', metric: 'reel-level', target: 5 },
  { id: 'normal-rod-level-10', name: 'ロッドLv.10', description: 'ロッドをLv.10に強化する。', metric: 'rod-level', target: 10 },
  { id: 'normal-reel-level-10', name: 'リールLv.10', description: 'リールをLv.10に強化する。', metric: 'reel-level', target: 10 },
  { id: 'normal-equipment-level-10', name: '両装備Lv.10', description: 'ロッドとリールの両方をLv.10にする。', metric: 'equipment-max', target: 10 },
].map(Object.freeze));

const LEGACY_ACHIEVEMENTS = Object.freeze(NORMAL_ACHIEVEMENTS.slice(0, 10));
const ACHIEVEMENT_CONTRACT_VERSION = 2;

function achievementValues(collection) {
  const { rodLevel, reelLevel } = collection.equipment;
  return {
    catches: collection.catches.length,
    species: new Set(collection.catches.map(record => record.speciesId)).size,
    length: collection.catches.reduce((max, record) => Math.max(max, record.lengthCm), 0),
    sales: collection.wallet.lifetimeSales,
    'first-upgrade': Math.max(rodLevel, reelLevel),
    'equipment-max': Math.min(rodLevel, reelLevel),
    'rod-level': rodLevel,
    'reel-level': reelLevel,
  };
}

export function validateAchievementData(value, collection) {
  objectFields(value, ['unlocked'], ['contractVersion'], 'achievements');
  const currentContract = Object.hasOwn(value, 'contractVersion');
  if (currentContract) {
    requireValid(Number.isSafeInteger(value.contractVersion) && value.contractVersion >= 0, 'achievements.contractVersion');
    requireValid(value.contractVersion === ACHIEVEMENT_CONTRACT_VERSION, 'achievements.contractVersion', 'unsupported-version');
  } else {
    // Only the original Lv.1–5 domains could produce the unversioned contract.
    for (const kind of ['rod', 'reel']) requireValid(collection.equipment[`${kind}Level`] <= 5, `collection.equipment.${kind}Level`);
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
  return Object.freeze({ ...(currentContract ? { contractVersion: ACHIEVEMENT_CONTRACT_VERSION } : {}), unlocked: Object.freeze(unlocked) });
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
