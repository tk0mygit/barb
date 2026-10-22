// Costs are for reaching this level; performance values are relative to Lv.1,
// never compounded. Phase 3C-1A exposes data only, without fishing integration.
export const EQUIPMENT_LEVELS = Object.freeze({
  rod: Object.freeze([
    { level: 1, cost: 0, castDistanceBonusM: 0, tensionMultiplier: 1.00 },
    { level: 2, cost: 300, castDistanceBonusM: 2, tensionMultiplier: 0.96 },
    { level: 3, cost: 800, castDistanceBonusM: 4, tensionMultiplier: 0.92 },
    { level: 4, cost: 1800, castDistanceBonusM: 6, tensionMultiplier: 0.88 },
    { level: 5, cost: 3600, castDistanceBonusM: 8, tensionMultiplier: 0.84 },
  ].map(Object.freeze)),
  reel: Object.freeze([
    { level: 1, cost: 0, reelSpeedMultiplier: 1.00, tensionReliefMultiplier: 1.00 },
    { level: 2, cost: 300, reelSpeedMultiplier: 1.06, tensionReliefMultiplier: 1.04 },
    { level: 3, cost: 800, reelSpeedMultiplier: 1.12, tensionReliefMultiplier: 1.08 },
    { level: 4, cost: 1800, reelSpeedMultiplier: 1.18, tensionReliefMultiplier: 1.12 },
    { level: 5, cost: 3600, reelSpeedMultiplier: 1.24, tensionReliefMultiplier: 1.16 },
  ].map(Object.freeze)),
});

export function getEquipmentLevel(kind, level) {
  if ((kind !== 'rod' && kind !== 'reel') || !Number.isSafeInteger(level) || level < 1) return null;
  return EQUIPMENT_LEVELS[kind][level - 1] ?? null;
}

export function getNextEquipmentLevel(kind, currentLevel) {
  return getEquipmentLevel(kind, currentLevel) ? getEquipmentLevel(kind, currentLevel + 1) : null;
}
