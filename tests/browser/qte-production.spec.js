import { test, expect } from './diagnostics-fixture.js';
import { createGameplay } from '../../src/game/gameplay.js';
import { createSaveData } from '../../src/game/save-data.js';
import { calculateSalePrice } from '../../src/game/fish-sales.js';
import { auditProductionQte } from '../helpers/qte-production-audit.js';
import { openQteProduction, productInput, productSnapshot, castAndHookProduct, advanceToWarning,
  performProductOperation, landProduct, saveKeys } from './qte-production-fixture.js';

function historicalSave(version) {
  const game = createGameplay({ now: () => 1000 });
  game.collection.register({ schemaVersion: 1, id: 'historical', speciesId: 'black-bass', lengthCm: 40,
    weightKg: 10, caughtAt: '2026-10-30T00:00:00Z', qteSuccessCount: 0 });
  game.collection.sellUnassigned('historical');
  const data = structuredClone(createSaveData(game, { savedAt: '2026-10-31T00:00:00.000Z' }));
  data.collection.catches[0].salePrice = 777;
  data.collection.catches[0].soldAt = '1970-01-01T00:00:01Z';
  data.collection.wallet = { balance: 777, lifetimeSales: 777 };
  if (version === 1) { data.saveVersion = 1; for (const record of data.collection.catches) delete record.qteSuccessCount; }
  return data;
}
const latest = page => page.evaluate(keys => keys.map(key => localStorage.getItem(key)).filter(Boolean)
  .map(JSON.parse).sort((a, b) => b.generation - a.generation)[0], saveKeys);
const money = value => `${value.toLocaleString('ja-JP')} 通貨`;

// Every operation uses trusted canvas events and the entire real main loop.
// The paused Playwright clock controls time; it does not inject game state or
// scoring evidence. Chromium touch / SwiftShader remain separate from devices.
for (const touch of [false, true]) for (const operation of ['flick', 'swipe', 'tap', 'target']) {
  test(`production ${touch ? 'touch' : 'mouse'} ${operation}: new/restore → native QTE → landing/sale → V2 → shipped OFF`, async ({ createContext }) => {
    const context = await createContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1000, height: 700 },
      hasTouch: touch, isMobile: touch, deviceScaleFactor: .5 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const save = operation === 'flick' ? historicalSave(1) : operation === 'swipe' ? historicalSave(2) : null;
    await openQteProduction(page, { save });
    const initial = await latest(page);
    if (save) {
      expect(initial.generation).toBe(7); expect(initial.data).toEqual(save);
      expect(await page.evaluate(key => localStorage.getItem(key), saveKeys[1])).toBeNull();
    } else expect(initial).toBeUndefined();
    const input = await productInput(page, touch), p = await castAndHookProduct(page, input, { operation });
    const successes = operation === 'flick' ? 1 : operation === 'swipe' ? 2 : 3;
    for (let index = 0; index < 3; index++) {
      const warning = await advanceToWarning(page, input, p, index);
      expect(warning.fight.qte.token.index).toBe(index);
      if (index === 0) expect(warning.descriptor.operation).toBe(operation);
      const evidence = await performProductOperation(page, input, { success: index < successes });
      const ingress = await page.evaluate(() => window.e2eDiagnostics.events.filter(e => e.target === 'scene'));
      await test.info().attach(`production-qte-${index}`, { body: JSON.stringify({ ...evidence, ingress }), contentType: 'application/json' });
      expect(evidence.pending.snapshot.highWater).toBeLessThanOrEqual(128);
      expect(evidence.after.snapshot.counts['semantic-overflow'] ?? 0).toBe(0);
      if (index < successes) expect(ingress.some(e => e.type === 'pointerdown' && e.trusted
        && e.pointerType === (touch ? 'touch' : 'mouse'))).toBe(true);
      const native = await page.evaluate(() => window.productNativeEvidence);
      const audit = await auditProductionQte({ ...evidence, native });
      await test.info().attach(`production-qte-${index}-source-replay`, { body: JSON.stringify(audit), contentType: 'application/json' });
    }
    const record = await landProduct(page, input, p);
    expect(record.qteSuccessCount).toBe(successes);
    const price = calculateSalePrice(record), base = calculateSalePrice({ ...record, qteSuccessCount: 0 });
    await expect(page.locator('#catch-sale-price')).toHaveText(`売却価格 ${money(price)}`);
    await expect(page.locator('#catch-qte-bonus')).toHaveText(`QTE成功${successes}回／ボーナス+${money(price - base)}`);
    const result = await productSnapshot(page);
    expect(result.events.filter(e => e.type === 'qte-resolved')).toHaveLength(3);
    expect(result.snapshot.status).toBe('idle');
    await expect(page.locator('.qte-hud')).toBeHidden();
    if (touch) await input.click(page.locator('#sell-catch'));
    else {
      await input.click(page.locator('#close-catch'));
      await page.clock.fastForward(32);
      await input.click(page.locator('#menu-button'));
      await input.click(page.locator('[data-view="storage"]'));
      await expect(page.locator('.stored-price')).toHaveText(`売却価格 ${money(price)}`);
      if (operation === 'tap' || operation === 'target') {
        await input.click(page.locator('#sell-all')); await input.click(page.locator('#confirm-sale'));
      } else await input.click(page.locator('.sell-stored'));
      await input.click(page.locator('#collection-close'));
    }
    await page.clock.fastForward(1250);
    const sold = (await latest(page)).data;
    expect(sold.saveVersion).toBe(2);
    expect(sold.collection.catches.at(-1)).toMatchObject({ qteSuccessCount: successes, salePrice: price, disposition: 'sold' });
    expect(sold.collection.wallet).toEqual({ balance: (save ? 777 : 0) + price, lifetimeSales: (save ? 777 : 0) + price });
    if (save) {
      expect(sold.collection.catches[0]).toEqual({ ...save.collection.catches[0], qteSuccessCount: 0 });
      for (const award of save.achievements.unlocked) expect(sold.achievements.unlocked).toContainEqual(award);
    }
    await test.info().attach('production-sale-save', { body: JSON.stringify({ source: result.source, record, price, sold }), contentType: 'application/json' });
    // Normal built entry in a fresh document: no test initializer or ON policy.
    await page.goto('./'); await page.clock.fastForward(32);
    await expect(page.locator('#status')).toBeHidden();
    await expect(page.locator('#wallet-balance')).toHaveText(money(sold.collection.wallet.balance));
    expect(await page.evaluate(() => typeof window.qteProduct)).toBe('undefined');
    await expect(page.locator('.qte-hud,.qte-safe-probe')).toHaveCount(0);
    const restored = (await latest(page)).data;
    expect(restored.collection).toEqual(sold.collection); expect(restored.achievements).toEqual(sold.achievements);
    expect(errors).toEqual([]);
  });
}

for (const touch of [false, true]) for (const variant of ['new', 'v1', 'v2']) test(`production default OFF ${touch ? 'touch' : 'mouse'} ${variant}: native fight → zero bonus → save/restore`, async ({ createContext }) => {
  const context = await createContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1000, height: 700 },
    hasTouch: touch, isMobile: touch, deviceScaleFactor: .5 });
  const page = await context.newPage();
  await openQteProduction(page, { enabled: false, save: variant === 'new' ? null : historicalSave(variant === 'v1' ? 1 : 2) });
  await expect(page.locator('.qte-hud,.qte-safe-probe')).toHaveCount(0);
  const input = await productInput(page, touch), p = await castAndHookProduct(page, input);
  const before = await productSnapshot(page);
  expect(before.fight.qte.enabled).toBe(false); expect(before.snapshot).toBeUndefined();
  const record = await landProduct(page, input, p);
  expect(record.qteSuccessCount).toBe(0);
  const price = calculateSalePrice(record);
  await expect(page.locator('#catch-qte-bonus')).toHaveText('QTE成功0回／ボーナス+0 通貨');
  await input.click(page.locator('#sell-catch')); await page.clock.fastForward(1250);
  const saved = (await latest(page)).data;
  expect(saved.saveVersion).toBe(2); expect(saved.collection.catches.at(-1).salePrice).toBe(price);
  expect(saved.collection.catches.at(-1).qteSuccessCount).toBe(0);
  await page.goto('./'); await page.clock.fastForward(32);
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('.qte-hud,.qte-safe-probe')).toHaveCount(0);
  expect((await latest(page)).data.collection).toEqual(saved.collection);
});

test('production touch lifecycle: completed tap, reason union, native cancel, rotation, defeat and recast', async ({ createContext }) => {
  const context = await createContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: .5 });
  const page = await context.newPage(); await openQteProduction(page);
  const input = await productInput(page, true), p = await castAndHookProduct(page, input);
  await advanceToWarning(page, input, p, 0);
  // Warning-time input must not become a held scoring contact.
  await input.down(p); await input.up();
  expect((await productSnapshot(page)).preview.completedOperations).toBe(0);
  for (let n = 0; n < 12 && !(await productSnapshot(page)).snapshot.displayReady; n++) await page.clock.fastForward(100);
  const first = await productSnapshot(page), target = first.geometry.target;
  // A secondary finger inside the scoring area cannot become a second owner.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [
    { id: 1, x: first.geometry.region.left - 8, y: target.y }, { id: 2, ...target },
  ] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect((await productSnapshot(page)).preview.completedOperations).toBe(0);
  await page.clock.fastForward(10); await input.down(target); await page.clock.fastForward(20); await input.up();
  expect((await productSnapshot(page)).preview.completedOperations).toBe(1);
  await page.setViewportSize({ width: 391, height: 844 });
  expect((await productSnapshot(page)).snapshot.deadline).toBe(first.snapshot.deadline);
  for (let n = 0; n < 5 && !(await productSnapshot(page)).snapshot.displayReady; n++) await page.clock.fastForward(16);
  await input.click(page.locator('#menu-button'));
  const paused = await productSnapshot(page), deadline = paused.snapshot.deadline, remaining = paused.snapshot.remainingMs;
  // Synthetic lifecycle notifications are explicitly separate from native
  // pointer proof. They exercise the real main handlers and reason union.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('pagehide'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(1000);
  let state = await productSnapshot(page);
  expect(state.snapshot.reasons).toEqual(expect.arrayContaining(['menu', 'blur', 'hidden', 'page']));
  expect(state.snapshot.remainingMs).toBe(remaining); expect(state.fight.paused).toBe(true);
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow')); });
  expect((await productSnapshot(page)).fight.paused).toBe(true);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await input.click(page.locator('#collection-close'));
  for (let n = 0; n < 5 && !(await productSnapshot(page)).snapshot.displayReady; n++) await page.clock.fastForward(16);
  state = await productSnapshot(page);
  expect(state.snapshot.deadline).toBe(deadline); expect(state.preview.completedOperations).toBe(1);
  expect(state.fight.paused).toBe(false);
  await input.down(state.geometry.target); await input.cancel();
  expect((await productSnapshot(page)).preview.completedOperations).toBe(1);
  await input.down(state.geometry.target);
  await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
  expect((await productSnapshot(page)).fight.paused).toBe(true);
  await input.up(); await page.setViewportSize({ width: 844, height: 390 });
  for (let n = 0; n < 5 && !(await productSnapshot(page)).snapshot.displayReady; n++) await page.clock.fastForward(16);
  state = await productSnapshot(page);
  expect(state.snapshot.deadline).toBe(deadline); expect(state.preview.completedOperations).toBe(1);
  expect(state.snapshot.geometryRevision).toBeGreaterThan(first.snapshot.geometryRevision);
  for (let n = 0; n < 2; n++) {
    await page.clock.fastForward(10); await input.down(state.geometry.target); await page.clock.fastForward(20); await input.up();
  }
  state = await productSnapshot(page); expect(state.preview.success).toBe(true); expect(state.fight.qte.successes).toBe(0);
  const left = await page.evaluate(() => { const d = window.qteProduct.qteDelivery; return d.snapshot.cut - d.clock.read().active; });
  await page.clock.fastForward(left + 32);
  state = await productSnapshot(page); expect(state.fight.qte.successes).toBe(1);
  await test.info().attach('lifecycle-proof', { body: JSON.stringify(state), contentType: 'application/json' });
  await page.evaluate(() => { window.retiredQteHandle = window.qteProduct.qteDelivery.snapshot.handle; window.productDrawQueue = [0]; });
  // A genuine domain loss: leave tension slack, and fix the next escape RNG
  // draw. No phase, distance, success or result state is assigned by the test.
  for (let n = 0; n < 30 && (await productSnapshot(page)).phase === 'fight'; n++) await page.clock.fastForward(250);
  expect((await productSnapshot(page)).phase).toBe('failed');
  expect((await productSnapshot(page)).snapshot.status).toBe('idle');
  for (let n = 0; n < 8 && (await productSnapshot(page)).phase !== 'ready'; n++) await page.clock.fastForward(250);
  expect(await page.evaluate(() => window.qteProduct.state.collection.catches.length)).toBe(0);
  const next = await castAndHookProduct(page, input, { operation: 'target', fightId: 2 });
  await advanceToWarning(page, input, next, 0);
  state = await productSnapshot(page);
  expect(state.descriptor.fightId).toBe(2); expect(state.fight.qte.successes).toBe(0);
  expect(await page.evaluate(() => window.qteProduct.qteDelivery.poll(performance.now(), window.retiredQteHandle))).toBe(false);
  expect((await productSnapshot(page)).fight.qte.successes).toBe(0);
});

test('production semantic128 interruption: native invalid taps, explicit canvas recovery, same remaining budget', async ({ createContext }) => {
  const context = await createContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: .5 });
  const page = await context.newPage(); await openQteProduction(page);
  const input = await productInput(page, false), p = await castAndHookProduct(page, input);
  await advanceToWarning(page, input, p, 0);
  for (let n = 0; n < 12 && !(await productSnapshot(page)).snapshot.displayReady; n++) await page.clock.fastForward(100);
  const target = (await productSnapshot(page)).geometry.target;
  await page.mouse.move(target.x, target.y);
  await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
  expect((await productSnapshot(page)).preview.completedOperations).toBe(0);
  // Explicit synthetic negative: the coalesced excursion returns to its start
  // but must still invalidate this tap. The surrounding down/up are native.
  await input.down(target); await page.clock.fastForward(10);
  await page.evaluate(target => {
    const pointerId = window.e2eDiagnostics.events.findLast(e => e.type === 'pointerdown' && e.target === 'scene').pointerId;
    const event = new PointerEvent('pointermove', { bubbles: true, pointerId, pointerType: 'mouse',
      isPrimary: true, buttons: 1, clientX: target.x, clientY: target.y });
    Object.defineProperty(event, 'getCoalescedEvents', { value: () => [
      { timeStamp: event.timeStamp, clientX: target.x + 20, clientY: target.y },
      { timeStamp: event.timeStamp, clientX: target.x, clientY: target.y },
    ] });
    document.querySelector('#scene').dispatchEvent(event);
  }, target);
  await page.clock.fastForward(20); await input.up();
  let negative = await productSnapshot(page);
  expect(negative.preview.completedOperations).toBe(0); expect(negative.snapshot.edges).toBe(2);
  expect(negative.snapshot.counts['ambiguous-move'] ?? 0).toBe(0);
  await page.clock.fastForward(10); await input.down(target); await page.clock.fastForward(20); await input.up();
  for (let n = 0; n < 62; n++) { await input.down(target); await input.move({ x: target.x + 20, y: target.y }); await input.up(); }
  const full = await productSnapshot(page); expect(full.snapshot.edges).toBe(128); expect(full.preview.completedOperations).toBe(1);
  await input.down(target); await input.up();
  await page.clock.fastForward(16);
  const interrupted = await productSnapshot(page);
  expect(interrupted.snapshot.interrupted).toBe(true); expect(interrupted.snapshot.completedOperations).toBe(1);
  expect(interrupted.snapshot.highWater).toBe(128); expect(interrupted.snapshot.counts['semantic-overflow']).toBe(1);
  expect(interrupted.fight.qte.successes).toBe(0);
  await expect(page.locator('.qte-instruction')).toHaveText('画面をタップして残り時間から再開');
  const remaining = interrupted.snapshot.remainingMs, deadline = interrupted.snapshot.deadline;
  await page.clock.fastForward(1000); expect((await productSnapshot(page)).snapshot.remainingMs).toBe(remaining);
  await input.down(target); await input.up();
  for (let n = 0; n < 5 && !(await productSnapshot(page)).snapshot.displayReady; n++) await page.clock.fastForward(16);
  const resumed = await productSnapshot(page);
  expect(resumed.snapshot.interrupted).toBe(false); expect(resumed.snapshot.deadline).toBe(deadline);
  expect(resumed.preview.completedOperations).toBe(1); expect(resumed.fight.paused).toBe(false);
  for (let n = 0; n < 2; n++) {
    await page.clock.fastForward(10); await input.down(resumed.geometry.target); await page.clock.fastForward(20); await input.up();
  }
  const pending = await productSnapshot(page); expect(pending.preview.success).toBe(true); expect(pending.fight.qte.successes).toBe(0);
  const left = await page.evaluate(() => { const d = window.qteProduct.qteDelivery; return d.snapshot.cut - d.clock.read().active; });
  await page.clock.fastForward(left + 32);
  const after = await productSnapshot(page); expect(after.fight.qte.successes).toBe(1);
  expect(after.events.filter(e => e.type === 'qte-resolved')).toHaveLength(1);
  await test.info().attach('semantic128-proof', { body: JSON.stringify({ full, interrupted, resumed, pending, after }), contentType: 'application/json' });
});

test('production restored ON all failures: three penalties, one catch with count0, preserved V2 history', async ({ createContext }) => {
  const context = await createContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: .5 });
  const page = await context.newPage(); await openQteProduction(page, { save: historicalSave(2) });
  const input = await productInput(page, false), p = await castAndHookProduct(page, input);
  const evidence = [];
  for (let index = 0; index < 3; index++) {
    await advanceToWarning(page, input, p, index);
    const e = await performProductOperation(page, input, { success: false }); evidence.push(e);
    const native = await page.evaluate(() => window.productNativeEvidence);
    const audit = await auditProductionQte({ ...e, native });
    await test.info().attach(`all-failure-${index}-source-replay`, { body: JSON.stringify(audit), contentType: 'application/json' });
    expect(e.pending.fight.penaltyMeters).toBe(e.before.fight.penaltyMeters);
    expect(e.after.fight.penaltyMeters).toBeGreaterThan(e.before.fight.penaltyMeters);
    expect(e.after.fight.qte.failures).toBe(index + 1); expect(e.after.fight.qte.successes).toBe(0);
  }
  const record = await landProduct(page, input, p); expect(record.qteSuccessCount).toBe(0);
  await input.click(page.locator('#close-catch')); await page.clock.fastForward(1250);
  const saved = (await latest(page)).data;
  expect(saved.collection.catches.at(-1)).toMatchObject({ id: record.id, qteSuccessCount: 0, disposition: 'stored' });
  expect(saved.collection.wallet).toEqual({ balance: 777, lifetimeSales: 777 });
  await test.info().attach('all-failure-proof', { body: JSON.stringify({ evidence, saved }), contentType: 'application/json' });
  await page.goto('./'); await page.clock.fastForward(32);
  await expect(page.locator('#status')).toBeHidden(); await expect(page.locator('.qte-hud')).toHaveCount(0);
  expect((await latest(page)).data.collection).toEqual(saved.collection);
});

test('production real-clock rAF: native three-tap evidence waits for the fixed cut before one effect', async ({ createContext }) => {
  const context = await createContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: .5 });
  const page = await context.newPage(); await openQteProduction(page);
  const input = await productInput(page, false), p = await castAndHookProduct(page, input);
  await advanceToWarning(page, input, p, 0);
  // Prepare the pointer and large observation while warning time is paused.
  // Native contact starts after A; no protocol/serialization setup is charged
  // against the human gesture, and the real 2s deadline remains unchanged.
  const before = await productSnapshot(page), target = before.geometry.target;
  await page.mouse.move(target.x, target.y);
  const cdp = await context.newCDPSession(page);
  const rendersBefore = await page.evaluate(() => window.qteProduct.renderer.info.render.frame);
  await page.clock.resume();
  await page.waitForFunction(() => window.qteProduct.qteDelivery.snapshot.displayReady);
  for (let n = 0; n < 3; n++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', buttons: 0, clickCount: 1 });
  }
  const pending = await page.evaluate(() => ({ preview: window.qteProduct.qteDelivery.preview(),
    fight: { qte: { successes: window.qteProduct.state.fishing.state.fight.qte.successes } },
    snapshot: window.qteProduct.qteDelivery.snapshot }));
  expect(pending.preview.success, JSON.stringify(pending)).toBe(true); expect(pending.fight.qte.successes).toBe(0);
  await expect.poll(() => page.evaluate(() => window.qteProduct.state.fishing.state.fight.qte.successes)).toBe(1);
  const after = await productSnapshot(page);
  expect(after.events.filter(e => e.type === 'qte-resolved')).toHaveLength(1);
  expect(await page.evaluate(() => window.qteProduct.renderer.info.render.frame)).toBeGreaterThan(rendersBefore);
  const ingress = await page.evaluate(() => window.e2eDiagnostics.events.filter(e => e.target === 'scene'));
  expect(ingress.filter(e => e.type === 'pointerdown').every(e => e.trusted)).toBe(true);
  await test.info().attach('real-clock-production-proof', { body: JSON.stringify({ before, pending, after, ingress }), contentType: 'application/json' });
});

for (const [speciesId, count, touch] of [['bluegill', 1, false], ['black-bass', 2, true]]) {
  test(`production ${count} reservations: ${speciesId} ${touch ? 'touch V1 restore' : 'mouse new'} → independent effects → V2 count`, async ({ createContext }) => {
    const context = await createContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1000, height: 700 },
      hasTouch: touch, isMobile: touch, deviceScaleFactor: .5 });
    const page = await context.newPage(); await openQteProduction(page, { save: touch ? historicalSave(1) : null });
    const input = await productInput(page, touch), p = await castAndHookProduct(page, input, { speciesId, operation: 'tap' });
    expect((await productSnapshot(page)).fight.qte.reservations).toHaveLength(count);
    for (let index = 0; index < count; index++) {
      await advanceToWarning(page, input, p, index);
      const e = await performProductOperation(page, input);
      const native = await page.evaluate(() => window.productNativeEvidence);
      const audit = await auditProductionQte({ ...e, native });
      await test.info().attach(`reservation-${index}-source-replay`, { body: JSON.stringify(audit), contentType: 'application/json' });
    }
    const record = await landProduct(page, input, p);
    expect(record.qteSuccessCount).toBe(count);
    expect((await productSnapshot(page)).events.filter(e => e.type === 'qte-resolved')).toHaveLength(count);
    await input.click(page.locator('#close-catch')); await page.clock.fastForward(1250);
    const saved = (await latest(page)).data;
    expect(saved.collection.catches.at(-1)).toMatchObject({ id: record.id, qteSuccessCount: count, disposition: 'stored' });
    await page.goto('./'); await page.clock.fastForward(32);
    await expect(page.locator('#status')).toBeHidden(); await expect(page.locator('.qte-hud')).toHaveCount(0);
    expect((await latest(page)).data.collection).toEqual(saved.collection);
  });
}

for (const touch of [false, true]) test(`production late rAF handoff ${touch ? 'touch cancel before seal' : 'mouse up'}: no ghost hold`, async ({ createContext }) => {
  const context = await createContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1000, height: 700 },
    hasTouch: touch, isMobile: touch, deviceScaleFactor: .5 });
  const page = await context.newPage(); await openQteProduction(page, { frameFaults: true });
  const input = await productInput(page, touch), p = await castAndHookProduct(page, input, { speciesId: 'bluegill', operation: 'tap' });
  await advanceToWarning(page, input, p, 0);
  for (let n = 0; n < 12 && !(await productSnapshot(page)).snapshot.displayReady; n++) await page.clock.fastForward(100);
  const before = await productSnapshot(page), target = before.geometry.target;
  for (let n = 0; n < 3; n++) {
    await page.clock.fastForward(10); await input.down(target); await page.clock.fastForward(20); await input.up();
  }
  expect((await productSnapshot(page)).preview.success).toBe(true);
  const skip = await page.evaluate(() => {
    window.holdProductionFrame = true;
    const d = window.qteProduct.qteDelivery; return d.snapshot.cut + 1900 - d.clock.read().active;
  });
  await page.clock.fastForward(skip);
  // Actual native ingress happens after C while the actual main callback is
  // delayed. It must survive sealing at the next rendering opportunity.
  await input.down(p);
  if (touch) { await page.clock.fastForward(50); await input.cancel(); }
  await page.evaluate(() => { window.holdProductionFrame = false; });
  await page.clock.fastForward(touch ? 50 : 100);
  const after = await productSnapshot(page);
  expect(after.fight.qte.successes).toBe(1); expect(after.fight.reeling).toBe(false);
  const resolved = after.events.find(e => e.type === 'qte-resolved').fight;
  expect(after.fight.renderSeconds - resolved.renderSeconds).toBeCloseTo(.25, 10);
  const native = await page.evaluate(() => window.productNativeEvidence);
  const audit = await auditProductionQte({ before, after, native });
  if (!touch) { await page.clock.fastForward(110); await input.up(); }
  const samples = [];
  for (let n = 0; n < 40; n++) {
    await page.clock.fastForward(50);
    const state = await page.evaluate(() => ({ reeling: window.qteProduct.state.fishing.state.fight.reeling,
      phase: window.qteProduct.state.fishing.state.phase, render: window.qteProduct.state.fishing.state.fight.renderSeconds }));
    samples.push(state); expect(state.reeling).toBe(false);
  }
  expect(await page.evaluate(() => window.skippedProductionFrames)).toBeGreaterThan(0);
  await test.info().attach('late-frame-handoff-proof', { body: JSON.stringify({ before, after, audit, samples }), contentType: 'application/json' });
});
