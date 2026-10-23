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
].map(Object.freeze));

// No DOM/renderer, independent counters, persistence or restore format.
export function createAchievements({ collection, now = Date.now }) {
  const unlocked = new Map(), listeners = new Set();
  function entries() {
    const { rodLevel, reelLevel } = collection.equipment;
    const values = {
      catches: collection.catches.length,
      species: collection.encyclopedia.filter(entry => entry.count > 0).length,
      length: collection.catches.reduce((max, record) => Math.max(max, record.lengthCm), 0),
      sales: collection.wallet.lifetimeSales,
      'first-upgrade': Math.max(rodLevel, reelLevel),
      'equipment-max': Math.min(rodLevel, reelLevel),
    };
    return Object.freeze(NORMAL_ACHIEVEMENTS.map(definition => Object.freeze({
      ...definition,
      progress: Object.freeze({ value: values[definition.metric], target: definition.target,
        ...(['first-upgrade', 'equipment-max'].includes(definition.metric) ? { rodLevel, reelLevel } : {}) }),
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
  const unsubscribe = collection.subscribe(evaluate);
  evaluate();
  return Object.freeze({
    evaluate,
    get entries() { return entries(); },
    get unlockedCount() { return unlocked.size; },
    get snapshot() {
      return Object.freeze({ unlocked: Object.freeze([...unlocked].map(([id, unlockedAt]) => Object.freeze({ id, unlockedAt }))) });
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { unsubscribe(); listeners.clear(); },
  });
}
