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

test('production HUD prepares before rendering but requires the caller to confirm a later opportunity', () => {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  try {
    globalThis.window = new EventTarget(); window.screen = { orientation: new EventTarget() };
    globalThis.document = { createElement: node };
    const s = operationSetup({ operation: 'tap' });
    const hud = createQteHUD({ fishing: s.f, delivery: s.delivery, provider: s.provider,
      canvas: node(), root: node(), manageGeometry: false, autoPresent: false });
    s.at(600); hud.update(1); s.at(610); hud.update(2);
    assert.equal(s.delivery.snapshot.active, null); assert.equal(s.delivery.snapshot.displayReady, false);
    assert.equal(hud.present(1), false); assert.equal(hud.present(3), true);
    assert.equal(s.delivery.snapshot.active, 610); assert.equal(s.delivery.snapshot.displayReady, true);
    assert.equal(s.f.state.fight.qte.successes, 0);
    hud.dispose();
  } finally {
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  }
});


function withHUDDOM(run) {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  try {
    globalThis.window = new EventTarget(); window.screen = { orientation: new EventTarget() };
    globalThis.document = { createElement: node };
    run();
  } finally {
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  }
}

test('descriptor selects one or two uniform SVG arrows in all four directions; tap and target keep their own cues', () => withHUDDOM(() => {
  for (const operation of ['flick', 'swipe', 'tap', 'target']) for (const direction of ['up', 'down', 'left', 'right']) {
    const s = operationSetup({ operation, direction });
    const hud = createQteHUD({ fishing: s.f, delivery: s.delivery, provider: s.provider, canvas: node(), root: node() });
    s.at(600); hud.update(1); s.at(610); hud.update(2);
    const panel = hud.element, arrow = panel.querySelector('.qte-arrow');
    assert.equal(panel.dataset.operation, operation);
    assert.equal(arrow.dataset.direction, direction);
    assert.equal(arrow.hidden, !['flick', 'swipe'].includes(operation));
    assert.equal(panel.querySelector('.qte-arrow-secondary').style.display, operation === 'swipe' ? '' : 'none');
    assert.equal(panel.querySelector('.qte-target').hidden, operation !== 'target');
    assert.equal(panel.querySelector('.qte-taps').hidden, operation !== 'tap');
    assert.equal((panel.innerHTML.match(/<svg /g) ?? []).length, 2);
    assert.equal((panel.innerHTML.match(/M12 36H53V18L86 50 53 82V64H12Z/g) ?? []).length, 2);
    assert.doesNotMatch(panel.innerHTML, /qte-endpoint|◎|[↑↓←→]/);
    assert.match(panel.innerHTML, /qte-gesture" aria-hidden="true"/);
    assert.doesNotMatch(panel.innerHTML, /qte-target"><span/);
    if (operation === 'target') assert.match(panel.querySelector('.qte-instruction').textContent, /半径 マウス32／タッチ40px/);
    if (operation === 'tap') assert.equal(panel.querySelector('.qte-taps').textContent, '0/3 ○○○');
    hud.dispose();
  }
}));

test('HUD movement cannot consume the half-second window; only effective canvas/safe/visual viewport coordinates revise geometry', () => withHUDDOM(() => {
  const s = operationSetup({ operation: 'flick' });
  const root = node();
  let obstacleReads = 0;
  root.querySelectorAll = () => { obstacleReads++; return [node()]; };
  let canvasBounds = { left: 0, top: 0, right: 1000, bottom: 700 };
  let safeBounds = { ...canvasBounds };
  const canvas = node(), safeProbe = node();
  canvas.getBoundingClientRect = () => canvasBounds;
  safeProbe.getBoundingClientRect = () => safeBounds;
  globalThis.document.createElement = tag => tag === 'div' ? safeProbe : node();
  window.visualViewport = { offsetLeft: 0, offsetTop: 0, width: 1000, height: 700 };
  const hud = createQteHUD({ fishing: s.f, delivery: s.delivery, provider: s.provider, canvas, root, manageGeometry: false });
  s.at(600); hud.update(1); s.at(610); hud.update(2);
  const initial = s.delivery.snapshot;
  assert.equal(initial.deadline - initial.active, 500);
  s.at(620); hud.update(3);
  assert.equal(obstacleReads, 0);
  assert.equal(s.delivery.snapshot.geometryRevision, initial.geometryRevision);
  assert.equal(s.delivery.snapshot.deadline, initial.deadline);
  assert.equal(s.delivery.snapshot.remainingMs, initial.remainingMs - 10);
  // Even a viewport measurement change has no effect when it does not change
  // the safe intersection actually used for placement.
  window.visualViewport.width = 1100;
  s.at(630); hud.update(4);
  assert.equal(s.delivery.snapshot.geometryRevision, initial.geometryRevision);
  let frame = 4, raw = 630;
  for (const change of [
    () => { canvasBounds = { ...canvasBounds, right: 999.875 }; },
    () => { safeBounds = { ...safeBounds, left: 24.125 }; },
    () => { window.visualViewport.height = 650.375; },
  ]) {
    const before = s.delivery.snapshot.geometryRevision;
    change(); s.at(raw += 10); hud.update(++frame);
    assert.equal(s.delivery.snapshot.geometryRevision, before + 1);
    assert.equal(s.delivery.snapshot.deadline, initial.deadline);
    s.at(raw += 10); hud.update(++frame);
    assert.equal(s.delivery.snapshot.displayReady, true);
    assert.equal(s.delivery.snapshot.deadline, initial.deadline);
  }
  hud.dispose();
}));

test('thin timer keeps remaining fraction/seconds and marks urgency without altering the deadline', () => withHUDDOM(() => {
  const s = operationSetup({ operation: 'flick' });
  const hud = createQteHUD({ fishing: s.f, delivery: s.delivery, provider: s.provider, canvas: node(), root: node() });
  s.at(600); hud.update(1); s.at(610); hud.update(2);
  const deadline = s.delivery.snapshot.deadline;
  assert.equal(hud.element.dataset.urgent, 'false');
  s.at(1010); hud.update(3);
  assert.equal(s.delivery.snapshot.deadline, deadline);
  assert.equal(hud.element.dataset.urgent, 'true');
  assert.equal(hud.element.querySelector('progress').value, .2);
  assert.equal(hud.element.querySelector('.qte-timer span').textContent, '0.1秒');
  hud.dispose();
}));
