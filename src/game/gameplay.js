import { createBoatState } from './boat.js';
import { createGameClock } from './game-clock.js';
import { createCatchCollection } from './catch-collection.js';
import { createAchievements } from './achievements.js';
import { createFishing } from './fishing.js';
import { createQteOperationProvider } from './qte-operation-provider.js';
import { estimateWaterDepth } from '../world/depth.js';
import { shoreRadius } from '../world/config.js';

// The new-game and validated restore paths use the same assembly, before any
// UI/autosave subscription. Policy is injected by code, never player data.
export function createGameplay({ boat = createBoatState(), clock = createGameClock(),
  collection = createCatchCollection(), achievementData, now = Date.now,
  random = Math.random, qteEnabled = false, onFightEvent = () => {} } = {}) {
  let provider = null;
  const fishing = createFishing({ collection, now, random, onFightEvent,
    isWater: (x, z) => Math.hypot(x, z) < shoreRadius(Math.atan2(z, x)) - 2,
    getBoatPosition: () => boat,
    getEnvironment: position => ({ depthM: estimateWaterDepth(position), ...clock.state }),
    createFightQte: qteEnabled ? identity => {
      provider = createQteOperationProvider(identity);
      return { enabled: true, delivery: 'finite', selectOperation: provider.selectOperation };
    } : undefined,
  });
  // Last constructor: achievements alone subscribes to another candidate.
  const achievements = createAchievements({ collection, initialData: achievementData, now });
  return Object.freeze({ boat, clock, fishing, collection, achievements,
    get qteProvider() { return provider; } });
}
