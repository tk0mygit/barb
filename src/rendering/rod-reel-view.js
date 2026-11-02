import * as THREE from 'three';
import { createRodReelModel } from './rod-reel-model.js';

const TAKEBACK = THREE.MathUtils.degToRad(14);
const FORWARD = THREE.MathUtils.degToRad(-8);
const smooth = value => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };

// Angles are camera-relative pitch around +X, in radians. Phase time is the
// existing accepted game time, so a skipped render seeks directly to its pose.
export function sampleRodPitch(phase, time, entryPitch = 0) {
  if (phase === 'aim') return THREE.MathUtils.lerp(entryPitch, TAKEBACK, smooth(time / 0.18));
  if (phase === 'cast') {
    if (time < 0.12) return THREE.MathUtils.lerp(entryPitch, FORWARD, smooth(time / 0.12));
    return THREE.MathUtils.lerp(FORWARD, 0, smooth((time - 0.12) / 0.38));
  }
  if (phase === 'ready') return THREE.MathUtils.lerp(entryPitch, 0, smooth(time / 0.22));
  return 0;
}

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
  const pitchAxis = new THREE.Vector3(1, 0, 0), motion = new THREE.Quaternion();
  const grip = new THREE.Vector3(), rotatedGrip = new THREE.Vector3();
  let phase = null, revision = -1, phaseStart = 0, entryPitch = 0, lastElapsed = -Infinity;
  let disposed = false;
  function clearMotion() {
    phase = null; revision = -1; phaseStart = entryPitch = 0; lastElapsed = -Infinity;
  }
  return {
    group,
    update(active, state, elapsed) {
      if (disposed) return;
      group.visible = active && state.phase !== 'result' && state.phase !== 'failed';
      if (!group.visible) { clearMotion(); return; }
      if (elapsed < lastElapsed) clearMotion();
      const start = elapsed - state.time;
      if (phase !== state.phase || revision !== state.revision) {
        // Infer the transition boundary instead of using the last rendered
        // angle. A late first CAST frame therefore preserves a short AIM too.
        const sequential = phase !== null && state.revision === revision + 1;
        entryPitch = sequential ? sampleRodPitch(phase, Math.max(0, start - phaseStart), entryPitch) : 0;
        // A standalone initial CAST seek has no preceding AIM history. Its
        // deterministic seed is the held takeback, never an old cast's pose.
        if (state.phase === 'cast' && (!sequential || phase !== 'aim')) entryPitch = TAKEBACK;
        phase = state.phase; revision = state.revision; phaseStart = start;
      }
      lastElapsed = elapsed;
      const pitch = sampleRodPitch(phase, state.time, entryPitch);
      camera.updateWorldMatrix(true, false);
      const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / camera.zoom;
      // Preserve the existing neutral tip projection (58%, 57%). Animation
      // rotates the complete assembly without changing this neutral scale.
      tip.set(0.16 * halfHeight * camera.aspect, -0.14 * halfHeight, -1);
      const gripDepth = 0.45;
      butt.set(0.60 * halfHeight * camera.aspect * gripDepth, -0.8 * halfHeight * gripDepth, -gripDepth);
      direction.subVectors(tip, butt);
      const length = direction.length();
      pose.setFromUnitVectors(axis, direction.divideScalar(length));
      motion.setFromAxisAngle(pitchAxis, pitch);
      // The upper grip at model-local [0, .12, 0] stays fixed in camera space.
      // Rotate its offset back out of the root translation before following
      // the camera; every Mesh moves through this one rigid root transform.
      grip.copy(direction).multiplyScalar(length * 0.12);
      rotatedGrip.copy(grip).applyQuaternion(motion);
      group.position.copy(butt).add(grip).sub(rotatedGrip).applyMatrix4(camera.matrixWorld);
      camera.getWorldQuaternion(group.quaternion);
      group.quaternion.multiply(motion).multiply(pose);
      group.scale.set(halfHeight * 0.55, length, halfHeight * 0.55);
    },
    copyTipWorld(out) {
      if (disposed || !group.visible) return null;
      return group.localToWorld(out.fromArray(group.userData.tip));
    },
    // Lifecycle interruption can cancel AIM while active time is frozen. Clear
    // only its visual history so READY does not replay that return on resume.
    resetMotion: clearMotion,
    dispose() {
      if (disposed) return;
      disposed = true;
      group.visible = false;
      clearMotion();
      unsubscribe();
      group.removeFromParent();
      model.dispose();
    },
  };
}
