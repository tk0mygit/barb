import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoatState, stepBoat, isStopped, enterFishing, leaveFishing } from '../src/game/boat.js';
import { shoreRadius, LAKE } from '../src/world/config.js';

function simulate(boat, input, seconds, hz = 60) {
  for (let i = 0; i < seconds * hz; i++) stepBoat(boat, input, 1 / hz);
}
test('accelerates, steers and coasts to a full stop on release', () => {
  const boat = createBoatState();
  simulate(boat, { throttle: 1, steer: 0.3 }, 2);
  assert.ok(boat.speed > 7 && boat.x > 0 && boat.z < 30);
  assert.equal(enterFishing(boat), false);
  simulate(boat, { throttle: 0, steer: 0 }, 3);
  assert.equal(boat.speed, 0);
  assert.ok(isStopped(boat));
});
test('fishing requires stopping and prevents boat movement', () => {
  const boat = createBoatState();
  assert.equal(enterFishing(boat), true);
  const before = { ...boat };
  simulate(boat, { throttle: 1, steer: 1 }, 2);
  assert.deepEqual(boat, before);
  leaveFishing(boat);
  simulate(boat, { throttle: 1, steer: 0 }, 1);
  assert.ok(boat.z < before.z);
});
test('boats cannot cross the shoreline in any direction', () => {
  for (let heading = 0; heading < Math.PI * 2; heading += 0.2) {
    const boat = createBoatState();
    boat.heading = heading;
    simulate(boat, { throttle: 1, steer: 0 }, 40);
    assert.ok(Math.hypot(boat.x, boat.z) <= shoreRadius(Math.atan2(boat.z, boat.x)) - LAKE.boatMargin + 1e-8);
  }
});
test('motion is comparable at 30 and 120 fps', () => {
  const a = createBoatState(), b = createBoatState();
  simulate(a, { throttle: 1, steer: 0 }, 3, 30);
  simulate(b, { throttle: 1, steer: 0 }, 3, 120);
  assert.ok(Math.abs(a.z - b.z) < 0.15);
  assert.ok(Math.abs(a.speed - b.speed) < 1e-8);
});
test('long frames are bounded to avoid teleporting after suspension', () => {
  const boat = createBoatState();
  stepBoat(boat, { throttle: 1, steer: 0 }, 100);
  assert.ok(Math.abs(boat.z - 30) < 0.1);
});
