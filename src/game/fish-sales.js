import { getFishSpecies } from './fish-species.js';

// Round the decimal kg value half up. Decimal arithmetic avoids e.g.
// 90 * 1.15 becoming 103.49999999999999 in binary floating point.
export function calculateSalePrice({ speciesId, weightKg }) {
  const fish = getFishSpecies(speciesId);
  if (!fish || !Number.isFinite(weightKg) || weightKg <= 0
    || !Number.isSafeInteger(fish.basePricePerKg) || fish.basePricePerKg < 0) throw new RangeError('Invalid sale price inputs');
  const [coefficient, exponent = '0'] = String(weightKg).split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  const scale = fraction.length - Number(exponent);
  let amount = BigInt(whole + fraction) * BigInt(fish.basePricePerKg);
  if (scale > 0) {
    const divisor = 10n ** BigInt(scale);
    amount = (amount + divisor / 2n) / divisor;
  } else amount *= 10n ** BigInt(-scale);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Sale price exceeds safe integer range');
  return Number(amount);
}

export function addMoney(a, b) {
  if (![a, b, a + b].every(n => Number.isSafeInteger(n) && n >= 0)) throw new RangeError('Money must be non-negative safe integers');
  return a + b;
}
