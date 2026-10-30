import { test, expect } from './diagnostics-fixture.js';
import { openQteFixture } from './qte-fixture.js';
import { calculateSalePrice } from '../../src/game/fish-sales.js';
import { createCatchCollection } from '../../src/game/catch-collection.js';
import { createAchievements } from '../../src/game/achievements.js';
import { createSaveData } from '../../src/game/save-data.js';
import { createBoatState } from '../../src/game/boat.js';
import { createGameClock } from '../../src/game/game-clock.js';

const keys = ['barb.save.v1.slotA', 'barb.save.v1.slotB'];
const money = value => `${value.toLocaleString('ja-JP')} 通貨`;
const latest = page => page.evaluate(keys => keys.map(key => localStorage.getItem(key)).filter(Boolean).map(JSON.parse)
  .sort((a, b) => b.generation - a.generation)[0]?.data, keys);

for (const touch of [false, true]) test(`${touch ? 'touch immediate' : 'mouse stored/bulk'}: sealed QTEs → RESULT bonus → V2 → production restore`, async ({ createContext }) => {
  const context = await createContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1000, height: 700 },
    hasTouch: touch, isMobile: touch, deviceScaleFactor: .5 });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const click = locator => touch ? locator.tap() : locator.click();
  const cdp = touch ? await context.newCDPSession(page) : null;
  // Only this Playwright route composes QTE and economics. main.js retains its
  // ordinary QTE-OFF new-game and restore factories.
  await openQteFixture(page, 'tap', { economy: true });
  for (let index = 0; index < 3; index++) {
    await page.waitForFunction(index => window.qteFixture.fishing.state.fight.qte.token?.index === index
      && Boolean(window.qteFixture.hud.geometry), index, { timeout: 15000 });
    const g = await page.evaluate(index => ({ ...window.qteFixture.hud.geometry,
      d: window.qteFixture.provider.getDescriptor(index) }), index);
    const vectors = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
    const v = vectors[g.d.direction] ?? [0, 0], distance = g.d.operation === 'swipe' ? 80 : g.d.operation === 'flick' ? 50 : 0;
    const start = { x: g.target.x - v[0] * distance / 2, y: g.target.y - v[1] * distance / 2 };
    const end = { x: g.target.x + v[0] * distance / 2, y: g.target.y + v[1] * distance / 2 };
    // Position the mouse during the warning, so travel/protocol setup does not
    // consume the 0.5s gesture window. The fresh down still waits for A.
    if (!touch) await page.mouse.move(start.x, start.y);
    await page.waitForFunction(index => document.querySelector('.qte-hud')?.dataset.state === 'active'
      && window.qteFixture.fishing.state.fight.qte.token?.index === index, index, { timeout: 15000 });
    for (let tap = 0; tap < (g.d.operation === 'tap' ? 3 : 1); tap++) {
      if (touch) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
        if (distance) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.mouse.down();
        if (distance) await page.mouse.move(end.x, end.y);
        await page.mouse.up();
      }
    }
    const scored = await page.evaluate(() => ({ preview: { success: window.qteFixture.delivery.preview().success,
      successes: window.qteFixture.fishing.state.fight.qte.successes, catches: window.qteFixture.fishing.state.catches.length },
      snapshot: window.qteFixture.delivery.snapshot, evidence: window.qteFixture.evidence() }));
    await test.info().attach(`qte-${index}-evidence`, { body: JSON.stringify(scored), contentType: 'application/json' });
    expect(scored.preview, JSON.stringify(scored)).toEqual({ success: true, successes: index, catches: 0 });
    await expect.poll(() => page.evaluate(() => window.qteFixture.fishing.state.fight.qte.successes)).toBe(index + 1);
  }
  await expect(page.locator('#catch-dialog')).toBeVisible();
  const record = await page.evaluate(() => window.qteFixture.fishing.state.catch);
  expect(record.qteSuccessCount).toBe(3);
  const price = calculateSalePrice(record), base = calculateSalePrice({ ...record, qteSuccessCount: 0 });
  await expect(page.locator('#catch-sale-price')).toHaveText(`売却価格 ${money(price)}`);
  await expect(page.locator('#catch-qte-bonus')).toHaveText(`QTE成功3回／ボーナス+${money(price - base)}`);
  expect(await page.evaluate(() => window.qteFixture.events.filter(e => e === 'qte-resolved').length)).toBe(3);
  await page.screenshot({ path: `test-results/qte-economy-${touch ? 'touch' : 'mouse'}-result.png` });
  await click(page.locator(touch ? '#sell-catch' : '#close-catch'));
  await expect(page.locator('#catch-dialog')).toBeHidden();
  await expect.poll(async () => (await latest(page))?.collection.catches[0]?.disposition).toBe(touch ? 'sold' : 'stored');
  const checkpoint = await latest(page);
  expect(checkpoint.saveVersion).toBe(2); expect(checkpoint.collection.catches[0].qteSuccessCount).toBe(3);
  expect(checkpoint.collection.wallet).toEqual({ balance: touch ? price : 0, lifetimeSales: touch ? price : 0 });
  if (touch) expect(checkpoint.collection.catches[0].salePrice).toBe(price);
  // Revisit the built production application, using only its ordinary restore.
  await page.goto('./'); await expect(page.locator('#status')).toBeHidden(); await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#wallet-balance')).toHaveText(money(touch ? price : 0));
  if (!touch) {
    await click(page.locator('#menu-button')); await click(page.locator('[data-view="storage"]'));
    await expect(page.locator('.stored-price')).toHaveText(`売却価格 ${money(price)}`);
    await click(page.locator('#sell-all'));
    await expect(page.locator('.sale-confirm-summary')).toHaveText(`1匹を ${money(price)} で売却します。`);
    await click(page.locator('#confirm-sale'));
    await expect(page.locator('#wallet-balance')).toHaveText(money(price));
  }
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const sold = await latest(page);
  expect(sold.collection.wallet).toEqual({ balance: price, lifetimeSales: price });
  expect(sold.collection.catches[0]).toMatchObject({ qteSuccessCount: 3, disposition: 'sold', salePrice: price });
  expect(sold.achievements.unlocked.filter(award => checkpoint.achievements.unlocked.some(old => old.id === award.id)))
    .toEqual(checkpoint.achievements.unlocked);
  await page.reload(); await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#wallet-balance')).toHaveText(money(price));
  expect(errors).toEqual([]);
});

for (const touch of [false, true]) test(`restored V2 half-up bonus: individual sale stays single across reload (${touch ? 'touch' : 'mouse'})`, async ({ createContext }) => {
  const collection = createCatchCollection({ now: () => 1000 });
  const achievements = createAchievements({ collection, now: () => 1000 });
  collection.register({ schemaVersion: 1, id: 'half-up', speciesId: 'black-bass', lengthCm: 40,
    weightKg: .25, caughtAt: '2026-10-31T00:00:00Z', qteSuccessCount: 1 });
  collection.store('half-up');
  const data = createSaveData({ collection, achievements, boat: createBoatState(), clock: createGameClock() });
  const context = await createContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1000, height: 700 },
    hasTouch: touch, isMobile: touch, deviceScaleFactor: .5 });
  const page = await context.newPage(), click = locator => touch ? locator.tap() : locator.click();
  await page.addInitScript(({ keys, data }) => {
    if (!sessionStorage.getItem('qte-individual-seeded')) {
      localStorage.setItem(keys[0], JSON.stringify({ storageVersion: 1, generation: 1, data }));
      sessionStorage.setItem('qte-individual-seeded', 'yes');
    }
  }, { keys, data });
  await page.goto('./'); await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#error')).toBeHidden();
  await click(page.locator('#menu-button')); await click(page.locator('[data-view="storage"]'));
  await expect(page.locator('.stored-price')).toHaveText(`売却価格 ${money(28)}`);
  const stale = await page.locator('.sell-stored').elementHandle();
  await click(page.locator('.sell-stored'));
  await expect(page.locator('#wallet-balance')).toHaveText(money(28));
  // An intentionally stale callback is a negative test, not a normal UI action.
  await stale.evaluate(button => button.click());
  await expect(page.locator('#wallet-balance')).toHaveText(money(28));
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const sold = await latest(page);
  expect(sold.saveVersion).toBe(2);
  expect(sold.collection.wallet).toEqual({ balance: 28, lifetimeSales: 28 });
  expect(sold.collection.catches[0]).toMatchObject({ qteSuccessCount: 1, disposition: 'sold', salePrice: 28 });
  expect(sold.achievements).toEqual(data.achievements);
  await page.reload(); await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#wallet-balance')).toHaveText(money(28));
  await click(page.locator('#menu-button')); await click(page.locator('[data-view="storage"]'));
  await expect(page.locator('.stored-fish')).toHaveCount(0);
  expect((await latest(page)).collection.catches[0].soldAt).toBe(sold.collection.catches[0].soldAt);
});
