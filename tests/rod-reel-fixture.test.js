import test from 'node:test';
import assert from 'node:assert/strict';
import { gearSave } from './helpers/rod-reel-save.js';
import { validateSaveData, restoreSaveData } from '../src/game/save-data.js';
import { calculateFishWeightKg } from '../src/game/fish-species.js';
import { calculateSalePrice } from '../src/game/fish-sales.js';

for (const balance of [1000, 100000]) {
  test(`gear purchase fixture: ${balance} funding has a canonical sold ledger and valid V2 restore`, () => {
    const save = gearSave({ balance });
    assert.equal(save.saveVersion, 2);
    assert.deepEqual(validateSaveData(save), save);
    assert.deepEqual(save.collection.wallet, { balance, lifetimeSales: balance });
    assert.equal(save.collection.catches.length, balance / 100);
    assert.equal(new Set(save.collection.catches.map(record => record.id)).size, balance / 100);
    const weightKg = calculateFishWeightKg('black-bass', 38.7);
    assert.equal(weightKg, 1);
    let soldTotal = 0;
    for (const record of save.collection.catches) {
      assert.equal(record.speciesId, 'black-bass'); assert.equal(record.lengthCm, 38.7);
      assert.equal(record.weightKg, weightKg); assert.equal(record.qteSuccessCount, 0);
      assert.equal(record.disposition, 'sold');
      assert.equal(record.caughtAt, '2026-11-01T00:00:00.000Z');
      assert.equal(record.soldAt, '2026-11-02T00:00:00.000Z');
      assert.equal(record.salePrice, calculateSalePrice(record));
      assert.equal(record.salePrice, 100);
      soldTotal += record.salePrice;
    }
    assert.equal(soldTotal, save.collection.wallet.lifetimeSales);
    const restored = restoreSaveData(save);
    assert.deepEqual(restored.collection.catches, save.collection.catches);
    assert.deepEqual(restored.collection.wallet, save.collection.wallet);
    assert.deepEqual(restored.collection.equipment, { rodLevel: 1, reelLevel: 1 });
  });
}

for (const version of [1, 2]) {
  test(`gear appearance fixture: zero-balance V${version} keeps the empty ledger`, () => {
    const save = gearSave({ version, level: 5 });
    assert.deepEqual(validateSaveData(save), save);
    assert.deepEqual(save.collection.catches, []);
    assert.deepEqual(save.collection.wallet, { balance: 0, lifetimeSales: 0 });
    assert.deepEqual(restoreSaveData(save).collection.equipment, { rodLevel: 5, reelLevel: 5 });
  });
}

test('gear funding rejects unbounded or non-integral fixture requests before constructing a ledger', () => {
  for (const balance of [-100, 1, 100.5, 100100, Infinity, NaN, '1000']) {
    assert.throws(() => gearSave({ balance }), RangeError);
  }
});
