import { PHASE } from '../game/fishing.js';
import { GESTURES } from '../game/fishing-config.js';

// Replaceable gesture mapping shared by mouse and touch. A gesture belongs to
// one revision: an old hold or release can never hook a newly biting fish.
export function createFishingInput(fishing, mapping = GESTURES, { qteDelivery = null } = {}) {
  let gesture = null, pending = [], origin = null, clockRevision = null, previousFrameEnd = null, identity = 0;
  const received = new WeakMap();
  const route = ingress => ingress?.event && qteDelivery && (received.get(ingress.event) ?? qteDelivery.ingest(ingress.event, ingress.receipt));
  const current = () => gesture && gesture.revision === fishing.state.revision
    && (fishing.state.phase === PHASE.FIGHT || gesture.inputRevision === fishing.state.inputRevision);
  function contact(type, timestamp, revision = fishing.state.revision, inputRevision = fishing.state.inputRevision) {
    pending.push({ type, timestamp, at: fishing.state.fight.renderSeconds, revision, inputRevision,
      lifecycleRevision: fishing.state.fight.lifecycleRevision, identity: gesture?.identity, normalAt: gesture?.normalAt });
  }
  return {
    receivePointer(event, receipt) {
      if (!qteDelivery || received.has(event)) return;
      // Controls already stamped the first receipt, before capture/focus. A
      // technical restart uses this same entrance, never an earlier canvas
      // listener that could do work before the official receipt. This down
      // belongs to the suspended epoch and cannot score before re-display.
      if (event.type === 'pointerdown' && qteDelivery.interrupted && event.isPrimary
        && (event.pointerType === 'touch' || event.pointerType === 'mouse' && event.button === 0)
        && !qteDelivery.clock.reasons.some(reason => !['technical', 'display', 'orientation'].includes(reason))) {
        qteDelivery.resumeTechnical(receipt);
      }
      received.set(event, qteDelivery.ingest(event, receipt));
    },
    down(x, y, timestamp, ingress) {
      const routed = route(ingress);
      if (routed?.handled) return routed.accepted;
      if (fishing.state.inputOwner === 'suspended') return false;
      gesture = { x, y, timestamp, dx: 0, dy: 0, age: 0, revision: fishing.state.revision, inputRevision: fishing.state.inputRevision, identity: ++identity, normalAt: routed?.normalAt };
      if (fishing.state.phase === PHASE.FIGHT) contact('down', timestamp);
      return true;
    },
    move(x, y, ingress) {
      if (route(ingress)?.handled) return;
      if (!current()) return;
      gesture.dx = x - gesture.x; gesture.dy = y - gesture.y;
      fishing.aim(gesture.dx, gesture.dy);
    },
    step(dt, frameEndTimestamp) {
      qteDelivery?.poll(frameEndTimestamp);
      if (fishing.state.phase === PHASE.FIGHT) {
        const progress = fishing.state.fight;
        if (progress.paused) { gesture = null; pending = []; origin = null; previousFrameEnd = null; return; }
        if (clockRevision !== fishing.state.revision) { origin = null; previousFrameEnd = null; clockRevision = fishing.state.revision; }
        if (Number.isFinite(frameEndTimestamp)) {
          // Rebase after an inactive gap or the existing main-loop dt cap;
          // hidden/unfocused wall time must not become held game time.
          if (origin === null || previousFrameEnd !== null && Math.abs((frameEndTimestamp - previousFrameEnd) / 1000 - dt) > 1e-6) {
            origin = frameEndTimestamp - (progress.renderSeconds + dt) * 1000;
          }
          previousFrameEnd = frameEndTimestamp;
        } else if (origin === null) {
          const first = pending.find(e => Number.isFinite(e.timestamp));
          if (first) origin = first.timestamp - first.at * 1000;
        }
        for (const event of pending) if (event.revision === fishing.state.revision && event.lifecycleRevision === progress.lifecycleRevision) {
          const at = event.normalAt ?? (Number.isFinite(event.timestamp) && origin !== null ? (event.timestamp - origin) / 1000 : event.at);
          fishing.queueFightContact(event.type, at, event.identity);
        }
        pending = []; return;
      }
      pending = []; origin = null; previousFrameEnd = null; clockRevision = null;
      if (!current()) { fishing.reel(false); return; }
      gesture.age += dt;
      fishing.reel(gesture.age >= mapping.holdSeconds);
    },
    up(timestamp, ingress) {
      const routed = route(ingress);
      if (routed?.handled) return routed.accepted;
      if (gesture && Number.isFinite(timestamp) && timestamp < gesture.timestamp) return false;
      if (fishing.state.phase === PHASE.FIGHT) {
        if (gesture) gesture.normalAt = routed?.normalAt;
        if (current()) contact('up', timestamp, gesture.revision, gesture.inputRevision);
        gesture = null; return;
      }
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
    cancel(timestamp, ingress) {
      if (ingress?.event && !['pointercancel', 'lostpointercapture'].includes(ingress.event.type) && qteDelivery && fishing.state.inputOwner === 'qte') {
        qteDelivery.cancelContact(); return;
      }
      if (route(ingress)?.handled) return;
      if (!qteDelivery && ['pointercancel', 'lostpointercapture'].includes(ingress?.event?.type)) timestamp = undefined;
      if (fishing.state.phase === PHASE.FIGHT && fishing.state.inputOwner === 'normal' && Number.isFinite(timestamp)) {
        // An unidentified old cancel cannot be attached to the latest gesture
        // merely because it was delivered after that gesture's down.
        if (!gesture || timestamp < gesture.timestamp) return;
        contact('cancel', timestamp); gesture = null; return;
      }
      gesture = null; pending = []; origin = null; previousFrameEnd = null; fishing.cancelInput();
    },
    setSuspended(reason, active, receipt) {
      if (!qteDelivery) return;
      qteDelivery.setSuspended(reason, active, receipt);
      if (active) { gesture = null; pending = []; origin = null; previousFrameEnd = null; }
    },
    geometryChanged(orientation, receipt) { qteDelivery?.invalidateGeometry(orientation, receipt); },
  };
}
