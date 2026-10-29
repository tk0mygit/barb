import { test, expect } from './diagnostics-fixture.js';
import { openUIFixture } from './ui-fixture.js';
import { EQUIPMENT_LEVELS } from '../../src/game/equipment.js';
import { FISHING_CONFIG } from '../../src/game/fishing-config.js';

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

async function assertBonuses(scope, kind, level, confirmation = false) {
  const rows = EQUIPMENT_LEVELS[kind], current = rows[level - 1], next = rows[level];
  const values = row => kind === 'rod'
    ? [row.tierMultipliers?.Uncommon ?? 1, row.tierMultipliers?.Rare ?? 1]
    : [row.largeFishAssistMultiplier ?? 1];
  const currentValues = values(current), nextValues = next && values(next);
  await expect(scope.locator('.equipment-bonuses dt')).toHaveText(kind === 'rod'
    ? ['Uncommon 出現重み', 'Rare 出現重み'] : ['大型魚 FIGHT巻取り補助']);
  await expect(scope.locator('.equipment-bonus-current')).toHaveText(currentValues.map(value => `現在 ×${value.toFixed(2)}`));
  await expect(scope.locator('.equipment-bonus-next')).toHaveText(next
    ? nextValues.map(value => `${confirmation ? '購入後 Lv.' : '次Lv.'}${next.level} ×${value.toFixed(2)}`) : []);
  await expect(scope.locator('.equipment-bonus-delta')).toHaveText(next
    ? nextValues.map((value, index) => `強化差 +${(value - currentValues[index]).toFixed(2)}倍`) : []);
  if (level < 6) await expect(scope.locator('.equipment-bonus-note')).toHaveText(confirmation && next.level < 6
    ? '今回の専用効果は変化なし（×1.00）。Lv.6から有効。' : 'Lv.6から有効（×1.00は補正なし）。');
  else await expect(scope.locator('.equipment-bonus-note')).toHaveCount(0);
  await expect(scope.locator('.equipment-bonus-scope')).toHaveText(kind === 'rod'
    ? '出現確率ではなく相対重みへの補正。Commonは変更なし。'
    : '大型魚とのFIGHT中のみ。LURE回収には適用されません。');
  if (kind === 'reel') await expect(scope.locator('.equipment-bonus-size')).toHaveText(
    '大型魚：70cm以上、または40cm以上で同魚種の長さ範囲の上位25%。');
  expect(await scope.textContent()).not.toMatch(/確率\s*[1１][.．][5５]倍|50[%％]出現|Lv\.11/);
}

async function assertEquipment(page, kind, level) {
  const scope = card(page, kind), row = EQUIPMENT_LEVELS[kind][level - 1], next = EQUIPMENT_LEVELS[kind][level];
  const values = row => kind === 'rod'
    ? [FISHING_CONFIG.castMax + row.castDistanceBonusM, Math.round((1 - row.tensionMultiplier) * 100)]
    : [Math.round(row.reelSpeedMultiplier * 100), Math.round(row.tensionReliefMultiplier * 100)];
  const currentValues = values(row), nextValues = next && values(next);
  const units = kind === 'rod' ? ['m', '%'] : ['%', '%'];
  await expect(scope).toHaveAttribute('aria-labelledby', `${kind}-heading`);
  await expect(scope.locator('button')).toHaveAttribute('aria-describedby', `${kind}-upgrade-state upgrade-guidance`);
  await expect(scope.locator('.equipment-current')).toHaveText(currentValues.map((value, index) => `現在 ${value}${units[index]}`));
  await expect(scope.locator('.equipment-next')).toHaveText(next
    ? nextValues.map((value, index) => `次Lv.${next.level} ${value}${units[index]}`) : []);
  await expect(scope.locator('.equipment-delta')).toHaveText(next
    ? nextValues.map((value, index) => `強化差 +${value - currentValues[index]}${units[index] === '%' ? 'ポイント' : 'm'}`) : []);
  await expect(scope.locator('.upgrade-price')).toHaveText(next ? [`次Lv.${next.level}の購入価格 ${money(next.cost)}`] : []);
  await assertBonuses(scope, kind, level);
}

async function assertNoOverflow(page) {
  expect(await page.locator('#collection-dialog, #collection-content, .equipment-card, .equipment-stats').evaluateAll(
    nodes => nodes.every(node => node.scrollWidth <= node.clientWidth))).toBe(true);
}

async function assertLayouts(page, touch, confirmation = false, screenshotName = null) {
  for (const viewport of touch ? [{ width: 320, height: 568 }, { width: 568, height: 320 }] : [{ width: 1000, height: 700 }]) {
    await page.setViewportSize(viewport);
    await assertNoOverflow(page);
    await expect(page.locator('#collection-dialog')).toHaveAttribute('aria-labelledby', 'collection-title');
    for (const bonus of await page.locator('.equipment-bonuses dt').all()) {
      await bonus.scrollIntoViewIfNeeded(); await expect(bonus).toBeInViewport();
    }
    if (screenshotName) await page.screenshot({ path: `test-results/${screenshotName}-${viewport.width}x${viewport.height}.png` });
    const controls = page.locator(confirmation
      ? '#confirm-upgrade, #cancel-upgrade, #collection-back, #collection-close'
      : '[data-upgrade], #collection-back, #collection-close');
    for (const control of await controls.all()) {
      await control.scrollIntoViewIfNeeded();
      const target = await control.evaluate(node => {
        const box = node.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { width: box.width, height: box.height, receivesEvents: hit === node || node.contains(hit) };
      });
      expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44);
      expect(target.receivesEvents).toBe(true);
    }
    if (touch) expect(await page.locator('#collection-content').evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  }
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
      await assertEquipment(page, kind, 1);
    }
    await assertLayouts(page, touch);
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
        await assertEquipment(page, kind, level);
        if (level === 5) {
          await expect(card(page, kind).locator('.upgrade-state')).toHaveText('所持金不足 · 必要 4,200 通貨');
          await expect(card(page, kind).locator('button')).toBeDisabled();
          await expect(card(page, kind).locator('.equipment-next')).toHaveText(kind === 'rod'
            ? ['次Lv.6 44m', '次Lv.6 21%'] : ['次Lv.6 133%', '次Lv.6 122%']);
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
        await assertBonuses(page.locator('#collection-content'), kind, level, true);
        await assertNoOverflow(page);
        if (touch && level === 1 && kind === 'rod') {
          await page.screenshot({ path: 'test-results/equipment-confirm-touch-portrait.png' });
          await page.setViewportSize({ width: 568, height: 320 });
          await assertNoOverflow(page);
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
    // Preserve the complete old Lv.1–5 purchase/performance checks above,
    // then buy the extension through the same production DOM confirmation.
    await click(page.locator('#collection-close'));
    await page.evaluate(() => fixture.fund(68200));
    const funded = await page.evaluate(() => fixture.collection.snapshot);
    await openEquipment(page, click);
    await assertLayouts(page, touch, false, `equipment-lv5-${touch ? 'touch' : 'mouse'}`);
    balance = 68200;
    const rows = [
      [6, 4200, 44, 21, 133, 122], [7, 5200, 48, 26, 143, 128],
      [8, 6500, 52, 31, 154, 134], [9, 8200, 56, 36, 165, 140], [10, 10000, 60, 41, 177, 146],
    ];
    for (const [level, cost, distance, suppression, speed, relief] of rows) {
      for (const kind of ['rod', 'reel']) {
        await assertEquipment(page, kind, level - 1);
        await expect(card(page, kind).locator('.equipment-next')).toHaveText(kind === 'rod'
          ? [`次Lv.${level} ${distance}m`, `次Lv.${level} ${suppression}%`]
          : [`次Lv.${level} ${speed}%`, `次Lv.${level} ${relief}%`]);
        await expect(card(page, kind).locator('.upgrade-price')).toContainText(money(cost));
        await click(card(page, kind).locator('button'));
        await expect(page.locator('.upgrade-confirm-level')).toHaveText(`現在 Lv.${level - 1} → 購入後 Lv.${level}`);
        await expect(page.locator('.upgrade-price')).toHaveText(`購入価格 ${money(cost)}`);
        await assertBonuses(page.locator('#collection-content'), kind, level - 1, true);
        await assertNoOverflow(page);
        if (level === 6 || level === 10) {
          await assertLayouts(page, touch, true, `equipment-confirm-lv${level}-${kind}-${touch ? 'touch' : 'mouse'}`);
        }
        if (level === 6) {
          // Cancel the first effective bonus on both input types; reopening keeps
          // the same canonical price and no equipment/wallet changes.
          const pending = await page.evaluate(() => fixture.collection.snapshot);
          await click(page.locator('#cancel-upgrade'));
          expect(await page.evaluate(() => fixture.collection.snapshot)).toEqual(pending);
          await assertEquipment(page, kind, 5);
          await click(card(page, kind).locator('button'));
          await expect(page.locator('.upgrade-price')).toHaveText(`購入価格 ${money(cost)}`);
          await assertBonuses(page.locator('#collection-content'), kind, 5, true);
        }
        await click(page.locator('#confirm-upgrade'));
        balance -= cost; await assertBalance(page, balance);
        await expect(card(page, kind).locator('h3')).toHaveText(`${kind === 'rod' ? 'ロッド' : 'リール'} · Lv.${level}`);
        await expect(card(page, kind).locator('.equipment-current')).toHaveText(kind === 'rod'
          ? [`現在 ${distance}m`, `現在 ${suppression}%`] : [`現在 ${speed}%`, `現在 ${relief}%`]);
        await assertEquipment(page, kind, level);
      }
      if ([6, 8, 10].includes(level)) await assertLayouts(page, touch, false,
        level === 10 ? `equipment-lv10-${touch ? 'touch' : 'mouse'}` : null);
    }
    for (const kind of ['rod', 'reel']) {
      await expect(card(page, kind).locator('.upgrade-state')).toHaveText('最大強化済み');
      await expect(card(page, kind).locator('button')).toBeDisabled();
      await expect(card(page, kind).locator('.equipment-next')).toHaveCount(0);
    }
    const maximum = await page.evaluate(() => fixture.collection.snapshot);
    expect(maximum.wallet).toEqual({ balance: 0, lifetimeSales: 81200 });
    expect(maximum.catches).toEqual(funded.catches); expect(maximum.encyclopedia).toEqual(funded.encyclopedia);
    expect(await page.evaluate(() => {
      const f = fixture.fishing; f.cancelInput();
      f.cancelForViewChange(); f.prepare({ x: 0, z: 0 }, 0); f.aim(0, 180);
      const distance = f.state.distance; f.cast(); f.step(f.settings.flightSeconds); f.reel(true); f.step(0.5);
      return { distance, retrieved: distance - f.state.distance };
    })).toEqual({ distance: 60, retrieved: expect.closeTo(0.65 * 1.77 * 0.5, 8) });
    expect(await page.locator('#collection-dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.locator('#collection-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
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
