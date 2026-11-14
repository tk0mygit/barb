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

for (const touch of [false, true]) test(`${touch ? 'touch' : 'mouse'}: nineteen achievements, live progress, sales and upgrades in the shared menu`, async ({ createContext }) => {
  const context = await createContext({ viewport: touch ? { width: 320, height: 568 } : { width: 1000, height: 700 }, hasTouch: touch, isMobile: touch });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await installPausedClock(page); await openUIFixture(page);
  const click = locator => touch ? locator.tap() : locator.click();
  await click(page.locator('#menu-button'));
  await expect(page.locator('.menu-entry-title')).toHaveText(['図鑑', '生けす', 'ギア／アップグレード', '実績', 'ヘルプ']);
  await click(page.locator('[data-view="achievements"]'));
  await expect(page.locator('.achievement-card')).toHaveCount(19);
  await expect(page.locator('.achievement-card h3')).toHaveText(Array(19).fill('？？？'));
  await expect(page.locator('.achievement-card > p:first-of-type')).toHaveText(NORMAL_ACHIEVEMENTS.map(entry => entry.description));
  for (const entry of NORMAL_ACHIEVEMENTS) {
    const locked = page.locator(`.achievement-card[data-achievement-id="${entry.id}"]`);
    expect(await locked.evaluate(node => node.outerHTML)).not.toContain(entry.name);
    expect(await locked.ariaSnapshot()).not.toContain(entry.name);
  }
  await expect(page.locator('.achievement-summary')).toHaveText('解除済み 0 / 19');
  await expect(page.locator('.achievement-card[data-unlocked="false"]')).toHaveCount(19);
  await expect(card(page, 'catch-10').locator('.achievement-progress')).toHaveText('累計捕獲：0 / 10匹');
  await expect(card(page, 'length-100').locator('.achievement-progress')).toHaveText('最大体長：0.0 / 100cm');
  // Real domain mutations, only in this routed fixture; progress refreshes even
  // while the achievements screen is open and there is no animation loop.
  await page.evaluate(() => {
    fixture.collection.register({ schemaVersion: 1, id: 'first', speciesId: 'black-bass',
      lengthCm: 82.5, weightKg: 62, caughtAt: '2026-01-01T00:00:00Z' });
    fixture.collection.store('first');
  });
  await expect(page.locator('.achievement-summary')).toHaveText('解除済み 1 / 19');
  await expect(card(page, 'first-catch')).toHaveAttribute('data-unlocked', 'true');
  await expect(card(page, 'first-catch').locator('h3')).toHaveText('始まり');
  await expect(card(page, 'first-catch').locator('.achievement-state')).toHaveText('✓ 解除済み');
  await expect(card(page, 'first-catch').locator('time')).toHaveAttribute('datetime', /T.*Z$/);
  await expect(card(page, 'species-5').locator('.achievement-progress')).toHaveText('魚種発見：1 / 5種');
  await expect(card(page, 'length-100').locator('.achievement-progress')).toHaveText('最大体長：82.5 / 100cm');
  await expect(notice(page)).toContainText('始まり');
  expect(await notice(page).evaluate(el => el.parentElement.id)).toBe('collection-dialog');
  await page.clock.fastForward(5000); await expect(notice(page)).toBeHidden();
  // Individual sale then a second capture worth 3,800 and a confirmed bulk sale.
  await click(page.locator('#collection-back')); await click(page.locator('[data-view="storage"]'));
  await click(page.locator('.sell-stored'));
  await click(page.locator('#collection-back')); await click(page.locator('[data-view="achievements"]'));
  await expect(card(page, 'sales-10000').locator('.achievement-progress')).toHaveText('累計売却額：6,200 / 10,000 Value');
  await expect(card(page, 'sales-10000')).toHaveAttribute('data-unlocked', 'false');
  await page.evaluate(() => {
    fixture.collection.register({ schemaVersion: 1, id: 'second', speciesId: 'black-bass',
      lengthCm: 50, weightKg: 38, caughtAt: '2026-01-01T00:00:00Z' }); fixture.collection.store('second');
  });
  await click(page.locator('#collection-back')); await click(page.locator('[data-view="storage"]'));
  await click(page.locator('#sell-all')); await click(page.locator('#cancel-sale'));
  expect(await page.evaluate(() => fixture.achievements.unlockedCount)).toBe(1);
  await click(page.locator('#sell-all')); await click(page.locator('#confirm-sale'));
  await expect(notice(page)).toContainText('等価交換');
  // The approved viewport overlay replaces the former in-flow strip. It keeps
  // its anchor even over menu content, without changing the sale UI's layout.
  const anchor = await notice(page).boundingBox();
  expect(anchor.y + anchor.height / 2).toBeCloseTo(page.viewportSize().height * 0.35, 1);
  await expect(page.locator('#collection-sale-notice')).toBeVisible();
  expect(await notice(page).evaluate(el => getComputedStyle(el).position)).toBe('fixed');
  await click(page.locator('#collection-back')); await click(page.locator('[data-view="equipment"]'));
  await click(page.locator('[data-upgrade="rod"]')); await click(page.locator('#cancel-upgrade'));
  expect(await page.evaluate(() => fixture.achievements.unlockedCount)).toBe(2);
  await click(page.locator('[data-upgrade="rod"]')); await click(page.locator('#confirm-upgrade'));
  await page.clock.fastForward(5000); await expect(notice(page)).toContainText('更新');
  await click(page.locator('#collection-back')); await click(page.locator('[data-view="achievements"]'));
  await expect(page.locator('.achievement-summary')).toHaveText('解除済み 3 / 19');
  await expect(card(page, 'sales-10000')).toHaveAttribute('data-unlocked', 'true');
  await expect(card(page, 'sales-10000').locator('.achievement-progress')).toHaveText('累計売却額：10,000 / 10,000 Value');
  await expect(card(page, 'first-upgrade').locator('.achievement-progress')).toHaveText('ロッドLv.2・リールLv.1 / いずれかLv.2');
  // Fill the collection and buy through the public API, checking the open view
  // refreshes to all ten old awards plus two Lv.5 awards without reopening.
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
  await expect(page.locator('.achievement-summary')).toHaveText('解除済み 12 / 19');
  await expect(card(page, 'equipment-max').locator('.achievement-progress')).toHaveText('ロッドLv.5・リールLv.5 / 両方Lv.5');
  await expect(page.locator('.achievement-card[data-unlocked="true"]')).toHaveCount(12);
  await expect(page.locator('.achievement-card[data-unlocked="false"] h3')).toHaveText(Array(7).fill('？？？'));
  for (const definition of NORMAL_ACHIEVEMENTS.slice(0, 10)) {
    await expect(page.locator(`.achievement-card[data-achievement-id="${definition.id}"]`)).toHaveAttribute('data-unlocked', 'true');
  }
  await expect(card(page, 'rod-level-5').locator('.achievement-progress')).toHaveText('ロッドLv.5 / Lv.5');
  await expect(card(page, 'reel-level-5').locator('.achievement-progress')).toHaveText('リールLv.5 / Lv.5');
  await expect(card(page, 'equipment-level-10')).toHaveAttribute('data-unlocked', 'false');
  await page.evaluate(() => {
    fixture.fund(68200);
    for (const kind of ['rod', 'reel']) for (let level = 5; level < 10; level++) fixture.collection.purchaseUpgrade(kind, level);
  });
  await expect(page.locator('.achievement-summary')).toHaveText('解除済み 15 / 19');
  await expect(page.locator('.achievement-card[data-unlocked="true"]')).toHaveCount(15);
  await expect(card(page, 'species-24')).toHaveAttribute('data-unlocked', 'false');
  await page.evaluate(async () => {
    const { FISH_SPECIES, calculateFishWeightKg } = await import('./src/game/fish-species.js');
    for (const fish of FISH_SPECIES.slice(12,24)) fixture.collection.register({
      schemaVersion: 1, id: `species24-${fish.id}`, speciesId: fish.id, lengthCm: fish.minLengthCm,
      weightKg: calculateFishWeightKg(fish.id, fish.minLengthCm), caughtAt: '2026-11-07T00:00:00Z',
    });
  });
  await expect(page.locator('.achievement-summary')).toHaveText('解除済み 16 / 19');
  await expect(page.locator('.achievement-card[data-unlocked="true"]')).toHaveCount(16);
  await expect(card(page, 'species-24')).toHaveAttribute('data-unlocked', 'true');
  await page.evaluate(async () => {
    const { FISH_SPECIES, calculateFishWeightKg } = await import('./src/game/fish-species.js');
    for (const fish of FISH_SPECIES.slice(24,35)) fixture.collection.register({
      schemaVersion: 1, id: `species36-${fish.id}`, speciesId: fish.id, lengthCm: fish.minLengthCm,
      weightKg: calculateFishWeightKg(fish.id, fish.minLengthCm), caughtAt: '2026-11-08T00:00:00Z',
    });
  });
  await expect(card(page, 'species-36')).toHaveAttribute('data-unlocked', 'false');
  await expect(card(page, 'species-36').locator('.achievement-progress')).toHaveText('魚種発見：35 / 36種');
  await page.evaluate(async () => {
    const { FISH_SPECIES, calculateFishWeightKg } = await import('./src/game/fish-species.js');
    const fish = FISH_SPECIES[35];
    fixture.collection.register({ schemaVersion: 1, id: `species36-${fish.id}`, speciesId: fish.id,
      lengthCm: fish.minLengthCm, weightKg: calculateFishWeightKg(fish.id, fish.minLengthCm), caughtAt: '2026-11-08T00:00:00Z' });
  });
  await expect(card(page, 'species-36')).toHaveAttribute('data-unlocked', 'true');
  await expect(page.locator('.achievement-summary')).toHaveText('解除済み 17 / 19');
  await expect(page.locator('.achievement-card[data-unlocked="true"]')).toHaveCount(17);
  await expect(page.locator('.achievement-card h3')).toHaveText([...NORMAL_ACHIEVEMENTS.slice(0, 17).map(entry => entry.name), '？？？', '？？？']);
  await expect(card(page, 'aurora-observed').locator('.achievement-progress')).toHaveText('天体観測：0 / 1（未観測）');
  await page.evaluate(() => { fixture.achievements.recordObservation('aurora'); fixture.achievements.recordObservation('meteor'); });
  // Production observations occur with the menu closed. Reopen the real view
  // after this domain-only fixture event, as a player does after observing.
  await click(page.locator('#collection-close')); await openAchievements(page, click);
  await expect(page.locator('.achievement-summary')).toHaveText('解除済み 19 / 19');
  await expect(page.locator('.achievement-card[data-unlocked="true"]')).toHaveCount(19);
  await expect(page.locator('.achievement-card h3')).toHaveText(NORMAL_ACHIEVEMENTS.map(entry => entry.name));
  await expect(card(page, 'meteor-observed').locator('.achievement-progress')).toHaveText('天体観測：1 / 1（観測済み）');
  await expect(card(page, 'rod-level-10').locator('.achievement-progress')).toHaveText('ロッドLv.10 / Lv.10');
  await expect(card(page, 'reel-level-10').locator('.achievement-progress')).toHaveText('リールLv.10 / Lv.10');
  await expect(card(page, 'equipment-level-10').locator('.achievement-progress')).toHaveText('ロッドLv.10・リールLv.10 / 両方Lv.10');
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
  await openAchievements(page, click); await expect(page.locator('.achievement-summary')).toHaveText('解除済み 0 / 19');
  await expect(notice(page)).toBeHidden();
  expect(errors).toEqual([]);
});

test('simultaneous awards queue exactly once and expire without frames, including across menu visits', async ({ page }) => {
  await installPausedClock(page); await openUIFixture(page);
  await page.evaluate(() => {
    fixture.collection.register({ schemaVersion: 1, id: 'big', speciesId: 'arowana', lengthCm: 100,
      weightKg: 1, caughtAt: '2026-01-01T00:00:00Z' });
  });
  await expect(notice(page)).toContainText('実績を解除した始まり');
  await expect(notice(page)).toHaveAttribute('aria-live', 'polite');
  await expect(notice(page)).toHaveAttribute('aria-atomic', 'true');
  await page.clock.fastForward(1000); await openAchievements(page);
  await expect(page.locator('.achievement-summary')).toHaveText('解除済み 2 / 19');
  await page.clock.fastForward(3999); await expect(notice(page)).toContainText('始まり');
  await page.clock.fastForward(1); await expect(notice(page)).toContainText('特異個体');
  await page.locator('#collection-close').click();
  await page.evaluate(() => fixture.achievementNotice.notify(fixture.achievements.entries.filter(entry => entry.unlocked)));
  await page.clock.fastForward(4999); await expect(notice(page)).toBeVisible();
  await page.clock.fastForward(1); await expect(notice(page)).toBeHidden();
  await page.evaluate(() => fixture.achievements.evaluate());
  await openAchievements(page); await expect(notice(page)).toBeHidden();
  await page.clock.fastForward(60000); await expect(notice(page)).toBeHidden();
});

test('throttled background timer expires the visible award and preserves pending awards with their full turn', async ({ page }) => {
  await installPausedClock(page); await openUIFixture(page);
  await page.evaluate(async () => {
    fixture.collection.register({ schemaVersion: 1, id: 'big', speciesId: 'arowana', lengthCm: 100,
      weightKg: 1, caughtAt: '2026-01-01T00:00:00Z' });
    // Complete notification arbitration before hiding an already-visible award.
    await Promise.resolve();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(notice(page)).toBeHidden();
  await page.clock.setSystemTime(new Date(await page.evaluate(() => Date.now() + 60000)));
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(notice(page)).toContainText('特異個体');
  expect(await page.evaluate(() => fixture.achievements.unlockedCount)).toBe(2);
  await page.clock.fastForward(4999); await expect(notice(page)).toBeVisible();
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
  // The new overlay retains its anchor with every compact save label. Native
  // controls must remain hit targets even if fixed text crosses their area.
  for (const savePhase of ['dirty', 'failed', 'protected', 'conflict']) {
    await page.evaluate(async savePhase => {
      const { createSaveStatus } = await import('./src/ui/save-status.js');
      createSaveStatus().update({ phase: savePhase, code: null, savedAt: null, restoredFromBackup: true });
    }, savePhase);
    const layout = await page.evaluate(() => {
      const a = document.querySelector('#achievement-notice').getBoundingClientRect();
      return { centerX: a.x + a.width / 2, centerY: a.y + a.height / 2,
        hits: ['#cast-button', '[data-lure-id="minnow"]', '#menu-button'].map(selector => {
          const button = document.querySelector(selector), b = button.getBoundingClientRect();
          return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('button') === button;
        }) };
    });
    expect(layout.centerX).toBeCloseTo(160, 1);
    expect(layout.centerY).toBeCloseTo(568 * 0.35, 1);
    expect(layout.hits).toEqual([true, true, true]);
  }
  const box = await notice(page).boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  expect(await notice(page).evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).id, { x, y })).toBe('scene');
  if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
  expect(await page.evaluate(() => window.canvasPresses)).toBe(1);
});
