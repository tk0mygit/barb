import assert from 'node:assert/strict';
import { hookedFight } from './fight-replay.js';
import { createQteClock } from '../../src/input/qte-clock.js';
import { createQteDelivery } from '../../src/input/qte-delivery.js';
import { createQteEvaluator } from '../../src/game/qte-operations.js';

export const displayGeometry = Object.freeze({ region: Object.freeze({ left: -200, top: -200, right: 200, bottom: 200 }),
  target: Object.freeze({ x: 0, y: 0 }) });
export function operationSetup({ operation = 'flick', direction = 'right', capacity, condition = {} } = {}) {
  let raw = 0;
  const provider = { getDescriptor: index => Object.freeze({ fightId: 1, index, operation, direction }), selectOperation: () => operation };
  const { f, calls } = hookedFight({ speciesId: 'alligator-gar', size: 'max', rod: 10, reel: 10, startDistance: 4.51, ...condition },
    { qte: { enabled: true, delivery: 'finite', selectOperation: provider.selectOperation } });
  f.reel(true); while (f.state.fight.mode === 'normal') f.step(1 / 60);
  const clock = createQteClock({ now: () => raw });
  const delivery = createQteDelivery({ fishing: f, clock, capacity, evaluate: createQteEvaluator(provider) });
  assert.ok(delivery.open(0));
  let frame = 0;
  return { f, calls, delivery, provider, clock,
    at(value) { raw = value; },
    display(geometry = displayGeometry) { const prep = delivery.prepareDisplay(++frame, raw, geometry); assert.ok(prep);
      assert.equal(delivery.presentDisplay(prep, ++frame, raw), true); return prep; },
    activate() { raw = 600; this.display(); },
    send(type, source, extra = {}, receipt = source) {
      raw = receipt; return delivery.ingest({ type, timeStamp: source, clientX: 0, clientY: 0,
        pointerId: 1, pointerType: 'mouse', button: 0, isPrimary: true, ...extra }, receipt);
    },
    seal() { raw = delivery.snapshot.cut; return delivery.poll(); },
  };
}
