import { test, expect } from './diagnostics-fixture.js';
import { openUIFixture } from './ui-fixture.js';

const money = value => `${value.toLocaleString('ja-JP')} 通貨`;
const card = (page, kind) => page.locator(`[data-equipment="${kind}"]`);
async function openEquipment(page, click = locator => locator.click()) {
  await click(page.locator('#menu-button'));
  await click(page.locator('[data-view="equipment"]'));
}
async function assertBalance(page, balance) {
  await expect(page.locator('#wallet-balance')).toHaveText(money(balance));
  await expect(page.locator('#collection-wallet')).toHaveText(`所持金 ${money(balance)}`);
}

for (const touch of [false, true]) {
  test(`${touch ? 'touch' : 'mouse'}: equipment levels, exact prices, purchases and next-cast performance`, async ({ createContext }) => {
    const context = await createContext({ viewport: touch ? { width: 320, height: 568 } : { width: 1000, height: 700 }, hasTouch: touch, isMobile: touch });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await openUIFixture(page);
    const click = locator => touch ? locator.tap() : locator.click();
    await openEquipment(page, click);
    for (const kind of ['rod', 'reel']) {
      await expect(card(page, kind).locator('h3')).toContainText('Lv.1');
      await expect(card(page, kind).locator('.upgrade-state')).toHaveText('所持金不足 · 必要 300 通貨');
      await expect(card(page, kind).locator('button')).toBeDisabled();
    }
    await expect(card(page, 'rod').locator('.equipment-current')).toHaveText(['現在 32m', '現在 0%']);
    await expect(card(page, 'reel').locator('.equipment-current')).toHaveText(['現在 100%', '現在 100%']);
    await click(page.locator('#collection-close'));
    await page.evaluate(() => fixture.fund(13000));
    const before = await page.evaluate(() => fixture.collection.snapshot);
    await openEquipment(page, click);
    let balance = 13000;
    const prices = [300, 800, 1800, 3600];
    for (let level = 1; level <= 5; level++) {
      for (const kind of ['rod', 'reel']) {
        const current = kind === 'rod' ? [`現在 ${32 + 2 * (level - 1)}m`, `現在 ${4 * (level - 1)}%`]
          : [`現在 ${100 + 6 * (level - 1)}%`, `現在 ${100 + 4 * (level - 1)}%`];
        await expect(card(page, kind).locator('.equipment-current')).toHaveText(current);
        if (level === 5) {
          await expect(card(page, kind).locator('.upgrade-state')).toHaveText('最大強化済み');
          await expect(card(page, kind).locator('button')).toBeDisabled();
          await expect(card(page, kind).locator('.equipment-next')).toHaveCount(0);
          continue;
        }
        await expect(card(page, kind).locator('.equipment-next')).toHaveText(kind === 'rod'
          ? [`次Lv.${level + 1} ${32 + 2 * level}m`, `次Lv.${level + 1} ${4 * level}%`]
          : [`次Lv.${level + 1} ${100 + 6 * level}%`, `次Lv.${level + 1} ${100 + 4 * level}%`]);
        await expect(card(page, kind).locator('.equipment-delta')).toHaveText(kind === 'rod'
          ? ['強化差 +2m', '強化差 +4ポイント'] : ['強化差 +6ポイント', '強化差 +4ポイント']);
        await expect(card(page, kind).locator('.upgrade-price')).toContainText(money(prices[level - 1]));
        await expect(card(page, kind).locator('.upgrade-state')).toHaveText('購入可能');
        await click(card(page, kind).locator('button'));
        await expect(page.locator('#collection-title')).toHaveText('装備強化の購入確認');
        await expect(page.locator('.upgrade-confirm-name')).toHaveText(`${kind === 'rod' ? 'ロッド' : 'リール'}を強化します。`);
        await expect(page.locator('.upgrade-confirm-level')).toHaveText(`現在 Lv.${level} → 購入後 Lv.${level + 1}`);
        await expect(page.locator('.upgrade-price')).toHaveText(`購入価格 ${money(prices[level - 1])}`);
        if (touch && level === 1 && kind === 'rod') {
          await page.screenshot({ path: 'test-results/equipment-confirm-touch-portrait.png' });
          await page.setViewportSize({ width: 568, height: 320 });
        }
        const oldConfirm = await page.locator('#confirm-upgrade').elementHandle();
        await click(page.locator('#confirm-upgrade'));
        await oldConfirm.evaluate(button => { button.click(); button.dispatchEvent(new MouseEvent('click')); });
        balance -= prices[level - 1]; await assertBalance(page, balance);
        await expect(card(page, kind).locator('h3')).toContainText(`Lv.${level + 1}`);
        await expect(page.locator('.upgrade-message')).toHaveAttribute('role', 'status');
      }
    }
    const after = await page.evaluate(() => fixture.collection.snapshot);
    expect(after.wallet).toEqual({ balance: 0, lifetimeSales: 13000 });
    expect(after.catches).toEqual(before.catches); expect(after.encyclopedia).toEqual(before.encyclopedia);
    // The same production fishing API reads the equipment purchased via DOM.
    expect(await page.evaluate(() => {
      const f = fixture.fishing;
      f.prepare({ x: 0, z: 0 }, 0); f.aim(0, 180);
      const distance = f.state.distance;
      f.cast(); f.step(f.settings.flightSeconds); f.reel(true); f.step(0.5);
      return { distance, retrieved: distance - f.state.distance };
    })).toEqual({ distance: 40, retrieved: expect.closeTo(0.65 * 1.24 * 0.5, 8) });
    await page.screenshot({ path: `test-results/equipment-max-${touch ? 'touch-landscape' : 'mouse'}.png` });
    expect(await page.locator('#collection-dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.locator('#collection-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await click(page.locator('#collection-close'));
    await openEquipment(page, click); await assertBalance(page, 0);
    expect(errors).toEqual([]);
  });
}

test('cancel/back/Esc/close, stale confirmations and latest game state/balance never purchase accidentally', async ({ page }) => {
  await openUIFixture(page);
  await page.evaluate(() => fixture.fund(1100));
  await openEquipment(page);
  for (const action of ['cancel', 'back', 'Escape', 'close', 'native-close']) {
    await card(page, 'rod').locator('button').click();
    const stale = await page.locator('#confirm-upgrade').elementHandle();
    if (action === 'cancel') await page.locator('#cancel-upgrade').click();
    else if (action === 'back') await page.locator('#collection-back').click();
    else if (action === 'Escape') await page.keyboard.press('Escape');
    else if (action === 'close') await page.locator('#collection-close').click();
    else await page.evaluate(() => {
      // Native close queues its close event; an immediate stale event must fail too.
      const confirm = document.querySelector('#confirm-upgrade');
      document.querySelector('#collection-dialog').close(); confirm.click();
    });
    if (['Escape', 'close', 'native-close'].includes(action)) await openEquipment(page);
    // A confirmation from the prior visit cannot consume a new confirmation.
    await card(page, 'rod').locator('button').click();
    await stale.evaluate(el => el.click()); await assertBalance(page, 1100);
    await page.locator('#cancel-upgrade').click();
    expect(await page.evaluate(() => fixture.collection.equipment.rodLevel)).toBe(1);
  }
  await card(page, 'rod').locator('button').click();
  await page.evaluate(() => { fixture.allowed = false; });
  await page.locator('#confirm-upgrade').click();
  await expect(page.locator('.upgrade-message')).toHaveAttribute('role', 'alert');
  await expect(page.locator('.upgrade-message')).toHaveText('操船中、またはキャスト前に強化できます');
  await assertBalance(page, 1100);
  await expect(card(page, 'rod').locator('button')).toBeDisabled();
  await page.locator('#collection-close').click();
  await page.evaluate(() => { fixture.allowed = true; });
  await openEquipment(page); await card(page, 'rod').locator('button').click();
  // A different event already purchased this level. Do not buy the next level.
  await page.evaluate(() => fixture.collection.purchaseUpgrade('rod', 1));
  await page.locator('#confirm-upgrade').click(); await assertBalance(page, 800);
  await expect(page.locator('.upgrade-message')).toHaveAttribute('role', 'alert');
  await expect(card(page, 'rod').locator('h3')).toContainText('Lv.2');
  await card(page, 'rod').locator('button').click();
  // Spend through another equipment API while the 800 quote is open.
  await page.evaluate(() => fixture.collection.purchaseUpgrade('reel', 1));
  await page.locator('#confirm-upgrade').click(); await assertBalance(page, 500);
  await expect(page.locator('.upgrade-message')).toHaveAttribute('role', 'alert');
  await expect(card(page, 'rod').locator('.upgrade-state')).toHaveText('所持金不足 · 必要 800 通貨');
  await expect(card(page, 'reel').locator('h3')).toContainText('Lv.2');
});

test('a prohibited opening stays read-only after the existing input reset', async ({ page }) => {
  await openUIFixture(page); await page.evaluate(() => { fixture.fund(300); fixture.allowed = false; });
  await page.locator('#menu-button').click();
  await page.evaluate(() => { fixture.allowed = true; });
  await page.locator('[data-view="equipment"]').click();
  await expect(card(page, 'rod').locator('button')).toBeDisabled();
  await expect(page.locator('#upgrade-guidance')).toHaveText('操船中、またはキャスト前に強化できます');
  await card(page, 'rod').locator('button').dispatchEvent('click');
  await expect(page.locator('#confirm-upgrade')).toHaveCount(0); await assertBalance(page, 300);
  await page.locator('#collection-close').click();
  await openEquipment(page); await card(page, 'rod').locator('button').click();
  await page.locator('#confirm-upgrade').click(); await assertBalance(page, 0);
  expect(await page.evaluate(() => fixture.collection.wallet.lifetimeSales)).toBe(300);
});
