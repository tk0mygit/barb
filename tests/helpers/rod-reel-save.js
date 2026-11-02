import { createCatchCollection } from '../../src/game/catch-collection.js';
import { createAchievements } from '../../src/game/achievements.js';
import { createBoatState } from '../../src/game/boat.js';
import { createGameClock } from '../../src/game/game-clock.js';
import { createSaveData, validateSaveData } from '../../src/game/save-data.js';
import { calculateFishWeightKg } from '../../src/game/fish-species.js';

export function gearSave({ level = 1, version = 2, seconds = 90, balance = 0 } = {}) {
  if (!Number.isSafeInteger(balance) || balance < 0 || balance > 100000 || balance % 100 !== 0) {
    throw new RangeError('Gear fixture funding requires a bounded multiple of 100');
  }
  let catches = [], wallet = { balance: 0, lifetimeSales: 0 };
  if (balance > 0) {
    // Fund the initial condition through the real collection/sale API. A
    // wallet without the matching sold ledger is correctly rejected by the
    // production save validator; do not bypass that protection for this test.
    const funding = createCatchCollection({ now: () => Date.parse('2026-11-02T00:00:00.000Z') });
    const weightKg = calculateFishWeightKg('black-bass', 38.7);
    for (let index = 0; index < balance / 100; index++) {
      const id = `rod-reel-funding-${index}`;
      funding.register({ schemaVersion: 1, id, speciesId: 'black-bass', lengthCm: 38.7, weightKg,
        caughtAt: '2026-11-01T00:00:00.000Z', qteSuccessCount: 0 });
      funding.sellUnassigned(id);
    }
    catches = funding.catches; wallet = funding.wallet;
  }
  const collection = createCatchCollection({ initialData: { catches, wallet,
    equipment: { rodLevel: level, reelLevel: level } } });
  const data = createSaveData({ collection, achievements: createAchievements({ collection }),
    boat: createBoatState({ x: 10, z: 20, heading: 0 }), clock: createGameClock(undefined, { elapsedSeconds: seconds }) },
  { savedAt: '2026-11-02T00:00:00.000Z' });
  // Empty-history V1 is its real wire schema: no V2 catch fields to remove.
  return validateSaveData({ ...data, saveVersion: version });
}
