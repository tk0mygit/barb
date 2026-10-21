import { PHASE } from '../game/fishing.js';
import { GESTURES } from '../game/fishing-config.js';

// Replaceable gesture mapping shared by mouse and touch. A gesture belongs to
// one revision: an old hold or release can never hook a newly biting fish.
export function createFishingInput(fishing, mapping = GESTURES) {
  let gesture = null;
  const current = () => gesture && gesture.revision === fishing.state.revision;
  return {
    down(x, y, timestamp) { gesture = { x, y, timestamp, dx: 0, dy: 0, age: 0, revision: fishing.state.revision }; },
    move(x, y) {
      if (!current()) return;
      gesture.dx = x - gesture.x; gesture.dy = y - gesture.y;
      fishing.aim(gesture.dx, gesture.dy);
    },
    step(dt) {
      if (!current()) { fishing.reel(false); return; }
      gesture.age += dt;
      fishing.reel(gesture.age >= mapping.holdSeconds);
    },
    up(timestamp) {
      fishing.reel(false);
      if (current()) {
        const distance = Math.hypot(gesture.dx, gesture.dy);
        const age = timestamp === undefined || gesture.timestamp === undefined ? gesture.age : Math.max(0, timestamp - gesture.timestamp) / 1000;
        if (fishing.state.phase === PHASE.AIM) fishing.cast();
        else if (fishing.state.phase === PHASE.BITE && age <= mapping.flickSeconds && distance <= mapping.tapPixels) fishing.hook();
        else if (fishing.state.phase === PHASE.LURE && age < mapping.flickSeconds && distance >= mapping.flickPixels) fishing.flick();
      }
      gesture = null;
    },
    cancel() { gesture = null; fishing.cancelInput(); },
  };
}
