import * as THREE from 'three';
import { createRodReelModel } from './rod-reel-model.js';

// Scene-owned view equipment. The camera is intentionally not reparented:
// update follows the ordinary rig/preparation update, including synchronous
// resize renders. This pose does not participate in casting or line physics.
export function createRodReelView(scene, camera, collection) {
  const model = createRodReelModel();
  const { group } = model;
  group.visible = false;
  model.setLevels(collection.equipment);
  const unsubscribe = collection.subscribe(() => model.setLevels(collection.equipment));
  scene.add(group);
  const butt = new THREE.Vector3(), tip = new THREE.Vector3(), direction = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 1, 0), pose = new THREE.Quaternion();
  let disposed = false;
  return {
    group,
    update(active, phase) {
      if (disposed) return;
      group.visible = active && phase !== 'result' && phase !== 'failed';
      if (!group.visible) return;
      camera.updateMatrixWorld();
      const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / camera.zoom;
      // Match the existing virtual line origin's projection (58%, 57%). The
      // line continues to use its own unchanged formula until Phase 5D-2.
      tip.set(0.16 * halfHeight * camera.aspect, -0.14 * halfHeight, -1);
      const gripDepth = 0.45;
      butt.set(0.60 * halfHeight * camera.aspect * gripDepth, -0.8 * halfHeight * gripDepth, -gripDepth);
      direction.subVectors(tip, butt);
      const length = direction.length();
      pose.setFromUnitVectors(axis, direction.divideScalar(length));
      group.position.copy(butt).applyMatrix4(camera.matrixWorld);
      camera.getWorldQuaternion(group.quaternion);
      group.quaternion.multiply(pose);
      group.scale.set(halfHeight * 0.55, length, halfHeight * 0.55);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      group.removeFromParent();
      model.dispose();
    },
  };
}
