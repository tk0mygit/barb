import { PerspectiveCamera, Vector3 } from 'three';
import { createMeteor, meteorRoll } from '../../src/world/meteor.js';
import { getNightFogProfile } from '../../src/world/night-fog.js';
import { createGameClock } from '../../src/game/game-clock.js';
import { sampleDayNight } from '../../src/world/day-night.js';

// Search ordinary winners; never change the probability or product camera.
// Selection only chooses a valid saved clock for actual-render observations.
export function findMeteorEvent({ moon = false } = {}) {
  const meteor = createMeteor(), camera = new PerspectiveCamera(55, 1000 / 700, .1, 2400);
  camera.position.set(10, 8.5, 38); camera.lookAt(10, 2.5, 2); camera.updateMatrixWorld();
  const point = new Vector3(), x = new Vector3(), y = new Vector3(), radial = new Vector3();
  try {
    for (let night = 0; night < 100000; night++) for (let slot = 0; slot < 18; slot++) {
      if (meteorRoll(night, slot) >= .005 || getNightFogProfile(night).fogType !== 'CLEAR') continue;
      const start = night * 360 + 180 + slot * 10 + 5;
      const clock = createGameClock(undefined, { elapsedSeconds: start + .55 }).state;
      meteor.update(clock, { x: 10, z: 20 }, 'CLEAR'); meteor.mesh.updateMatrixWorld();
      const uniforms = meteor.mesh.material.uniforms, tail = uniforms.meteorTail.value, head = tail + (1 - tail) * .5;
      if (!moon) {
        point.set(head - .5, 0, 0).applyMatrix4(meteor.mesh.matrixWorld).project(camera);
        if (Math.abs(point.x) < .45 && point.y > .75 && point.y < .95) return { night, slot, start };
      } else {
        point.fromArray(sampleDayNight(clock).moonDirection);
        x.set(1, 0, 0).applyQuaternion(meteor.mesh.quaternion); y.set(0, 1, 0).applyQuaternion(meteor.mesh.quaternion);
        radial.set(0, 0, 1).applyQuaternion(meteor.mesh.quaternion);
        const z = point.dot(radial), along = point.dot(x) / z * 1200 / meteor.mesh.scale.x + .5;
        if (z > .9 && along > head - tail + .05 && along < head - .01 && Math.abs(point.dot(y) / z * 1200) < 2)
          return { night, slot, start, direction: point.toArray() };
      }
    }
    throw new Error('No ordinary visible CLEAR winner found');
  } finally { meteor.dispose(); }
}
