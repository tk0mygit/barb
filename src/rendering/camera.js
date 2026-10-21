import * as THREE from 'three';

export function createCameraRig(camera, boat) {
  const target = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const aim = new THREE.Vector3();
  let yaw = 0;
  let pitch = 0;
  let previousMode = boat.mode;
  camera.position.set(boat.x, 10, boat.z + 18);
  target.set(boat.x, 0.8, boat.z - 5);
  return {
    update(dt, input, locked = false, tracking = null) {
      if (locked && boat.mode === previousMode) {
        if (tracking) {
          aim.set(tracking.x, 0.2, tracking.z);
          target.lerp(aim, 1 - Math.exp(-dt * 4));
          camera.lookAt(target);
        }
        return;
      }
      if (boat.mode !== previousMode) { yaw = pitch = 0; previousMode = boat.mode; }
      if (boat.mode === 'fishing') {
        yaw += input.lookX;
        pitch = THREE.MathUtils.clamp(pitch - input.lookY, -0.7, 0.7);
        desired.set(boat.x + Math.sin(boat.heading) * 0.6, 2.15, boat.z - Math.cos(boat.heading) * 0.6);
        const heading = boat.heading + yaw;
        aim.set(desired.x + Math.sin(heading) * Math.cos(pitch) * 20, desired.y + Math.sin(pitch) * 20, desired.z - Math.cos(heading) * Math.cos(pitch) * 20);
      } else {
        desired.set(boat.x - Math.sin(boat.heading) * 18, 8.5, boat.z + Math.cos(boat.heading) * 18);
        aim.set(boat.x + Math.sin(boat.heading) * 18, 2.5, boat.z - Math.cos(boat.heading) * 18);
      }
      const smooth = 1 - Math.exp(-dt * 4);
      camera.position.lerp(desired, smooth);
      target.lerp(aim, smooth);
      camera.lookAt(target);
    },
  };
}
