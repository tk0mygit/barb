import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFishingView } from '../src/rendering/fishing.js';
import { createBoatModel } from '../src/rendering/boat-model.js';
import { createCastVisibility } from '../src/rendering/cast-visibility.js';
import { nearRingExpansion } from '../src/rendering/fishing-visuals.js';
import { FISHING_CONFIG } from '../src/game/fishing-config.js';
import { PHASE } from '../src/game/fishing.js';

function setup(distance = 8, heading = 0) {
  const scene = new THREE.Scene();
  const view = createFishingView(scene);
  const state = { phase: PHASE.CAST, origin: { x: 10, z: 20 }, heading, distance,
    target: { x: 10 + Math.sin(heading) * distance, z: 20 - Math.cos(heading) * distance },
    action: 0, time: 0, validCast: true };
  const fishing = { state, settings: FISHING_CONFIG };
  const group = scene.children[0];
  return { scene, view, state, fishing,
    ring: group.children.find(mesh => mesh.geometry.type === 'RingGeometry'),
    lure: group.children.find(mesh => mesh.geometry.type === 'SphereGeometry') };
}

function assertInFrame(mesh, camera, { width, height }) {
  const vertices = mesh.geometry.attributes.position;
  const point = new THREE.Vector3();
  for (let i = 0; i < vertices.count; i++) {
    point.fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrixWorld).project(camera);
    assert.ok(point.z > -1 && point.z < 1);
    const x = (1 + point.x) * width / 2, y = (1 - point.y) * height / 2;
    assert.ok(x >= 12 && x <= width - 12, `horizontal margin at ${x}`);
    assert.ok(y >= 12 && y <= height - 12, `vertical margin at ${y}`);
  }
}

test('CAST keeps the predicted water marker fixed and reaches the unchanged target on time', () => {
  const { view, ring, lure, fishing, state } = setup(8, 0.2);
  const original = structuredClone(state);
  for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.99, 1]) {
    state.time = t * FISHING_CONFIG.flightSeconds;
    view.update(fishing, true, 0);
    assert.equal(ring.position.x, original.target.x);
    assert.equal(ring.position.z, original.target.z);
    assert.deepEqual(state.target, original.target);
    assert.equal(state.distance, original.distance);
    assert.equal(state.heading, original.heading);
    if (t === 1) {
      assert.equal(lure.position.x, original.target.x);
      assert.equal(lure.position.z, original.target.z);
      assert.ok(Math.abs(lure.position.y) < 1e-12);
    }
  }
});

test('short flight arcs and their full sphere fit the prepared fixed view at every sample', () => {
  for (const viewport of [{ width: 1000, height: 700 }, { width: 390, height: 844 },
    { width: 844, height: 390 }, { width: 320, height: 568 }]) {
    for (const distance of [5.5, 8, 32, 40]) {
      const camera = new THREE.PerspectiveCamera(55, viewport.width / viewport.height, 0.1, 2400);
      camera.position.set(10, 2.15, 21.25);
      camera.lookAt(10, 2.15, 0);
      camera.updateMatrixWorld();
      const visibility = createCastVisibility(camera, () => viewport);
      const limits = visibility.constrain({ origin: { x: 10, z: 20 }, heading: 0,
        requestedDistance: distance, spread: FISHING_CONFIG.castSpread });
      assert.ok(limits.valid, `no center for ${viewport.width}x${viewport.height}, ${distance}m`);
      for (const heading of [limits.minAngle, 0, limits.maxAngle]) {
        const { scene, view, ring, lure, fishing, state } = setup(distance, heading);
        for (let i = 0; i <= 40; i++) {
          state.time = i / 40 * FISHING_CONFIG.flightSeconds;
          view.update(fishing, true, 0);
          scene.updateMatrixWorld();
          assertInFrame(lure, camera, viewport);
          assertInFrame(ring, camera, viewport);
        }
      }
    }
  }
});

test('near-water marker expansion is continuous and preserves the original pulses from 8m', () => {
  assert.equal(nearRingExpansion(4.5), 0);
  assert.equal(nearRingExpansion(6.25), 0.5);
  assert.equal(nearRingExpansion(8), 1);
  assert.equal(nearRingExpansion(40), 1);
  for (const distance of [4.5, 6.25, 8, 32, 40]) {
    const { view, ring, fishing, state } = setup(distance);
    const elapsed = Math.PI / 44; // maximum bite pulse
    state.phase = PHASE.BITE;
    view.update(fishing, true, elapsed);
    assert.ok(Math.abs(ring.scale.x - (1 + 0.9 * nearRingExpansion(distance))) < 1e-12);
    state.phase = PHASE.LURE; state.time = 0.79;
    view.update(fishing, true, elapsed);
    assert.ok(Math.abs(ring.scale.x - (1 + 1.58 * nearRingExpansion(distance))) < 1e-12);
  }
});

test('notice exclusion follows the visible flight and water markers before the next render', () => {
  const { view, fishing, state } = setup(8);
  const viewport = { width: 390, height: 844 };
  const camera = new THREE.PerspectiveCamera(55, viewport.width / viewport.height, 0.1, 2400);
  camera.position.set(state.origin.x, 2.15, state.origin.z + 1.25);
  camera.lookAt(state.origin.x, 2.15, state.origin.z - 20);
  state.phase = PHASE.READY; view.update(fishing, true, 0);
  assert.equal(view.getScreenBounds(camera, viewport), null);
  state.phase = PHASE.AIM; view.update(fishing, true, 0);
  const aim = view.getScreenBounds(camera, viewport);
  assert.ok(aim.top > viewport.height / 2);
  state.phase = PHASE.CAST; state.time = 0.4; view.update(fishing, true, 0);
  const flight = view.getScreenBounds(camera, viewport);
  assert.ok(flight.top < viewport.height / 2, 'exclusion includes the lure above the horizon');
  assert.ok(flight.bottom >= aim.bottom, 'exclusion also retains the water target');
  state.phase = PHASE.LURE; state.distance = 4.9; state.time = 1; view.update(fishing, true, 0);
  assert.ok(view.getScreenBounds(camera, viewport).bottom > aim.bottom, 'retrieval moves the exclusion with the lure');
});

test('world-position guides remain readable when the nearby boat obstructs their water point', () => {
  const boat = createBoatModel();
  boat.position.set(10, 0, 20); boat.updateMatrixWorld();
  const { view, ring, lure, fishing, state } = setup(4.5);
  state.phase = PHASE.BITE;
  view.update(fishing, true, 0);
  const eye = new THREE.Vector3(10, 2.15, 21.25);
  const ray = new THREE.Raycaster();
  for (const marker of [ring, lure]) {
    const direction = marker.position.clone().sub(eye);
    ray.set(eye, direction.clone().normalize()); ray.far = direction.length() - 1e-6;
    assert.ok(ray.intersectObject(boat, true).length > 0, 'fixture must reproduce real boat occlusion');
    assert.equal(marker.material.depthTest, false);
    assert.equal(marker.material.depthWrite, false);
    assert.equal(marker.material.transparent, marker === ring);
    assert.ok(marker.renderOrder > 0 && marker.renderOrder < 2, 'guide stays before the existing surface fog');
    assert.equal(marker.material.fog, true);
  }
  assert.equal(ring.position.x, state.target.x);
  assert.equal(ring.position.z, state.target.z);
  assert.equal(lure.position.x, state.target.x);
  assert.equal(lure.position.z, state.target.z);
});
