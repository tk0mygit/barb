import test from 'node:test';
import assert from 'node:assert/strict';
import { createQteHUD } from '../src/ui/qte-hud.js';
import { operationSetup } from './helpers/qte-operations.js';

function node() {
  const children = new Map();
  return { hidden: false, style: {}, dataset: {}, classList: { add() {}, remove() {} },
    setAttribute() {}, append() {}, remove() { this.removed = true; },
    querySelector(selector) { if (!children.has(selector)) children.set(selector, node()); return children.get(selector); },
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
