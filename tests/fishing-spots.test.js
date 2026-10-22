import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FISHING_SPOTS } from '../src/world/fishing-spots.js';
import { getFishingSpotStatus } from '../src/game/fishing-spots.js';
import { createFishingSpotsView } from '../src/rendering/fishing-spots.js';
import { LAKE, shoreRadius, randomGenerator } from '../src/world/config.js';
import { createBoatState, stepBoat } from '../src/game/boat.js';
import { createFishing, PHASE } from '../src/game/fishing.js';
import { LURES } from '../src/game/lures.js';

test('three distinct spots and their entire effect circles are navigable, with clear routes from spawn', () => {
  assert.equal(FISHING_SPOTS.length, 3);
  assert.equal(new Set(FISHING_SPOTS.map(s => s.id)).size, 3);
  assert.equal(new Set(FISHING_SPOTS.map(s => s.name)).size, 3);
  assert.ok(Object.isFrozen(FISHING_SPOTS));
  for (const spot of FISHING_SPOTS) {
    assert.ok(Object.isFrozen(spot));
    assert.equal(spot.radius, 20); assert.equal(spot.hitMultiplier, 1.5);
    for (let angle = 0; angle < Math.PI * 2; angle += 0.02) {
      const x = spot.x + Math.cos(angle) * spot.radius, z = spot.z + Math.sin(angle) * spot.radius;
      assert.ok(Math.hypot(x, z) < shoreRadius(Math.atan2(z, x)) - LAKE.boatMargin);
    }
    const boat = createBoatState();
    boat.heading = Math.atan2(spot.x - boat.x, boat.z - spot.z);
    for (let frame = 0; frame < 1200 && Math.hypot(boat.x - spot.x, boat.z - spot.z) > 2; frame++) {
      stepBoat(boat, { throttle: 1, steer: 0 }, 1 / 60);
      assert.ok(Math.hypot(boat.x, boat.z) < shoreRadius(Math.atan2(boat.z, boat.x)) - LAKE.boatMargin);
    }
    assert.ok(Math.hypot(boat.x - spot.x, boat.z - spot.z) <= 2, spot.id);
  }
});

test('inclusive 20m XZ boundaries, outside reset, nearest name and strongest-only overlap', () => {
  for (const spot of FISHING_SPOTS) {
    for (const [dx, dz] of [[0, 0], [20, 0], [-20, 0], [0, 20], [0, -20], [12, 16]]) {
      const status = getFishingSpotStatus({ x: spot.x + dx, y: 10000, z: spot.z + dz });
      assert.equal(status.active.id, spot.id); assert.equal(status.hitMultiplier, 1.5);
    }
    for (const delta of [19.999999, 20.000001]) {
      const status = getFishingSpotStatus({ x: spot.x + delta, z: spot.z });
      assert.equal(status.hitMultiplier, delta < 20 ? 1.5 : 1);
      assert.equal(status.nearest.id, spot.id);
    }
  }
  const a = { id: 'a', x: 0, z: 0, radius: 20, hitMultiplier: 1.5 };
  const b = { ...a, id: 'b', x: 1 };
  assert.equal(getFishingSpotStatus({ x: 0, z: 0 }, [a, b]).hitMultiplier, 1.5);
  assert.equal(getFishingSpotStatus({ x: 1, z: 0 }, [a, b]).active.id, 'b');
  const strong = { ...b, hitMultiplier: 2 };
  assert.equal(getFishingSpotStatus({ x: 0, z: 0 }, [a, strong]).hitMultiplier, 2);
  assert.equal(getFishingSpotStatus({ x: 50, z: 0 }, [a, strong]).hitMultiplier, 1);
  assert.deepEqual(getFishingSpotStatus({ x: 0, z: 0 }, []), { active: null, nearest: null, distance: Infinity, hitMultiplier: 1 });
});

function castAt(position, random, lureId = 'minnow', getBoatPosition, heading = 0) {
  const f = createFishing({ random, getBoatPosition });
  f.selectLure(lureId); f.prepare(position, heading); f.aim(0, 180); f.cast();
  f.step(f.settings.flightSeconds + 0.001);
  return f;
}
function waitForBite(f) {
  let elapsed = 0;
  while (f.state.phase === PHASE.LURE && elapsed < 200) { f.step(0.01); elapsed += 0.01; }
  assert.equal(f.state.phase, PHASE.BITE);
  return elapsed;
}

test('all spots multiply the existing lure bite rates by 1.5 without changing the encounter or fight', () => {
  for (const spot of FISHING_SPOTS) for (const lure of LURES) {
    const inside = castAt(spot, () => 0.5, lure.id);
    const outside = castAt({ x: 0, z: 30 }, () => 0.5, lure.id);
    const insideTime = waitForBite(inside), outsideTime = waitForBite(outside);
    assert.ok(Math.abs((outsideTime - 3) / (insideTime - 3) - 1.5) < 0.01);
    assert.deepEqual(inside.state.encounter, outside.state.encounter);
    inside.hook(); outside.hook();
    inside.reel(true); outside.reel(true); inside.step(0.5); outside.step(0.5);
    assert.equal(inside.state.tension, outside.state.tension);
    assert.equal(inside.state.distance, outside.state.distance);
  }
  const flicked = castAt(FISHING_SPOTS[0], () => 0.5);
  flicked.step(3); flicked.flick();
  const waiting = castAt(FISHING_SPOTS[0], () => 0.5);
  assert.ok(3 + waitForBite(flicked) < waitForBite(waiting) - 0.3);
  assert.deepEqual(flicked.state.encounter, waiting.state.encounter);
});

test('boat position, never lure landing position, determines the effect and live movement restores normal rate', () => {
  const spot = FISHING_SPOTS[0];
  const inside = castAt(spot, () => 0.5);
  assert.equal(getFishingSpotStatus(inside.state.target).hitMultiplier, 1); // cast out of the circle
  const outsideBoat = { x: spot.x, z: spot.z + 30 };
  const outside = castAt(outsideBoat, () => 0.5);
  assert.equal(getFishingSpotStatus(outside.state.target).hitMultiplier, 1.5); // cast into the circle
  assert.ok(waitForBite(inside) < waitForBite(outside));
  const movingBoat = { ...spot };
  const moving = castAt(spot, () => 0.5, 'minnow', () => movingBoat);
  movingBoat.x += 21;
  const normal = castAt(outsideBoat, () => 0.5);
  assert.equal(waitForBite(moving), waitForBite(normal));
});

test('seeded real bite waits are shorter inside while species draws stay identical', t => {
  const outsideRandom = randomGenerator(991), insideRandom = randomGenerator(991);
  let outsideTotal = 0, insideTotal = 0, outsideEarly = 0, insideEarly = 0;
  for (let i = 0; i < 500; i++) {
    const outside = castAt({ x: 0, z: 30 }, outsideRandom);
    const inside = castAt(FISHING_SPOTS[0], insideRandom);
    const a = waitForBite(outside), b = waitForBite(inside);
    outsideTotal += a; insideTotal += b;
    outsideEarly += Number(a <= 10); insideEarly += Number(b <= 10);
    assert.deepEqual(outside.state.encounter, inside.state.encounter);
  }
  assert.ok(insideTotal < outsideTotal * 0.8);
  assert.ok(insideEarly > outsideEarly);
  t.diagnostic(`mean outside ${(outsideTotal / 500).toFixed(2)}s, inside ${(insideTotal / 500).toFixed(2)}s; bites within 10s ${outsideEarly}/500 vs ${insideEarly}/500`);
});

test('six lightweight water markers reuse geometry, show configured radii and highlight only the active spot', () => {
  const scene = new THREE.Scene(), view = createFishingSpotsView(scene);
  const group = scene.getObjectByName('fishing-spots');
  assert.equal(group.children.length, 6);
  assert.equal(new Set(group.children.map(mesh => mesh.geometry)).size, 2);
  for (const spot of FISHING_SPOTS) {
    const ring = scene.getObjectByName(`${spot.id}-range`);
    assert.equal(ring.position.x, spot.x); assert.equal(ring.position.z, spot.z);
    assert.ok(ring.position.y > 0.09); assert.equal(ring.scale.x, spot.radius);
    assert.equal(ring.material.depthWrite, false);
  }
  view.update(FISHING_SPOTS[0].id);
  assert.equal(scene.getObjectByName(`${FISHING_SPOTS[0].id}-range`).material.opacity, 0.4);
  assert.equal(scene.getObjectByName(`${FISHING_SPOTS[1].id}-range`).material.opacity, 0.2);
  view.update(undefined);
  assert.equal(scene.getObjectByName(`${FISHING_SPOTS[0].id}-range`).material.opacity, 0.2);
});
