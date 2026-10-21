import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCameraRig } from '../src/rendering/camera.js';
import { createBoatState, enterFishing } from '../src/game/boat.js';

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
  rig.update(2, { lookX: 0, lookY: 0 }, true, { x: boat.x, z: boat.z - 1.8 });
  assert.ok(camera.position.equals(position));
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).y < -0.5);
});
