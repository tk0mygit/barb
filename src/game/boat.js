import { LAKE, shoreRadius } from '../world/config.js';

export const STOP_SPEED = 0.12;
export function isNavigableBoatPosition(position) {
  if (!Number.isFinite(position?.x) || !Number.isFinite(position?.z)) return false;
  const limit = shoreRadius(Math.atan2(position.z, position.x)) - LAKE.boatMargin;
  // stepBoat's radial projection can round a few ulps beyond its own limit.
  return Math.hypot(position.x, position.z) <= limit + 16 * Number.EPSILON * limit;
}
export function createBoatState(position = { x: 0, z: 30, heading: 0 }) {
  if (!isNavigableBoatPosition(position) || !Number.isFinite(position.heading)) throw new RangeError('Invalid boat position or heading');
  return { x: position.x, z: position.z, heading: position.heading, speed: 0, mode: 'sailing' };
}
export function isStopped(boat) { return Math.abs(boat.speed) < STOP_SPEED; }
export function enterFishing(boat) {
  if (boat.mode !== 'sailing' || !isStopped(boat)) return false;
  boat.speed = 0;
  boat.mode = 'fishing';
  return true;
}
export function leaveFishing(boat) { boat.mode = 'sailing'; }
export function stepBoat(boat, input, dt) {
  if (boat.mode !== 'sailing') return;
  dt = Math.max(0, Math.min(dt, 0.05));
  const throttle = Math.max(0, Math.min(1, input.throttle));
  const targetSpeed = throttle * 9;
  boat.speed += (targetSpeed - boat.speed) * (1 - Math.exp(-dt * (throttle ? 1.5 : 3.4)));
  if (!throttle && isStopped(boat)) boat.speed = 0;
  boat.heading += Math.max(-1, Math.min(1, input.steer)) * dt * 1.1 * Math.min(1, boat.speed / 2);
  const x = boat.x + Math.sin(boat.heading) * boat.speed * dt;
  const z = boat.z - Math.cos(boat.heading) * boat.speed * dt;
  const limit = shoreRadius(Math.atan2(z, x)) - LAKE.boatMargin;
  const distance = Math.hypot(x, z);
  if (distance > limit) {
    boat.x = x / distance * limit;
    boat.z = z / distance * limit;
    boat.speed *= Math.exp(-dt * 8);
  } else { boat.x = x; boat.z = z; }
}
