import { test, expect } from './diagnostics-fixture.js';
import { createGameplay } from '../../src/game/gameplay.js';
import { createSaveData } from '../../src/game/save-data.js';
import { calculateSalePrice } from '../../src/game/fish-sales.js';
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

for (const touch of [false, true]) test(`production default OFF ${touch ? 'touch' : 'mouse'}: native fight → zero bonus → save/restore`, async ({ createContext }) => {
  const context = await createContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1000, height: 700 },
    hasTouch: touch, isMobile: touch, deviceScaleFactor: .5 });
  const page = await context.newPage();
  await openQteProduction(page, { enabled: false, save: touch ? historicalSave(1) : null });
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
