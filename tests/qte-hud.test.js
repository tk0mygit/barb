import test from 'node:test';
import assert from 'node:assert/strict';
import { createQteHUD } from '../src/ui/qte-hud.js';
import { operationSetup } from './helpers/qte-operations.js';

function node(rectangles = {}) {
  const children = new Map();
  return { hidden: false, style: {}, dataset: {}, classList: { add() {}, remove() {} },
    setAttribute() {}, append() {}, remove() { this.removed = true; },
    querySelector(selector) {
      if (!children.has(selector)) {
        const child = node(rectangles);
        if (rectangles[selector]) child.getBoundingClientRect = () => rectangles[selector];
        children.set(selector, child);
      }
      return children.get(selector);
    },
    querySelectorAll: () => [], getBoundingClientRect: () => ({ left: 0, top: 0, right: 1000, bottom: 700 }) };
}

test('HUD stamps display calls after snapshot/layout work; menu resume retains progress without backdating a real moving clock', () => {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  try {
    globalThis.window = new EventTarget(); window.screen = { orientation: new EventTarget() };
    globalThis.document = { createElement: node };
    const s = operationSetup({ operation: 'tap', sampleStepMs: .2 }); s.activate();
    s.send('pointerdown', 610); s.send('pointerup', 620);
    s.at(700); const deadline = s.delivery.snapshot.deadline;
    s.delivery.setSuspended('menu', true);
    const hud = createQteHUD({ fishing: s.f, delivery: s.delivery, provider: s.provider, canvas: node(), root: node() });
    hud.update(1, 700);
    assert.equal(hud.element.dataset.state, 'suspended');
    s.at(3000); s.delivery.setSuspended('menu', false);
    // snapshot reads advance the sampling clock by .2ms. The render anchor is
    // intentionally older than those reads, as it is in a real browser frame.
    hud.update(2, 3000); hud.update(3, 3000);
    assert.equal(s.f.state.fight.paused, false);
    assert.equal(hud.element.dataset.state, 'active');
    assert.equal(s.delivery.snapshot.deadline, deadline);
    assert.equal(s.delivery.preview().completedOperations, 1);
    assert.equal(s.f.state.fight.qte.successes, 0);
    hud.dispose(); assert.equal(hud.element.removed, true);
  } finally {
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  }
});

test('prepared target uses actual fractional CSS circle/region bounds, and accepts its mouse circumference', () => {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  try {
    globalThis.window = new EventTarget(); window.screen = { orientation: new EventTarget() };
    const rectangles = { '.qte-target': { left: 100.125, right: 180.125, top: 200.375, bottom: 280.375 },
      '.qte-gesture': { left: 50.125, right: 250.125, top: 150.375, bottom: 350.375 } };
    globalThis.document = { createElement: () => node(rectangles) };
    const s = operationSetup({ operation: 'target' });
    const hud = createQteHUD({ fishing: s.f, delivery: s.delivery, provider: s.provider, canvas: node(), root: node() });
    s.at(600); hud.update(1); s.at(610); hud.update(2);
    assert.equal(hud.element.dataset.state, 'active');
    assert.deepEqual(hud.geometry.target, { x: 140.125, y: 240.375 });
    s.send('pointerdown', 620, { clientX: 172.125, clientY: 240.375 });
    s.send('pointerup', 630, { clientX: 172.125, clientY: 240.375 });
    assert.equal(s.delivery.preview().success, true);
    assert.equal(s.f.state.fight.qte.successes, 0);
    assert.equal(s.seal(), true); assert.equal(s.f.state.fight.qte.successes, 1);
    hud.dispose();
  } finally {
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  }
});
