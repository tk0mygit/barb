import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCameraRig, READY_PITCH_LIMIT, CAST_CAMERA_BACKOFF } from '../src/rendering/camera.js';
import { createBoatState, enterFishing } from '../src/game/boat.js';

test('camera starts at the saved position and heading before the first update', () => {
  const boat = createBoatState({ x: 42, z: -12, heading: Math.PI / 2 });
  const camera = new THREE.PerspectiveCamera();
  createCameraRig(camera, boat);
  assert.ok(Math.abs(camera.position.x - 24) < 1e-10);
  assert.ok(Math.abs(camera.position.z + 12) < 1e-10);
  const direction = camera.getWorldDirection(new THREE.Vector3());
  assert.ok(direction.x > 0.9);
  assert.ok(Math.abs(direction.z) < 1e-10);
});

test('camera trails the boat and converges smoothly to eye level', () => {
  const boat = createBoatState();
  const camera = new THREE.PerspectiveCamera();
  const rig = createCameraRig(camera, boat);
  const input = { lookX: 0, lookY: 0 };
  rig.update(1, input);
  assert.ok(camera.position.z > boat.z && camera.position.y > 8);
  enterFishing(boat);
  const previousHeight = camera.position.y;
  rig.update(1 / 60, input);
  assert.ok(camera.position.y < previousHeight && camera.position.y > 2.15);
  for (let i = 0; i < 180; i++) rig.update(1 / 60, input);
  assert.ok(Math.abs(camera.position.y - 2.15) < 0.001);
});
test('dragging right in FPS turns right; pitch remains bounded', () => {
  const boat = createBoatState();
  enterFishing(boat);
  const camera = new THREE.PerspectiveCamera();
  const rig = createCameraRig(camera, boat);
  rig.update(5, { lookX: 0.5, lookY: 0 });
  const direction = camera.getWorldDirection(new THREE.Vector3());
  assert.ok(direction.x > 0 && direction.z < 0);
  rig.update(5, { lookX: 0, lookY: 100 });
  assert.ok(camera.getWorldDirection(direction).y > -0.7);
});
test('cast preparation freezes position and orientation, then look resumes', () => {
  const boat = createBoatState(); enterFishing(boat);
  const camera = new THREE.PerspectiveCamera();
  const rig = createCameraRig(camera, boat);
  rig.update(1, { lookX: 0.2, lookY: 0.1 });
  const position = camera.position.clone(), quaternion = camera.quaternion.clone();
  rig.update(1, { lookX: 10, lookY: 10 }, true);
  assert.ok(camera.position.equals(position)); assert.ok(camera.quaternion.equals(quaternion));
  rig.update(1, { lookX: 0.3, lookY: 0 }, false);
  assert.ok(!camera.quaternion.equals(quaternion));
});
test('fight camera follows the near-water landing point without moving the boat viewpoint', () => {
  const boat = createBoatState(); enterFishing(boat);
  const camera = new THREE.PerspectiveCamera();
  const rig = createCameraRig(camera, boat);
  rig.update(4, { lookX: 0, lookY: 0 });
  const position = camera.position.clone();
  rig.update(2, { lookX: 0, lookY: 0 }, true, { x: boat.x, z: boat.z - 4.5 });
  assert.ok(camera.position.equals(position));
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).y < -0.4);
});

const angleError = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

test('READY limits both pitch extremes to 12 degrees, including an opposing yaw turn', () => {
  const boat = createBoatState(); enterFishing(boat);
  const camera = new THREE.PerspectiveCamera();
  const rig = createCameraRig(camera, boat);
  for (const lookY of [-100, 100]) {
    rig.update(5, { lookX: 0, lookY });
    const direction = camera.getWorldDirection(new THREE.Vector3());
    assert.ok(Math.abs(Math.asin(direction.y) + Math.sign(lookY) * READY_PITCH_LIMIT) < 1e-8);
    rig.update(0.17, { lookX: Math.PI, lookY: 0 });
    for (let i = 0; i < 60; i++) {
      rig.update(1 / 60, { lookX: 0, lookY: 0 });
      assert.ok(Math.abs(Math.asin(camera.getWorldDirection(direction).y)) <= READY_PITCH_LIMIT + 1e-10);
    }
  }
});

test('READY yaw supports a full turn and follows the short path across the angle boundary', () => {
  const boat = createBoatState(); enterFishing(boat);
  const camera = new THREE.PerspectiveCamera();
  const rig = createCameraRig(camera, boat);
  for (let i = 0; i < 120; i++) rig.update(1 / 30, { lookX: Math.PI * 2 / 120, lookY: 0 });
  rig.update(5, { lookX: 0, lookY: 0 });
  let direction = camera.getWorldDirection(new THREE.Vector3());
  assert.ok(angleError(Math.atan2(direction.x, -direction.z), boat.heading) < 1e-8);
  rig.update(5, { lookX: Math.PI - 0.02, lookY: 0 });
  direction = camera.getWorldDirection(direction);
  const before = Math.atan2(direction.x, -direction.z);
  rig.update(0.01, { lookX: 0.04, lookY: 0 });
  direction = camera.getWorldDirection(direction);
  const after = Math.atan2(direction.x, -direction.z);
  const delta = Math.atan2(Math.sin(after - before), Math.cos(after - before));
  assert.ok(delta > 0 && delta < 0.04);
});

for (const heading of [-Math.PI - 0.01, Math.PI + 0.01, 2 * Math.PI, -2 * Math.PI]) {
  for (const lookY of [-100, 100]) {
    test(`prepare commits logical yaw ${heading} and levels pitch from ${lookY}`, () => {
      const boat = createBoatState({ x: 42, z: -12, heading });
      const camera = new THREE.PerspectiveCamera();
      const rig = createCameraRig(camera, boat);
      enterFishing(boat);
      // READY entry and look are deliberately still interpolating.
      rig.update(1 / 60, { lookX: 0.47, lookY });
      const returnedHeading = rig.prepareCast();
      const direction = camera.getWorldDirection(new THREE.Vector3());
      assert.equal(returnedHeading, heading + 0.47);
      assert.ok(Math.abs(Math.asin(direction.y)) < 1e-12);
      assert.ok(angleError(Math.atan2(direction.x, -direction.z), returnedHeading) < 1e-12);
      assert.ok(Math.abs(camera.position.x - boat.x + Math.sin(returnedHeading) * CAST_CAMERA_BACKOFF) < 1e-12);
      assert.ok(Math.abs(camera.position.z - boat.z - Math.cos(returnedHeading) * CAST_CAMERA_BACKOFF) < 1e-12);
      assert.equal(camera.position.y, 2.15);
      const position = camera.position.clone(), quaternion = camera.quaternion.clone();
      rig.update(0.2, { lookX: 2, lookY: 2 }, true);
      assert.ok(camera.position.equals(position));
      assert.ok(camera.quaternion.equals(quaternion));
      // The renderer has not run: projection must already use the committed pose.
      const projected = new THREE.Vector3(boat.x + Math.sin(returnedHeading) * 32, 0.12,
        boat.z - Math.cos(returnedHeading) * 32).project(camera);
      assert.ok(Number.isFinite(projected.x) && Number.isFinite(projected.y));
      assert.ok(projected.z > -1 && projected.z < 1);
    });
  }
}

test('prepare immediately after entering fishing ignores the sailing camera direction', () => {
  const boat = createBoatState({ x: 42, z: -12, heading: 1.4 });
  const camera = new THREE.PerspectiveCamera();
  const rig = createCameraRig(camera, boat);
  assert.equal(rig.prepareCast(), null);
  enterFishing(boat);
  assert.equal(rig.prepareCast(), boat.heading);
  const direction = camera.getWorldDirection(new THREE.Vector3());
  assert.ok(Math.abs(direction.y) < 1e-12);
  assert.ok(angleError(Math.atan2(direction.x, -direction.z), boat.heading) < 1e-12);
});

for (const [width, height] of [[1000, 700], [390, 844], [844, 390], [320, 568]]) {
  test(`the fixed prepared viewpoint keeps the near-water ring in frame at ${width}x${height}`, () => {
    const boat = createBoatState(); enterFishing(boat);
    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 2400);
    const rig = createCameraRig(camera, boat);
    for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI / 2]) {
      rig.update(5, { lookX: yaw, lookY: 0 });
      const heading = rig.prepareCast();
      // At retrieval's 4.5m limit, the visual pulse contracts to the base ring.
      for (let i = 0; i < 40; i++) {
        const angle = i * Math.PI * 2 / 40;
        const point = new THREE.Vector3(boat.x + Math.sin(heading) * 4.5 + Math.cos(angle) * 0.7, 0.12,
          boat.z - Math.cos(heading) * 4.5 + Math.sin(angle) * 0.7).project(camera);
        const screenX = (1 + point.x) * width / 2;
        const screenY = (1 - point.y) * height / 2;
        assert.ok(screenX >= 12 && screenX <= width - 12);
        assert.ok(screenY >= 12 && screenY <= height - 12);
      }
    }
  });
}
