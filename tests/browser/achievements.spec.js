import { test, expect } from './diagnostics-fixture.js';
import { installPausedClock } from './clock-fixture.js';
import { openUIFixture } from './ui-fixture.js';
import { NORMAL_ACHIEVEMENTS } from '../../src/game/achievements.js';

const card = (page, id) => page.locator(`[data-achievement-id="normal-${id}"].achievement-card`);
const notice = page => page.locator('#achievement-notice');
async function openAchievements(page, click = locator => locator.click()) {
  await click(page.locator('#menu-button'));
  await click(page.locator('[data-view="achievements"]'));
}

for (const touch of [false, true]) test(`${touch ? 'touch' : 'mouse'}: ten achievements, live progress, sales and upgrades in the shared menu`, async ({ createContext }) => {
  const context = await createContext({ viewport: touch ? { width: 320, height: 568 } : { width: 1000, height: 700 }, hasTouch: touch, isMobile: touch });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await installPausedClock(page); await openUIFixture(page);
  const click = locator => touch ? locator.tap() : locator.click();
  await click(page.locator('#menu-button'));
  await expect(page.locator('#collection-content > button')).toHaveText(['魚図鑑', '保管魚', '装備強化', '実績']);
  await click(page.locator('[data-view="achievements"]'));
  await expect(page.locator('.achievement-card')).toHaveCount(10);
  await expect(page.locator('.achievement-card h3')).toHaveText(NORMAL_ACHIEVEMENTS.map(entry => entry.name));
  await expect(page.locator('.achievement-summary')).toHaveText('解除済み 0 / 10');
  await expect(page.locator('.achievement-card[data-unlocked="false"]')).toHaveCount(10);
  await expect(card(page, 'catch-10').locator('.achievement-progress')).toHaveText('累計捕獲：0 / 10匹');
  await expect(card(page, 'length-100').locator('.achievement-progress')).toHaveText('最大体長：0.0 / 100cm');
  // Real domain mutations, only in this routed fixture; progress refreshes even
  // while the achievements screen is open and there is no animation loop.
  await page.evaluate(() => {
    fixture.collection.register({ schemaVersion: 1, id: 'first', speciesId: 'black-bass',
      lengthCm: 82.5, weightKg: 62, caughtAt: '2026-01-01T00:00:00Z' });
    fixture.collection.store('first');
  });
  await expect(page.locator('.achievement-summary')).toHaveText('解除済み 1 / 10');
  await expect(card(page, 'first-catch')).toHaveAttribute('data-unlocked', 'true');
  await expect(card(page, 'first-catch').locator('.achievement-state')).toHaveText('✓ 解除済み');
  await expect(card(page, 'first-catch').locator('time')).toHaveAttribute('datetime', /T.*Z$/);
  await expect(card(page, 'species-5').locator('.achievement-progress')).toHaveText('魚種発見：1 / 5種');
  await expect(card(page, 'length-100').locator('.achievement-progress')).toHaveText('最大体長：82.5 / 100cm');
  await expect(notice(page)).toContainText('初めての一匹');
  expect(await notice(page).evaluate(el => el.parentElement.id)).toBe('collection-dialog');
  await page.clock.fastForward(3500); await expect(notice(page)).toBeHidden();
  // Individual sale then a second capture worth 3,800 and a confirmed bulk sale.
  await click(page.locator('#collection-back')); await click(page.locator('[data-view="storage"]'));
  await click(page.locator('.sell-stored'));
  await click(page.locator('#collection-back')); await click(page.locator('[data-view="achievements"]'));
  await expect(card(page, 'sales-10000').locator('.achievement-progress')).toHaveText('累計売却額：6,200 / 10,000 通貨');
  await expect(card(page, 'sales-10000')).toHaveAttribute('data-unlocked', 'false');
  await page.evaluate(() => {
    fixture.collection.register({ schemaVersion: 1, id: 'second', speciesId: 'black-bass',
      lengthCm: 50, weightKg: 38, caughtAt: '2026-01-01T00:00:00Z' }); fixture.collection.store('second');
  });
  await click(page.locator('#collection-back')); await click(page.locator('[data-view="storage"]'));
  await click(page.locator('#sell-all')); await click(page.locator('#cancel-sale'));
  expect(await page.evaluate(() => fixture.achievements.unlockedCount)).toBe(1);
  await click(page.locator('#sell-all')); await click(page.locator('#confirm-sale'));
  await expect(notice(page)).toContainText('累計売却10,000');
  const noOverlap = await page.evaluate(() => {
    const a = document.querySelector('#achievement-notice').getBoundingClientRect();
    const b = document.querySelector('#collection-sale-notice').getBoundingClientRect();
    return a.top >= b.bottom || a.bottom <= b.top;
  });
  expect(noOverlap).toBe(true);
  await click(page.locator('#collection-back')); await click(page.locator('[data-view="equipment"]'));
  await click(page.locator('[data-upgrade="rod"]')); await click(page.locator('#cancel-upgrade'));
  expect(await page.evaluate(() => fixture.achievements.unlockedCount)).toBe(2);
  await click(page.locator('[data-upgrade="rod"]')); await click(page.locator('#confirm-upgrade'));
  await page.clock.fastForward(3500); await expect(notice(page)).toContainText('初強化');
  await click(page.locator('#collection-back')); await click(page.locator('[data-view="achievements"]'));
  await expect(page.locator('.achievement-summary')).toHaveText('解除済み 3 / 10');
  await expect(card(page, 'sales-10000')).toHaveAttribute('data-unlocked', 'true');
  await expect(card(page, 'sales-10000').locator('.achievement-progress')).toHaveText('累計売却額：10,000 / 10,000 通貨');
  await expect(card(page, 'first-upgrade').locator('.achievement-progress')).toHaveText('ロッドLv.2・リールLv.1 / いずれかLv.2');
  // Fill the collection and buy through the public API, checking the open view
  // refreshes to all ten awards without a menu reopen or a frame update.
  await page.evaluate(async () => {
    const { FISH_SPECIES } = await import('./src/game/fish-species.js');
    fixture.fund(3000);
    for (let i = fixture.collection.catches.length; i < 100; i++) fixture.collection.register({
      schemaVersion: 1, id: 'catch-' + i, speciesId: FISH_SPECIES[i % 12].id,
      lengthCm: 100, weightKg: 1, caughtAt: '2026-01-01T00:00:00Z',
    });
    for (const kind of ['rod', 'reel']) {
      for (let level = fixture.collection.equipment[kind + 'Level']; level < 5; level++) fixture.collection.purchaseUpgrade(kind, level);
    }
    fixture.salesHUD.update();
  });
  await expect(page.locator('.achievement-summary')).toHaveText('解除済み 10 / 10');
  await expect(card(page, 'equipment-max').locator('.achievement-progress')).toHaveText('ロッドLv.5・リールLv.5 / 両方Lv.5');
  await expect(page.locator('.achievement-card[data-unlocked="true"]')).toHaveCount(10);
  if (touch) {
    const cdp = await context.newCDPSession(page);
    const box = await page.locator('#collection-content').boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 50, y: box.y + box.height - 20 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 50, y: box.y + 20 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(await page.locator('#collection-content').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  }
  for (const viewport of touch ? [{ width: 320, height: 568 }, { width: 568, height: 320 }] : [{ width: 1000, height: 700 }]) {
    await page.setViewportSize(viewport);
    for (const id of ['collection-dialog', 'collection-content']) expect(await page.locator(`#${id}`).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (const id of ['collection-back', 'collection-close']) {
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
    await page.screenshot({ path: `test-results/achievements-${viewport.width}x${viewport.height}.png` });
  }
  await click(page.locator('#collection-back')); await click(page.locator('#collection-close'));
  await expect(page.locator('#collection-dialog')).toBeHidden();
  await page.clock.resume(); await page.reload(); await page.waitForFunction(() => Boolean(window.fixture));
  await openAchievements(page, click); await expect(page.locator('.achievement-summary')).toHaveText('解除済み 0 / 10');
  await expect(notice(page)).toBeHidden();
  expect(errors).toEqual([]);
});

test('simultaneous awards queue exactly once and expire without frames, including across menu visits', async ({ page }) => {
  await installPausedClock(page); await openUIFixture(page);
  await page.evaluate(() => {
    fixture.collection.register({ schemaVersion: 1, id: 'big', speciesId: 'arowana', lengthCm: 100,
      weightKg: 1, caughtAt: '2026-01-01T00:00:00Z' });
  });
  await expect(notice(page)).toContainText('実績解除初めての一匹');
  await expect(notice(page)).toHaveAttribute('aria-live', 'polite');
  await expect(notice(page)).toHaveAttribute('aria-atomic', 'true');
  await page.clock.fastForward(1000); await openAchievements(page);
  await expect(page.locator('.achievement-summary')).toHaveText('解除済み 2 / 10');
  await page.clock.fastForward(2499); await expect(notice(page)).toContainText('初めての一匹');
  await page.clock.fastForward(1); await expect(notice(page)).toContainText('大物ハンター');
  await page.locator('#collection-close').click();
  await page.evaluate(() => fixture.achievementNotice.notify(fixture.achievements.entries.filter(entry => entry.unlocked)));
  await page.clock.fastForward(3499); await expect(notice(page)).toBeVisible();
  await page.clock.fastForward(1); await expect(notice(page)).toBeHidden();
  await page.evaluate(() => fixture.achievements.evaluate());
  await openAchievements(page); await expect(notice(page)).toBeHidden();
  await page.clock.fastForward(60000); await expect(notice(page)).toBeHidden();
});

test('throttled background timer expires the visible award and preserves pending awards with their full turn', async ({ page }) => {
  await installPausedClock(page); await openUIFixture(page);
  await page.evaluate(() => {
    fixture.collection.register({ schemaVersion: 1, id: 'big', speciesId: 'arowana', lengthCm: 100,
      weightKg: 1, caughtAt: '2026-01-01T00:00:00Z' });
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(notice(page)).toBeHidden();
  await page.clock.setSystemTime(new Date(await page.evaluate(() => Date.now() + 60000)));
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(notice(page)).toContainText('大物ハンター');
  expect(await page.evaluate(() => fixture.achievements.unlockedCount)).toBe(2);
  await page.clock.fastForward(3499); await expect(notice(page)).toBeVisible();
  await page.clock.fastForward(1); await expect(notice(page)).toBeHidden();
});

for (const touch of [false, true]) test(`${touch ? 'touch' : 'mouse'}: notice passes pointer input through to the canvas`, async ({ createContext }) => {
  const context = await createContext({ viewport: { width: 320, height: 568 }, hasTouch: touch, isMobile: touch });
  const page = await context.newPage(); await installPausedClock(page); await openUIFixture(page);
  await page.evaluate(async () => {
    const { createFishingHUD } = await import('./src/ui/fishing-hud.js');
    const noop = () => {};
    const hud = createFishingHUD({ onPrepare: noop, onCancel: noop, onClose: noop, onSell: noop, onSelectLure: noop });
    document.querySelector('#app').classList.add('fishing');
    hud.update(fixture.fishing, true, { timeOfDay: 'day', cycleProgress: 0 });
    window.canvasPresses = 0;
    document.querySelector('#scene').addEventListener('pointerdown', () => window.canvasPresses++);
    fixture.fund(300, true);
  });
  // Compact save labels must keep the notification gap, including the longest
  // warning/backup message while the full explanation remains in the menus.
  for (const savePhase of ['dirty', 'failed', 'protected', 'conflict']) {
    await page.evaluate(async savePhase => {
      const { createSaveStatus } = await import('./src/ui/save-status.js');
      createSaveStatus().update({ phase: savePhase, code: null, savedAt: null, restoredFromBackup: true });
    }, savePhase);
    expect(await page.evaluate(() => {
      const a = document.querySelector('#achievement-notice').getBoundingClientRect();
      return ['.masthead', '#fishing-panel', '#sale-notice', '#cast-button'].every(selector => {
        const b = document.querySelector(selector).getBoundingClientRect();
        return a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom;
      });
    })).toBe(true);
  }
  const box = await notice(page).boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  expect(await notice(page).evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).id, { x, y })).toBe('scene');
  if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
  expect(await page.evaluate(() => window.canvasPresses)).toBe(1);
});
