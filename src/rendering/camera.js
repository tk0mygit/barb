import * as THREE from 'three';

export const READY_PITCH_LIMIT = THREE.MathUtils.degToRad(12);
export const CAST_CAMERA_BACKOFF = 1.25;

export function createCameraRig(camera, boat) {
  const target = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const direction = new THREE.Vector3();
  let yaw = 0;
  let pitch = 0;
  let previousMode = boat.mode;
  camera.position.set(boat.x - Math.sin(boat.heading) * 18, 8.5, boat.z + Math.cos(boat.heading) * 18);
  target.set(boat.x + Math.sin(boat.heading) * 18, 2.5, boat.z - Math.cos(boat.heading) * 18);
  camera.lookAt(target);
  function syncMode() {
    if (boat.mode !== previousMode) { yaw = pitch = 0; previousMode = boat.mode; }
  }
  function fishingPosition() {
    desired.set(boat.x + Math.sin(boat.heading) * 0.6, 2.15, boat.z - Math.cos(boat.heading) * 0.6);
  }
  function look(heading, elevation) {
    target.set(camera.position.x + Math.sin(heading) * Math.cos(elevation) * 20,
      camera.position.y + Math.sin(elevation) * 20,
      camera.position.z - Math.cos(heading) * Math.cos(elevation) * 20);
    camera.lookAt(target);
  }
  return {
    prepareCast() {
      if (boat.mode !== 'fishing') return null;
      syncMode();
      // Commit the intended READY yaw, never a direction from the middle of
      // the sailing/READY interpolation. AIM starts with this exact pose.
      pitch = 0;
      const heading = boat.heading + yaw;
      // A small fixed step back keeps the near-water lure and bite ring visible
      // through retrieval as well as at the initial landing point.
      camera.position.set(boat.x - Math.sin(heading) * CAST_CAMERA_BACKOFF, 2.15,
        boat.z + Math.cos(heading) * CAST_CAMERA_BACKOFF);
      look(heading, 0);
      camera.updateMatrixWorld();
      return heading;
    },
    update(dt, input, locked = false, tracking = null) {
      if (locked && boat.mode === previousMode) {
        if (tracking) {
          aim.set(tracking.x, 0.2, tracking.z);
          target.lerp(aim, 1 - Math.exp(-dt * 4));
          camera.lookAt(target);
        }
        return;
      }
      syncMode();
      const smooth = 1 - Math.exp(-dt * 4);
      if (boat.mode === 'fishing') {
        yaw += input.lookX;
        pitch = THREE.MathUtils.clamp(pitch - input.lookY, -READY_PITCH_LIMIT, READY_PITCH_LIMIT);
        fishingPosition();
        const heading = boat.heading + yaw;
        camera.getWorldDirection(direction);
        const currentHeading = Math.atan2(direction.x, -direction.z);
        const turn = Math.atan2(Math.sin(heading - currentHeading), Math.cos(heading - currentHeading));
        const elevation = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1)) * (1 - smooth) + pitch * smooth,
          -READY_PITCH_LIMIT, READY_PITCH_LIMIT);
        camera.position.lerp(desired, smooth);
        // Interpolate angles: opposing target vectors can collapse through the
        // eye and briefly point steeply up/down during a large horizontal turn.
        look(currentHeading + turn * smooth, elevation);
        return;
      } else {
        desired.set(boat.x - Math.sin(boat.heading) * 18, 8.5, boat.z + Math.cos(boat.heading) * 18);
        aim.set(boat.x + Math.sin(boat.heading) * 18, 2.5, boat.z - Math.cos(boat.heading) * 18);
      }
      camera.position.lerp(desired, smooth);
      target.lerp(aim, smooth);
      camera.lookAt(target);
    },
  };
}
