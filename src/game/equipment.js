// Costs are for reaching this level; performance values are relative to Lv.1,
// never compounded. Fishing captures both equipment rows once per cast.
export const EQUIPMENT_LEVELS = Object.freeze({
  rod: Object.freeze([
    { level: 1, cost: 0, castDistanceBonusM: 0, tensionMultiplier: 1.00 },
    { level: 2, cost: 300, castDistanceBonusM: 2, tensionMultiplier: 0.96 },
    { level: 3, cost: 800, castDistanceBonusM: 4, tensionMultiplier: 0.92 },
    { level: 4, cost: 1800, castDistanceBonusM: 6, tensionMultiplier: 0.88 },
    { level: 5, cost: 3600, castDistanceBonusM: 8, tensionMultiplier: 0.84 },
    { level: 6, cost: 4200, castDistanceBonusM: 12, tensionMultiplier: 0.79 },
    { level: 7, cost: 5200, castDistanceBonusM: 16, tensionMultiplier: 0.74 },
    { level: 8, cost: 6500, castDistanceBonusM: 20, tensionMultiplier: 0.69 },
    { level: 9, cost: 8200, castDistanceBonusM: 24, tensionMultiplier: 0.64 },
    { level: 10, cost: 10000, castDistanceBonusM: 28, tensionMultiplier: 0.59 },
  ].map(Object.freeze)),
  reel: Object.freeze([
    { level: 1, cost: 0, reelSpeedMultiplier: 1.00, tensionReliefMultiplier: 1.00 },
    { level: 2, cost: 300, reelSpeedMultiplier: 1.06, tensionReliefMultiplier: 1.04 },
    { level: 3, cost: 800, reelSpeedMultiplier: 1.12, tensionReliefMultiplier: 1.08 },
    { level: 4, cost: 1800, reelSpeedMultiplier: 1.18, tensionReliefMultiplier: 1.12 },
    { level: 5, cost: 3600, reelSpeedMultiplier: 1.24, tensionReliefMultiplier: 1.16 },
    { level: 6, cost: 4200, reelSpeedMultiplier: 1.33, tensionReliefMultiplier: 1.22 },
    { level: 7, cost: 5200, reelSpeedMultiplier: 1.43, tensionReliefMultiplier: 1.28 },
    { level: 8, cost: 6500, reelSpeedMultiplier: 1.54, tensionReliefMultiplier: 1.34 },
    { level: 9, cost: 8200, reelSpeedMultiplier: 1.65, tensionReliefMultiplier: 1.40 },
    { level: 10, cost: 10000, reelSpeedMultiplier: 1.77, tensionReliefMultiplier: 1.46 },
  ].map(Object.freeze)),
});

export function getEquipmentLevel(kind, level) {
  if ((kind !== 'rod' && kind !== 'reel') || !Number.isSafeInteger(level) || level < 1) return null;
  return EQUIPMENT_LEVELS[kind][level - 1] ?? null;
}

export function getNextEquipmentLevel(kind, currentLevel) {
  return getEquipmentLevel(kind, currentLevel) ? getEquipmentLevel(kind, currentLevel + 1) : null;
}
