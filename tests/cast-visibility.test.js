import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCastVisibility, projectCastFootprint } from '../src/rendering/cast-visibility.js';
import { nearRingExpansion } from '../src/rendering/fishing-visuals.js';
import { createFishing, getLurePosition, PHASE } from '../src/game/fishing.js';
import { createCatchCollection } from '../src/game/catch-collection.js';

const sizes = [[1000, 700], [390, 844], [844, 390], [320, 568]];
function view(width, height, heading = 0, origin = { x: 0, z: 30 }) {
  const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 2400);
  camera.position.set(origin.x - Math.sin(heading) * 1.25, 2.15, origin.z + Math.cos(heading) * 1.25);
  camera.lookAt(camera.position.x + Math.sin(heading) * 20, 2.15, camera.position.z - Math.cos(heading) * 20);
  let viewport = { width, height };
  const visibility = createCastVisibility(camera, () => viewport);
  return { camera, visibility, origin, setViewport(next) {
    viewport = next; camera.aspect = next.width / next.height; camera.updateProjectionMatrix();
  } };
}
function fits(bounds, width, height, insets = {}) {
  assert.equal(bounds.clipped, false);
  assert.ok(bounds.left >= 12 + (insets.left ?? 0) - 1e-7, `left=${bounds.left}`);
  assert.ok(bounds.right <= width - 12 - (insets.right ?? 0) + 1e-7, `right=${bounds.right}`);
  assert.ok(bounds.top >= 12 + (insets.top ?? 0) - 1e-7, `top=${bounds.top}`);
  assert.ok(bounds.bottom <= height - 12 - (insets.bottom ?? 0) + 1e-7, `bottom=${bounds.bottom}`);
}

for (const [width, height] of sizes) {
  test(`${width}x${height}: full rings/lure stay inside 12 CSS px at central/extreme directions and all retrieval distances`, () => {
    for (const heading of [0, Math.PI - 1e-8, -Math.PI + 1e-8, 2 * Math.PI + 0.4]) {
      const { visibility, origin } = view(width, height, heading);
      for (const distance of [5.5, 8, 32, 40]) {
        const limits = visibility.constrain({ origin, heading, requestedDistance: distance, spread: 0.7 });
        assert.equal(limits.valid, true);
        for (const offset of [limits.minAngle, 0, limits.maxAngle]) {
          const castHeading = heading + offset;
          assert.equal(visibility.isVisible({ origin, heading: castHeading, distance }), true);
          const at = (d, radius) => visibility.footprint({ x: origin.x + Math.sin(castHeading) * d,
            z: origin.z - Math.cos(castHeading) * d, radius });
          fits(at(distance, 0.7 * (1 + 1.6 * nearRingExpansion(distance))), width, height);
          for (let d = 4.5; d <= distance; d += 0.25) {
            fits(at(d, 0.7 * (1 + 0.9 * nearRingExpansion(d))), width, height);
          }
        }
      }
    }
  });
}

test('aspect, safe-area and real HUD bounds continuously restrict each side without jumping over an obstruction', () => {
  const { visibility, origin, setViewport } = view(1000, 700);
  const args = { origin, heading: 0, requestedDistance: 32, spread: 0.7 };
  const desktop = visibility.constrain(args);
  setViewport({ width: 390, height: 844 });
  const portrait = visibility.constrain(args);
  assert.ok(portrait.maxAngle < desktop.maxAngle / 2);
  setViewport({ width: 390, height: 844, insets: { left: 10, right: 10, bottom: 20 } });
  const inset = visibility.constrain(args);
  assert.ok(inset.maxAngle < portrait.maxAngle);
  setViewport({ width: 390, height: 844, occlusions: [{ left: 0, right: 40, top: 0, bottom: 844 }] });
  const hud = visibility.constrain(args);
  assert.equal(hud.valid, true);
  assert.ok(Math.abs(hud.minAngle) < portrait.maxAngle);
  assert.equal(hud.maxAngle, portrait.maxAngle);
  setViewport({ width: 390, height: 844, occlusions: [{ left: 0, right: 390, top: 400, bottom: 844 }] });
  assert.equal(visibility.constrain(args).valid, false);
});

test('real projection rejects behind-eye and clipped bounds rather than treating NDC x/y alone as visible', () => {
  const { camera, visibility } = view(390, 844);
  assert.equal(visibility.isVisible({ origin: { x: 0, z: 30 }, heading: Math.PI, distance: 32 }), false);
  const behind = projectCastFootprint(camera, { x: 0, z: 50 }, { width: 390, height: 844 });
  assert.equal(behind.clipped, true);
});

test('adaptive retrieval bounds pass corner notices while rejecting actual intermediate overlap', () => {
  const { visibility, origin, setViewport } = view(390, 844);
  const options = { origin, heading: 0, distance: 32 };
  const near = visibility.footprint({ x: origin.x, z: origin.z - 8, radius: 1.33 });
  const far = visibility.footprint({ x: origin.x, z: origin.z - 32, radius: 1.33 });
  const corner = { left: 12, right: 112, top: 422, bottom: 470 };
  // The original coarse [8m,32m] rectangle covers this notice, although
  // the actual marker reaches its leftmost pixels much lower on the screen.
  assert.ok(Math.min(near.left, far.left) < corner.right + 12);
  assert.ok(Math.min(near.top, far.top) < corner.bottom + 12);
  setViewport({ width: 390, height: 844, occlusions: [corner,
    { left: 278, right: 378, top: 422, bottom: 470 }] });
  assert.equal(visibility.isVisible(options), true);
  assert.equal(visibility.constrain({ origin, heading: 0, requestedDistance: 32, spread: 0.7 }).valid, true);
  // Both segment endpoints miss this small obstruction. The marker crosses
  // it between them, so merely accepting safe endpoints would be incorrect.
  const crossing = { left: 130, right: 150, top: 505, bottom: 520 };
  assert.ok(near.top > crossing.bottom + 12);
  assert.ok(far.bottom < crossing.top - 12);
  setViewport({ width: 390, height: 844, occlusions: [crossing] });
  assert.equal(visibility.isVisible(options), false);
  assert.equal(visibility.constrain({ origin, heading: 0, requestedDistance: 32, spread: 0.7 }).valid, false);
});

test('bounded gestures keep the original 8/32/40m balance and match AIM X/Z to LURE exactly', () => {
  for (const [width, height] of sizes) for (const level of [1, 5]) for (const [dx, dy] of [[0, 0], [-180, 0], [0, 180], [180, 0]]) {
    const { visibility, origin } = view(width, height);
    const collection = createCatchCollection();
    collection.register({ schemaVersion: 1, id: 'fund', speciesId: 'black-bass', lengthCm: 50,
      weightKg: 100, caughtAt: '2026-01-01T00:00:00Z' });
    collection.sellUnassigned('fund');
    while (collection.equipment.rodLevel < level) assert.ok(collection.purchaseUpgrade('rod', collection.equipment.rodLevel));
    const fishing = createFishing({ collection });
    fishing.prepare(origin, 0, visibility); fishing.aim(dx, dy);
    assert.equal(fishing.state.validCast, true);
    assert.equal(fishing.state.distance, dx === 0 && dy === 0 ? 8 : level === 1 ? 32 : 40);
    const target = { ...fishing.state.target };
    fishing.cast(); fishing.step(0.801);
    assert.equal(fishing.state.phase, PHASE.LURE);
    const actual = getLurePosition(fishing.state);
    assert.ok(Math.abs(actual.x - target.x) <= 1e-6);
    assert.ok(Math.abs(actual.z - target.z) <= 1e-6);
  }
});

test('drag mapping remains continuous and monotonic; resize refreshes the current gesture before release', () => {
  const { visibility, origin, setViewport } = view(1000, 700);
  const fishing = createFishing(); fishing.prepare(origin, 0, visibility);
  let previous = -Infinity;
  for (let dx = -180; dx <= 180; dx++) {
    fishing.aim(dx, 180);
    assert.ok(fishing.state.heading >= previous);
    if (previous !== -Infinity) assert.ok(fishing.state.heading - previous < 0.005);
    previous = fishing.state.heading;
  }
  const desktop = fishing.state.heading;
  setViewport({ width: 390, height: 844 }); fishing.refreshAim();
  assert.ok(fishing.state.heading < desktop / 2);
  const target = { ...fishing.state.target };
  fishing.cast(); fishing.step(0.801);
  assert.deepEqual(getLurePosition(fishing.state), target);
});

test('shore ray clipping is retained and unavailable visible water refuses to cast with a reason', () => {
  const { visibility, origin } = view(390, 844);
  const fishing = createFishing({ isWater: (x, z) => z >= origin.z - 6.13 || z < origin.z - 10 });
  fishing.setCastVisibility(visibility); fishing.prepare(origin, 0); fishing.aim(0, 180);
  assert.equal(fishing.state.distance, 6);
  assert.equal(fishing.state.validCast, true);
  fishing.cast(); fishing.step(0.801);
  assert.equal(fishing.state.phase, PHASE.LURE);
  assert.equal(getLurePosition(fishing.state).z, origin.z - 6);
  const blocked = createFishing();
  const obscured = createCastVisibility(view(390, 844).camera, () => ({ width: 390, height: 844,
    occlusions: [{ left: 0, right: 390, top: 0, bottom: 844 }] }));
  blocked.prepare(origin, 0, obscured); blocked.aim(180, 0);
  assert.equal(blocked.state.validCast, false);
  blocked.cast(); assert.equal(blocked.state.phase, PHASE.READY);
  assert.match(blocked.state.message, /画面内/);
});
