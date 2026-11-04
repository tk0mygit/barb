import test from 'node:test';
import assert from 'node:assert/strict';
import { createFishing, PHASE } from '../src/game/fishing.js';
import { createFishingHUD } from '../src/ui/fishing-hud.js';
import { createHUD } from '../src/ui/hud.js';

function installDOM() {
  const elements = new Map();
  function element() {
    return { hidden: false, textContent: '', dataset: {}, style: {}, open: false,
      classList: { toggle() {} }, addEventListener() {}, setAttribute() {}, removeAttribute() {}, append() {}, after() {}, focus() {},
      showModal() { this.open = true; }, close() { this.open = false; },
      replaceWith(next) { elements.set('#catch-image', next); } };
  }
  const querySelector = selector => {
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
  };
  globalThis.document = { querySelector, createElement: element, createElementNS: element, body: element() };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  globalThis.Image = class { constructor() { return { ...element(), decode: () => Promise.resolve() }; } };
  Object.assign(querySelector('#line-tension'), { low: .18, high: .78 });
  return querySelector;
}

test('real fishing phases keep exact state text, hide empty hints in either HUD update order and retain tension values', async () => {
  const globals = Object.fromEntries(['document', 'MutationObserver', 'Image'].map(key => [key, globalThis[key]]));
  try {
    const $ = installDOM(), boat = { mode: 'sailing', speed: 0, heading: 0 };
    const fishing = createFishing({ random: () => 0 });
    const base = createHUD({ onFish() {}, onReturn() {} });
    const hud = createFishingHUD({ onPrepare() {}, onCancel() {}, onSelectLure() {},
      onClose: () => fishing.closeResult(), onSell: () => fishing.sellResult() });
    const render = () => {
      base.update(boat); hud.update(fishing, boat.mode === 'fishing', { timeOfDay: 'day', cycleProgress: 0 });
    };
    const check = (phase, label, hint = '') => {
      assert.equal(fishing.state.phase, phase); render();
      for (let order = 0; order < 2; order++) {
        assert.equal($('#fishing-state').textContent, label);
        assert.equal($('#hint').textContent, hint); assert.equal($('#hint').hidden, !hint);
        base.update(boat); // A later generic HUD update cannot restore an instruction or erase a notice.
      }
    };
    render(); assert.equal($('#hint').hidden, true); assert.equal($('#hint').textContent, '');
    boat.mode = 'fishing'; check(PHASE.READY, 'キャスト前');
    fishing.prepare({ x: 0, z: 30 }, 0); check(PHASE.AIM, 'キャスト準備');
    fishing.cast(); check(PHASE.CAST, 'キャスト中', '着水待ち...');
    fishing.step(.801); check(PHASE.LURE, '静寂を聴く');
    fishing.step(3.01); check(PHASE.BITE, 'シグナルを検知した');
    assert.equal(fishing.hook(), true); check(PHASE.FIGHT, '抵抗を検知');
    assert.equal($('#tension-warning').textContent, '張力が安定している');
    fishing.reel(true);
    for (let i = 0; fishing.state.tension <= .78 && i < 1000; i++) fishing.step(1 / 60);
    check(PHASE.FIGHT, '抵抗を検知'); assert.equal($('#tension-warning').textContent, '離して緩める！');
    assert.equal($('#line-tension').dataset.level, 'high');
    fishing.reel(false);
    for (let i = 0; fishing.state.tension >= .18 && i < 1000; i++) fishing.step(1 / 60);
    check(PHASE.FIGHT, '抵抗を検知'); assert.equal($('#tension-warning').textContent, '長押しで巻く！');
    assert.equal($('#line-tension').dataset.level, 'low');
    assert.equal($('#tension-value').textContent, `${Math.round(fishing.state.tension * 100)}%`);
    assert.equal($('#line-tension').value, fishing.state.tension);
    let held = false;
    for (let i = 0; fishing.state.phase === PHASE.FIGHT && i < 2000; i++) {
      if (fishing.state.tension < .4) held = true;
      if (fishing.state.tension > .78) held = false;
      fishing.reel(held); fishing.step(1 / 60);
    }
    check(PHASE.LANDING, '回収中...', '回収まで、あとわずか');
    fishing.step(2); check(PHASE.RESULT, '個体を回収した');
    await Promise.resolve(); assert.equal($('#catch-dialog').open, true);
    fishing.closeResult(); check(PHASE.READY, 'キャスト前');
    fishing.prepare({ x: 0, z: 30 }, 0); fishing.cast(); fishing.step(.801); fishing.step(3.01); fishing.step(1.01);
    check(PHASE.FAILED, '個体を見失った', '再試行を待機');
    assert.equal($('#fishing-note').textContent, '応答が遅れ、個体を見失った。');
    boat.mode = 'sailing'; render(); base.update(boat);
    assert.equal($('#hint').hidden, true); assert.equal($('#hint').textContent, '');
  } finally {
    for (const [key, value] of Object.entries(globals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
