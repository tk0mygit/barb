import { test, expect } from './diagnostics-fixture.js';
import { openUIFixture } from './ui-fixture.js';
import { createCatchCollection } from '../../src/game/catch-collection.js';
import { createAchievements } from '../../src/game/achievements.js';
import { createBoatState } from '../../src/game/boat.js';
import { createGameClock } from '../../src/game/game-clock.js';
import { createSaveData } from '../../src/game/save-data.js';

function savedSession() {
  const collection = createCatchCollection();
  const achievements = createAchievements({ collection, now: () => 1000 });
  for (let i = 0; i < 9; i++) {
    collection.register({ schemaVersion: 1, id: `saved-${i}`, speciesId: 'black-bass', lengthCm: 40 + i,
      weightKg: i === 0 ? 1000 : 1, caughtAt: '2026-10-22T00:00:00.000Z' });
    if (i === 0) collection.sellUnassigned(`saved-${i}`);
    else if (i !== 8) collection.store(`saved-${i}`);
  }
  collection.purchaseUpgrade('rod', 1);
  const boat = createBoatState({ x: 10, z: 20, heading: 1 });
  const clock = createGameClock(); clock.step(180);
  return createSaveData({ collection, achievements, boat, clock });
}

for (const touch of [false, true]) test(`restored domain renders menus silently, rescues fish and notifies only new awards (${touch ? 'touch' : 'mouse'})`, async ({ createContext }) => {
  const context = await createContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1000, height: 700 }, hasTouch: touch });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const click = locator => touch ? locator.tap() : locator.click();
  await openUIFixture(page, savedSession());
  const notice = page.locator('#achievement-notice');
  await expect(notice).toBeHidden();
  expect(await page.evaluate(() => ({ boat: fixture.restored.boat, clock: fixture.restored.clock.state.timeOfDay,
    phase: fixture.fishing.state.phase, stored: fixture.collection.stored.length }))).toEqual({
    boat: { x: 10, z: 20, heading: 1, speed: 0, mode: 'sailing' }, clock: 'night', phase: 'ready', stored: 8,
  });
  await click(page.locator('#menu-button')); await click(page.locator('[data-view="achievements"]'));
  await expect(page.locator('.achievement-summary')).toHaveText('解除済み 3 / 15');
  await expect(page.locator('#collection-content')).toContainText('累計10匹');
  await expect(notice).toBeHidden();
  await click(page.locator('#collection-back')); await click(page.locator('[data-view="storage"]'));
  await expect(page.locator('#collection-content')).toContainText('48.0'); // rescued RESULT fish
  await click(page.locator('[data-catch-id="saved-8"] .sell-stored'));
  await expect(page.locator('[data-catch-id="saved-8"]')).toHaveCount(0);
  await page.evaluate(() => {
    fixture.collection.register({ schemaVersion: 1, id: 'after-restore', speciesId: 'black-bass', lengthCm: 40,
      weightKg: 1, caughtAt: '2026-10-23T00:00:00.000Z' });
    fixture.menu.update();
  });
  await expect(notice).toContainText('累計10匹');
  expect(await page.evaluate(() => fixture.achievements.snapshot.unlocked.find(item => item.id === 'normal-first-catch').unlockedAt)).toBe('1970-01-01T00:00:01.000Z');
  expect(errors).toEqual([]);
});
