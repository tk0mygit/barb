import test from 'node:test';
import assert from 'node:assert/strict';
import { createSalesHUD } from '../src/ui/sales-hud.js';
import { BUYER_LINES } from '../src/game/buyer-lines.js';
import { createCatchCollection } from '../src/game/catch-collection.js';

function installDOM(t) {
  const oldDocument = globalThis.document, oldWindow = globalThis.window;
  const elements = new Map(['#wallet-balance', '#collection-wallet', '#sale-notice', '#collection-sale-notice']
    .map(id => [id, { textContent: '', hidden: true }]));
  globalThis.document = new EventTarget();
  document.querySelector = selector => elements.get(selector);
  globalThis.window = new EventTarget();
  t.after(() => {
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
  });
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  return selector => elements.get(selector);
}

test('successful receipts draw once; failed and duplicate notifications leave the message and deadline intact', t => {
  const $ = installDOM(t), collection = createCatchCollection();
  let calls = 0;
  const hud = createSalesHUD(collection, { random: () => { calls++; return 0; } });
  assert.equal(calls, 0); hud.notify(null); assert.equal(calls, 0);
  collection.register({ schemaVersion: 1, id: 'one', speciesId: 'black-bass', weightKg: 3,
    lengthCm: 50, caughtAt: '2026-01-01T00:00:00Z' });
  const receipt = collection.sellUnassigned('one'), before = collection.snapshot;
  hud.notify(receipt); assert.equal(calls, 2);
  const message = `1匹を売却 · +300 Value\n買取人「${BUYER_LINES[0]}」`;
  for (const id of ['#sale-notice', '#collection-sale-notice']) {
    assert.equal($(id).textContent, message); assert.equal($(id).hidden, false);
  }
  t.mock.timers.tick(4000);
  hud.notify(receipt); hud.notify(collection.sellUnassigned('one')); hud.update();
  assert.equal(calls, 2); assert.equal($('#sale-notice').textContent, message);
  assert.deepEqual(collection.snapshot, before);
  t.mock.timers.tick(999); assert.equal($('#sale-notice').hidden, false);
  t.mock.timers.tick(1);
  for (const id of ['#sale-notice', '#collection-sale-notice']) {
    assert.equal($(id).hidden, true); assert.equal($(id).textContent, '');
  }
  assert.equal($('#wallet-balance').textContent, '300 Value');
});

test('consecutive receipts avoid repeats across hiding and expiry; a recreated HUD starts independently', t => {
  const $ = installDOM(t), collection = createCatchCollection();
  let calls = 0;
  const random = () => { calls++; return 0; };
  const first = createSalesHUD(collection, { random });
  const receipt = () => ({ count: 1, total: 100 });
  first.notify(receipt()); assert.ok($('#sale-notice').textContent.endsWith(`買取人「${BUYER_LINES[0]}」`));
  first.hideNotice(); first.notify(receipt());
  assert.ok($('#sale-notice').textContent.endsWith(`買取人「${BUYER_LINES[1]}」`));
  t.mock.timers.tick(5000); assert.equal($('#sale-notice').hidden, true);
  first.notify(receipt()); assert.ok($('#sale-notice').textContent.endsWith(`買取人「${BUYER_LINES[0]}」`));
  first.hideNotice();
  const second = createSalesHUD(collection, { random });
  second.notify(receipt()); assert.ok($('#sale-notice').textContent.endsWith(`買取人「${BUYER_LINES[0]}」`));
  assert.equal(calls, 8); second.hideNotice();
});
