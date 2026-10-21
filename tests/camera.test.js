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
