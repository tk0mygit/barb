import { test, expect } from '@playwright/test';
import { createCatchCollection } from '../../src/game/catch-collection.js';
import { createAchievements } from '../../src/game/achievements.js';
import { createBoatState } from '../../src/game/boat.js';
import { createGameClock } from '../../src/game/game-clock.js';
import { createSaveData } from '../../src/game/save-data.js';

const KEYS = ['barb.save.v1.slotA', 'barb.save.v1.slotB'];
const envelope = (generation, data) => JSON.stringify({ storageVersion: 1, generation, data });
const phase = page => page.locator('#fishing-panel').getAttribute('data-phase');
async function slots(page) {
  return page.evaluate(keys => keys.map(key => localStorage.getItem(key)), KEYS);
}
async function latest(page) {
  return (await slots(page)).filter(Boolean).map(JSON.parse).sort((a, b) => b.generation - a.generation)[0];
}
async function checkpoint(page) {
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  return latest(page);
}
function fixtureData(elapsedSeconds = 45) {
  const collection = createCatchCollection({ now: () => 1000 });
  const achievements = createAchievements({ collection, now: () => 1000 });
  collection.register({ schemaVersion: 1, id: 'persisted-fish', speciesId: 'black-bass', lengthCm: 50,
    weightKg: 100, caughtAt: '2026-10-22T00:00:00.000Z' });
  collection.sellUnassigned('persisted-fish');
  return createSaveData({ collection, achievements, boat: createBoatState({ x: 10, z: 20, heading: 0.5 }),
    clock: createGameClock(undefined, { elapsedSeconds }) }, { savedAt: '2026-10-22T00:00:00.000Z' });
}
async function seed(page, values, failWrites = false) {
  await page.addInitScript(({ keys, values, failWrites }) => {
    const write = Storage.prototype.setItem;
    if (!sessionStorage.getItem('autosave-fixture-seeded')) {
      values.forEach((value, i) => { if (value !== null) write.call(localStorage, keys[i], value); });
      sessionStorage.setItem('autosave-fixture-seeded', 'yes');
    }
    window.failSaveWrites = failWrites;
    Storage.prototype.setItem = function(key, value) {
      if (window.failSaveWrites && keys.includes(key)) throw new DOMException('Test quota', 'QuotaExceededError');
      return write.call(this, key, value);
    };
  }, { keys: KEYS, values, failWrites });
}
async function ready(page) {
  await page.goto('./');
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#error')).toBeHidden();
}
async function gameInput(page, touch) {
  const cdp = await page.context().newCDPSession(page), x = touch ? 300 : 500, y = touch ? 420 : 350;
  return {
    click: locator => touch ? locator.tap({ force: true }) : locator.click({ force: true }),
    down: async () => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }) : (await page.mouse.move(x, y), page.mouse.down()),
    move: async (dx, dy) => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy }] }) : page.mouse.move(x + dx, y + dy),
    up: () => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) : page.mouse.up(),
  };
}
async function pauseClock(page, install = false) {
  if (install) await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  const now = new Date(await page.evaluate(() => Date.now()));
  // Freeze wall time before the next protocol round trip. Under software
  // WebGL load, sampling Date.now() then targeting +1s can already be in the
  // past when pauseAt reaches the page. No timing margin or longer wait is
  // needed; restore advancing wall time after the timers are paused.
  await page.clock.setFixedTime(now);
  await page.clock.pauseAt(now);
  await page.clock.setSystemTime(now);
}
async function castAndHook(page, input) {
  const tick = () => page.clock.fastForward(250);
  await page.evaluate(() => { window.testRandomValue = 0.1; });
  await input.click(page.locator('#cast-button')); await tick();
  await input.down(); await input.move(0, -180); await input.up(); await tick();
  for (let i = 0; i < 5 && await phase(page) === 'cast'; i++) await tick();
  expect(await phase(page)).toBe('lure');
  await page.evaluate(() => { window.testRandomValue = 0.99; });
  for (let i = 0; i < 32 && await phase(page) !== 'bite'; i++) await tick();
  expect(await phase(page)).toBe('bite');
  await input.down(); await input.up(); await tick();
  expect(await phase(page)).toBe('fight');
}
async function land(page, input) {
  let held = false;
  for (let i = 0; i < 140 && await phase(page) === 'fight'; i++) {
    const tension = await page.locator('#line-tension').evaluate(el => el.value);
    if (!held && tension < 0.35) { await input.down(); held = true; }
    else if (held && tension > 0.65) { await input.up(); held = false; }
    await page.clock.fastForward(250);
  }
  if (held) await input.up();
  expect(await phase(page)).toBe('landing');
  for (let i = 0; i < 5; i++) await page.clock.fastForward(250);
  await expect(page.locator('#catch-dialog')).toBeVisible();
}
async function openMenu(page, input, view) {
  await input.click(page.locator('#menu-button'));
  // Chromium's emulated drag can suppress the following compatibility click;
  // retry with another native tap instead of injecting a menu state change.
  if (!await page.locator('#collection-dialog').isVisible()) await input.click(page.locator('#menu-button'));
  await expect(page.locator('#collection-dialog')).toBeVisible();
  if (view) await input.click(page.locator(`[data-view="${view}"]`));
}
async function upgrade(page, input, kind) {
  await input.click(page.locator(`[data-upgrade="${kind}"]`));
  await input.click(page.locator('#confirm-upgrade'));
  await expect(page.locator(`[data-equipment="${kind}"] h3`)).toHaveText(`${kind === 'rod' ? 'ロッド' : 'リール'} · Lv.2`);
}

for (const touch of [false, true]) test(`${touch ? 'touch' : 'mouse'}: real captures, RESULT rescue, menu sale/upgrade and sailing survive reload`, async ({ browser }) => {
  test.setTimeout(240000);
  const context = await browser.newContext({ viewport: touch ? { width: 390, height: 844 } : { width: 800, height: 600 }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 0.5 });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { Math.random = () => window.testRandomValue ?? 0.1; });
  await ready(page);
  const input = await gameInput(page, touch);
  await input.click(page.locator('#fish-button'));
  await pauseClock(page, true);
  await castAndHook(page, input); await land(page, input);
  // Capture is saved while RESULT is open, together with its earned award.
  await page.clock.fastForward(1000);
  let before = await latest(page);
  expect(before.data.collection.catches).toHaveLength(1);
  expect(before.data.collection.catches[0].disposition).toBe('unassigned');
  expect(before.data.achievements.unlocked.map(item => item.id)).toContain('normal-first-catch');
  const firstId = before.data.collection.catches[0].id;
  await page.clock.resume(); await page.reload();
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#motion-label')).toHaveText('停船中');
  await expect(page.locator('#speed')).toHaveText('0.0');
  await expect(page.locator('#catch-dialog')).toBeHidden();
  await expect(page.locator('#achievement-notice')).toBeHidden();
  await openMenu(page, input, 'storage');
  await expect(page.locator('.stored-fish')).toHaveCount(1);
  await expect(page.locator('.stored-fish')).toHaveAttribute('data-catch-id', firstId);
  // These changes must save with the animation loop paused by the menu.
  await pauseClock(page);
  await input.click(page.locator('.sell-stored'));
  await page.clock.fastForward(1000);
  expect((await latest(page)).data.collection.catches[0].disposition).toBe('sold');
  await input.click(page.locator('#collection-back')); await input.click(page.locator('[data-view="equipment"]'));
  await upgrade(page, input, 'rod');
  await page.clock.fastForward(1000);
  before = await latest(page);
  expect(before.data.collection.equipment.rodLevel).toBe(2);
  expect(before.data.achievements.unlocked.map(item => item.id)).toContain('normal-first-upgrade');
  await expect(page.locator('#save-status')).toHaveAttribute('data-phase', 'saved');
  await input.click(page.locator('#collection-close'));
  // Real pointer sailing and active clock changes are picked up periodically.
  await input.down(); await input.move(25, -100);
  for (let i = 0; i < 8; i++) await page.clock.fastForward(250);
  await input.up();
  for (let i = 0; i < 12; i++) await page.clock.fastForward(250);
  await expect(page.locator('#motion-label')).toHaveText('停船中');
  const generation = before.generation;
  await page.clock.fastForward(21000);
  expect((await latest(page)).generation).toBeGreaterThan(generation);
  await openMenu(page, input);
  before = await checkpoint(page);
  expect(before.data.boat).not.toEqual({ x: 0, z: 30, heading: 0 });
  expect(before.data.clock.elapsedSeconds).toBeGreaterThan(20);
  const walletText = await page.locator('#wallet-balance').textContent();
  await page.clock.resume(); await page.reload();
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#wallet-balance')).toHaveText(walletText);
  await expect(page.locator('#achievement-notice')).toBeHidden();
  await openMenu(page, input, 'equipment');
  await expect(page.locator('[data-equipment="rod"] h3')).toHaveText('ロッド · Lv.2');
  const after = await checkpoint(page);
  expect(after.data.collection).toEqual(before.data.collection);
  expect(after.data.achievements).toEqual(before.data.achievements);
  expect(after.data.boat).toEqual(before.data.boat);
  expect(after.data.clock.elapsedSeconds).toBeGreaterThanOrEqual(before.data.clock.elapsedSeconds);
  expect(after.data.clock.elapsedSeconds).toBeLessThan(before.data.clock.elapsedSeconds + 10);
  await page.screenshot({ path: `test-results/autosave-restored-${touch ? 'touch' : 'mouse'}.png` });
  await input.click(page.locator('#collection-back')); await input.click(page.locator('[data-view="encyclopedia"]'));
  await expect(page.locator('button.fish-card')).toHaveCount(1);
  await input.click(page.locator('#collection-back')); await input.click(page.locator('[data-view="achievements"]'));
  await expect(page.locator('[data-achievement-id="normal-first-upgrade"]')).toHaveAttribute('data-unlocked', 'true');
  await input.click(page.locator('#collection-close'));
  // A restored session can catch, sell and purchase again without duplicate IDs.
  await input.click(page.locator('#fish-button')); await pauseClock(page);
  await castAndHook(page, input); await land(page, input);
  await input.click(page.locator('#sell-catch')); await page.clock.fastForward(1000);
  await openMenu(page, input, 'equipment'); await upgrade(page, input, 'reel');
  await page.clock.fastForward(1000);
  const continued = await latest(page);
  expect(continued.data.collection.catches).toHaveLength(2);
  expect(new Set(continued.data.collection.catches.map(item => item.id)).size).toBe(2);
  expect(continued.data.collection.equipment).toEqual({ rodLevel: 2, reelLevel: 2 });
  expect(errors).toEqual([]);
  await context.close();
});

test('reload during a real fight resumes safely in sailing mode and READY', async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => window.testRandomValue ?? 0.1; });
  await ready(page);
  const input = await gameInput(page, false);
  await input.click(page.locator('#fish-button')); await pauseClock(page, true);
  await castAndHook(page, input);
  await checkpoint(page);
  await page.clock.resume(); await page.reload();
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#motion-label')).toHaveText('停船中');
  await expect(page.locator('#catch-dialog')).toBeHidden();
  await input.click(page.locator('#fish-button'));
  await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('#cast-button')).toBeEnabled();
});

test('corrupt newest slot restores the valid backup and explains the fallback', async ({ page }) => {
  await seed(page, [envelope(4, fixtureData()), '{broken-newest']);
  await ready(page);
  await expect(page.locator('#save-status')).toContainText('バックアップ');
  await expect(page.locator('#wallet-balance')).toHaveText('10,000 通貨');
  const data = await checkpoint(page);
  expect(data.data.collection.wallet.balance).toBe(10000);
  expect(data.data.boat).toEqual(fixtureData().boat);
});

for (const unsupported of [false, true]) test(`${unsupported ? 'future version' : 'all corrupt slots'}: new in-memory session preserves both original strings`, async ({ page }) => {
  const data = JSON.parse(JSON.stringify(fixtureData()));
  data.saveVersion = 99;
  const original = unsupported ? [envelope(4, data), null] : ['{broken-A', '{broken-B'];
  await seed(page, original); await ready(page);
  await expect(page.locator('#save-status')).toHaveAttribute('data-phase', 'protected');
  await expect(page.locator('#wallet-balance')).toHaveText('0 通貨');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  expect(await slots(page)).toEqual(original);
  await page.locator('#fish-button').click();
  await expect(page.locator('#cast-button')).toBeEnabled();
});

test('quota failure preserves the latest good save, shows unsaved progress, then retries', async ({ page }) => {
  const original = [envelope(1, fixtureData(40)), envelope(2, fixtureData(45))];
  await seed(page, original, true); await ready(page);
  await page.locator('#menu-button').click(); // Keep the saved status stable while the clock is paused.
  await checkpoint(page);
  await expect(page.locator('#save-status')).toHaveAttribute('data-phase', 'failed');
  await expect(page.locator('#save-status')).toContainText('保存');
  expect(await slots(page)).toEqual(original);
  await page.evaluate(() => {
    window.failSaveWrites = false;
    // The production listener must flush synchronously when the page becomes hidden.
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.hidden;
  });
  const recovered = await latest(page);
  await expect(page.locator('#save-status')).toHaveAttribute('data-phase', 'saved');
  expect(recovered.generation).toBe(3);
  expect((await slots(page))[1]).toBe(original[1]);
});

test('localStorage access denial keeps the game playable and reports unavailable', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', {
    configurable: true, get() { throw new DOMException('Test denied', 'SecurityError'); },
  }));
  await ready(page);
  await expect(page.locator('#save-status')).toHaveAttribute('data-phase', 'unavailable');
  await page.locator('#fish-button').click();
  await expect(page.locator('#cast-button')).toBeEnabled();
});

test('another tab save stops the older session before it can overwrite new progress', async ({ page, context }) => {
  await seed(page, [envelope(1, fixtureData()), null]);
  // Keep the original tab's periodic save from winning while the second tab
  // compiles WebGL on slow/software GPUs. Freeze on the blank page, before any
  // game timers exist; a single explicit frame then makes progress dirty.
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.goto('./'); await page.clock.fastForward(250);
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#error')).toBeHidden();
  const other = await context.newPage();
  await other.goto('./');
  // Playwright's clock controls the whole context, including the new tab.
  await page.clock.fastForward(250);
  await expect(other.locator('#status')).toBeHidden();
  await expect(other.locator('#error')).toBeHidden();
  // Real lifecycle autosave in the second page sends a native storage event.
  expect((await checkpoint(other)).generation).toBe(2);
  await expect(page.locator('#save-status')).toHaveAttribute('data-phase', 'conflict');
  const fresh = await slots(other);
  await checkpoint(page);
  expect(await slots(page)).toEqual(fresh);
  await other.close();
});

for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }]) test(`save warning and menu remain reachable at ${viewport.width}x${viewport.height}`, async ({ browser }) => {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 0.5 });
  const page = await context.newPage();
  await seed(page, ['broken-A', 'broken-B']); await ready(page);
  const status = page.locator('#save-status');
  await expect(status).toBeVisible();
  const bounds = await status.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  await page.screenshot({ path: `test-results/autosave-protected-${viewport.width}x${viewport.height}.png` });
  await page.locator('#menu-button').tap();
  await page.locator('[data-view="equipment"]').tap();
  await expect(page.locator('[data-equipment="rod"]')).toBeVisible();
  await page.locator('#collection-close').tap();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});

test('renderer initialization failure leaves both good save generations untouched', async ({ page }) => {
  const original = [envelope(1, fixtureData(40)), envelope(2, fixtureData(45))];
  await seed(page, original);
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...options) {
      return type === 'webgl2' ? null : getContext.call(this, type, ...options);
    };
  });
  await page.clock.install();
  await page.goto('./');
  await expect(page.locator('#error')).toBeVisible();
  await page.clock.fastForward(60000);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  expect(await slots(page)).toEqual(original);
});
