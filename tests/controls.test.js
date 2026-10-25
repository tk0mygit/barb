import test from 'node:test';
import assert from 'node:assert/strict';
import { createControls } from '../src/input/controls.js';
import { createFishingInput } from '../src/input/fishing.js';
import { createFishing, PHASE } from '../src/game/fishing.js';

function setup() {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const window = globalThis.window = new EventTarget();
  const document = globalThis.document = new EventTarget();
  const canvas = new EventTarget(), captures = new Set();
  canvas.hasPointerCapture = id => captures.has(id);
  canvas.setPointerCapture = id => captures.add(id);
  canvas.releasePointerCapture = id => captures.delete(id);
  canvas.focus = () => {};
  const fishing = createFishing();
  let cancelledPreparations = 0;
  const controls = createControls(canvas, {}, { style: {} }, {
    input: createFishingInput(fishing),
    canLook: () => fishing.state.phase === PHASE.READY,
    onPreparationCancel: () => cancelledPreparations++,
  });
  controls.setMode('fishing');
  const pointer = (type, { x = 100, y = 100, time = 1000, pointerType = 'mouse' } = {}) => {
    const event = new Event(type);
    Object.defineProperties(event, {
      pointerId: { value: 1 }, button: { value: 0 }, pointerType: { value: pointerType },
      clientX: { value: x }, clientY: { value: y }, timeStamp: { value: time },
    });
    canvas.dispatchEvent(event);
  };
  return { canvas, window, document, fishing, controls, captures, pointer,
    cancellations: () => cancelledPreparations,
    finish() { fishing.prepare({ x: 0, z: 30 }, 0); controls.finishPreparation(); },
    dispose() {
      if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
      if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    },
  };
}

for (const pointerType of ['mouse', 'touch']) {
  test(`${pointerType}: a drag held through camera preparation transfers its origin and latest aim`, () => {
    const s = setup();
    try {
      s.controls.beginPreparation();
      s.pointer('pointerdown', { pointerType });
      s.pointer('pointermove', { x: 160, y: 0, pointerType });
      assert.deepEqual(s.controls.read(0.05), { steer: 0, throttle: 0, lookX: 0, lookY: 0 });
      assert.equal(s.fishing.state.phase, PHASE.READY);
      assert.equal(s.captures.has(1), true);
      s.finish();
      assert.equal(s.fishing.state.phase, PHASE.AIM);
      assert.ok(Math.abs(s.fishing.state.heading - 0.7 / 3) < 1e-12);
      assert.ok(s.fishing.state.distance > 8);
      const target = { ...s.fishing.state.target };
      s.pointer('pointerup', { x: 160, y: 0, time: 1500, pointerType });
      assert.equal(s.fishing.state.phase, PHASE.CAST);
      assert.deepEqual(s.fishing.state.target, target);
      assert.equal(s.captures.size, 0);
    } finally { s.dispose(); }
  });

  test(`${pointerType}: releasing before camera preparation finishes never queues a cast`, () => {
    const s = setup();
    try {
      s.controls.beginPreparation();
      s.pointer('pointerdown', { pointerType });
      s.pointer('pointermove', { x: 200, y: 0, pointerType });
      s.pointer('pointerup', { time: 1040, pointerType });
      s.finish();
      s.controls.read(1);
      assert.equal(s.fishing.state.phase, PHASE.AIM);
      assert.equal(s.fishing.state.distance, 8);
      assert.equal(s.captures.size, 0);
      s.pointer('pointerdown', { pointerType }); s.pointer('pointerup', { time: 1600, pointerType });
      assert.equal(s.fishing.state.phase, PHASE.CAST);
    } finally { s.dispose(); }
  });
}

test('a READY look gesture is discarded before preparation and cannot become a cast', () => {
  const s = setup();
  try {
    s.pointer('pointerdown'); s.pointer('pointermove', { x: 200 });
    s.controls.beginPreparation(); s.finish();
    s.pointer('pointerup');
    assert.equal(s.fishing.state.phase, PHASE.AIM);
    assert.deepEqual(s.controls.read(0.05), { steer: 0, throttle: 0, lookX: 0, lookY: 0 });
    assert.equal(s.captures.size, 0);
  } finally { s.dispose(); }
});

for (const reason of ['pointercancel', 'lostpointercapture', 'window-blur', 'canvas-blur', 'visibilitychange', 'reset', 'disabled', 'cancel']) {
  test(`${reason} discards the captured preparation contact and notifies cancellation once`, () => {
    const s = setup();
    try {
      s.controls.beginPreparation(); s.pointer('pointerdown'); s.pointer('pointermove', { x: 200 });
      if (reason === 'window-blur') s.window.dispatchEvent(new Event('blur'));
      else if (reason === 'canvas-blur') s.canvas.dispatchEvent(new Event('blur'));
      else if (reason === 'visibilitychange') s.document.dispatchEvent(new Event('visibilitychange'));
      else if (reason === 'reset') s.controls.reset();
      else if (reason === 'disabled') s.controls.setEnabled(false);
      else if (reason === 'cancel') s.controls.cancelPreparation();
      else s.pointer(reason);
      assert.equal(s.captures.size, 0);
      assert.equal(s.cancellations(), 1);
      // Even an erroneously late completion callback must not replay the old contact.
      s.finish(); s.pointer('pointerup');
      assert.equal(s.fishing.state.phase, PHASE.AIM);
      assert.equal(s.fishing.state.distance, 8);
      assert.equal(s.fishing.state.reeling, false);
      s.controls.reset(); assert.equal(s.cancellations(), 1);
    } finally { s.dispose(); }
  });
}
