import assert from 'node:assert/strict';

// Capture input, never a production RNG change. Historical evidence used .5.
// The 6-A fixture uses .01 so both the 12- and 20-fish source registries pick
// black bass at the same rounded size, keeping strict camera comparisons valid.
export function mobileFishingRandomValue(entry) {
  const value = Object.hasOwn(entry.metrics, 'fishingRandomValue') ? entry.metrics.fishingRandomValue : .5;
  assert.ok(value === .5 || value === .01, 'Unknown mobile fishing RNG fixture');
  return value;
}
