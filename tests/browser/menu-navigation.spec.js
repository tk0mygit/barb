import { test, expect } from './diagnostics-fixture.js';
import { openUIFixture } from './ui-fixture.js';
import { setup as setupLighting, read as readLighting, assertEnvironment } from './day-night-fixture.js';

const entries = [
  ['encyclopedia', '図鑑', '発見した魚と捕獲記録'],
  ['storage', '生けす', '保管した魚の確認・売却'],
  ['equipment', 'ギア／アップグレード', 'ロッドとリールの強化'],
  ['achievements', '実績', '達成条件と進捗'],
  ['sound', 'サウンド設定', 'BGM・自然音の設定'],
  ['help', 'ヘルプ', 'プレイと操作の基本'],
];
const profiles = [
  { name: 'PC', viewport: { width: 1280, height: 800 }, touch: false, rootSize: 16 },
  { name: 'touch portrait', viewport: { width: 390, height: 844 }, touch: true, rootSize: 16 },
  { name: 'touch short landscape', viewport: { width: 568, height: 320 }, touch: true, rootSize: 20 },
];

async function applyTextAndInsets(page, rootSize = 20) {
  await page.addStyleTag({ content: `:root { font-size: ${rootSize}px; --safe-top: 8px; --safe-right: 12px; --safe-bottom: 8px; --safe-left: 12px; }` });
}

async function activate(locator, touch) {
  if (touch) await locator.tap(); else await locator.click();
}

async function reachable(locator) {
  await locator.scrollIntoViewIfNeeded();
  const measured = await locator.evaluate(element => {
    const r = element.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { x: r.x, y: r.y, width: r.width, height: r.height,
      receivesEvents: hit === element || element.contains(hit),
      inViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
  });
  expect(measured.width).toBeGreaterThanOrEqual(44);
  expect(measured.height).toBeGreaterThanOrEqual(44);
  expect(measured.inViewport).toBe(true);
  expect(measured.receivesEvents).toBe(true);
  return measured;
}

async function menuMetrics(page) {
  return page.evaluate(() => {
    const content = document.querySelector('#collection-content');
    const box = content.getBoundingClientRect();
    return { viewport: { width: innerWidth, height: innerHeight }, rootFont: getComputedStyle(document.documentElement).fontSize,
      scrollTop: content.scrollTop, clientHeight: content.clientHeight, scrollHeight: content.scrollHeight,
      clientWidth: content.clientWidth, scrollWidth: content.scrollWidth,
      content: { x: box.x, y: box.y, width: box.width, height: box.height },
      focus: { id: document.activeElement?.id, view: document.activeElement?.dataset.view },
      cards: [...document.querySelectorAll('.menu-entry')].map(element => {
        const r = element.getBoundingClientRect();
        return { view: element.dataset.view, x: r.x, y: r.y, width: r.width, height: r.height,
          background: getComputedStyle(element).backgroundColor };
      }) };
  });
}

async function noHorizontalOverflow(page) {
  expect(await page.locator('#collection-dialog, #collection-content, #collection-view').evaluateAll(
    elements => elements.every(element => element.scrollWidth <= element.clientWidth))).toBe(true);
}

for (const profile of profiles) {
  test(`${profile.name}: six approved cards, native navigation and parent position survive a menu visit`, async ({ createContext }, info) => {
    const context = await createContext({ viewport: profile.viewport, hasTouch: profile.touch,
      isMobile: profile.touch, deviceScaleFactor: 0.5, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('./');
    await expect(page.locator('#status')).toBeHidden();
    if (profile.rootSize === 20) await applyTextAndInsets(page);
    await activate(page.locator('#menu-button'), profile.touch);
    await expect(page.locator('#collection-close')).toBeFocused();
    await expect(page.locator('#collection-dialog')).toHaveCount(1);
    await expect(page.locator('.menu-entry')).toHaveCount(6);
    await expect(page.locator('.menu-entry-title')).toHaveText(entries.map(([, label]) => label));
    await expect(page.locator('.menu-entry-description')).toHaveText(entries.map(([, , description]) => description));
    await expect(page.locator('[data-view="help"]')).toHaveCount(1);
    await expect(page.locator('.menu-entry--aux')).toHaveCount(2);
    await expect(page.locator('.menu-entry--aux').nth(0)).toHaveAttribute('data-view', 'sound');
    await expect(page.locator('.menu-entry--aux').nth(1)).toHaveAttribute('data-view', 'help');
    await expect(page.locator('.menu-entry-title').first()).toHaveCSS('font-size', `${profile.rootSize}px`);
    await expect(page.locator('.menu-entry-description').first()).toHaveCSS('font-size', `${profile.rootSize * 13 / 16}px`);
    const initial = await menuMetrics(page);
    expect(initial.cards[0].background).toBe('rgb(33, 74, 64)');
    expect(initial.cards[3].background).toBe('rgb(33, 74, 64)');
    expect(initial.cards[4].background).toBe('rgb(48, 71, 77)');
    expect(initial.cards[5].background).toBe('rgb(48, 71, 77)');
    if (profile.touch) expect(initial.cards[1].y).toBeGreaterThan(initial.cards[0].y);
    else expect(initial.cards[1].y).toBe(initial.cards[0].y);
    for (let index = 1; index < initial.cards.length; index++) {
      if (profile.touch) {
        expect(initial.cards[index].x).toBe(initial.cards[0].x);
        expect(initial.cards[index].y).toBeGreaterThan(initial.cards[index - 1].y);
      } else if (index % 2 === 1) {
        expect(initial.cards[index].y).toBe(initial.cards[index - 1].y);
        expect(initial.cards[index].x).toBeGreaterThan(initial.cards[index - 1].x);
      } else {
        expect(initial.cards[index].x).toBe(initial.cards[0].x);
        expect(initial.cards[index].y).toBeGreaterThan(initial.cards[index - 1].y);
      }
    }
    await page.screenshot({ path: info.outputPath('menu-start.png'), scale: 'css' });
    const observations = { initial, visited: [] };
    for (const [view, label, description] of entries) {
      const card = page.getByRole('button', { name: label, exact: true });
      await expect(card).toHaveAttribute('data-view', view);
      await expect(card).toHaveAccessibleDescription(description);
      const hit = await reachable(card);
      const top = await page.locator('#collection-content').evaluate(element => element.scrollTop);
      await activate(card, profile.touch);
      await expect(page.locator('#collection-title')).toHaveText(label);
      await expect(page.locator('#collection-title')).toBeFocused();
      await noHorizontalOverflow(page);
      await reachable(page.locator('#collection-back'));
      await reachable(page.locator('#collection-close'));
      await activate(page.locator('#collection-back'), profile.touch);
      await expect(page.locator('#collection-title')).toHaveText('湖の記録');
      await expect(page.locator(`[data-view="${view}"]`)).toBeFocused();
      await expect.poll(async () => Math.abs(await page.locator('#collection-content').evaluate(element => element.scrollTop) - top)).toBeLessThanOrEqual(1);
      observations.visited.push({ view, scrollTop: top, hit });
    }
    await page.screenshot({ path: info.outputPath('menu-returned-from-help.png'), scale: 'css' });
    if (profile.name === 'touch short landscape') {
      expect(await page.locator('#collection-content').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      await page.locator('.menu-entry').first().scrollIntoViewIfNeeded();
      const before = await page.locator('#collection-content').evaluate(element => element.scrollTop);
      const bounds = await page.locator('#collection-content').boundingBox();
      const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height - 10;
      const cdp = await context.newCDPSession(page);
      await page.locator('#collection-content').evaluate(element => {
        const initialTop = element.scrollTop;
        window.menuNativeScrollEnd = new Promise(resolve => {
          const finished = () => {
            // Ignore an earlier scrollIntoView completion. The touch gesture
            // below must have moved this scroller before it can finish.
            if (element.scrollTop <= initialTop) return;
            element.removeEventListener('scrollend', finished);
            resolve(element.scrollTop);
          };
          element.addEventListener('scrollend', finished);
        });
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 80 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(() => page.locator('#collection-content').evaluate(element => element.scrollTop)).toBeGreaterThan(before);
      // A tap during native momentum scrolling stops the fling and need not
      // click. Wait for its real end before testing the next deliberate tap.
      observations.nativeTouchScroll = { before, after: await page.evaluate(() => window.menuNativeScrollEnd) };
    }
    await activate(page.locator('#collection-close'), profile.touch);
    await expect(page.locator('#collection-dialog')).toBeHidden();
    await expect(page.locator('#scene')).toBeFocused();
    await activate(page.locator('#menu-button'), profile.touch);
    await expect(page.locator('#collection-close')).toBeFocused();
    await expect.poll(() => page.locator('#collection-content').evaluate(element => element.scrollTop)).toBe(0);
    await expect(page.locator('#collection-back')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('#collection-dialog')).toBeHidden();
    await expect(page.locator('#scene')).toBeFocused();
    await info.attach('menu-observations', { body: Buffer.from(JSON.stringify(observations, null, 2)), contentType: 'application/json' });
  });
}

test('keyboard and pointer states retain card positions, labels and parent focus', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await expect(page.locator('#status')).toBeHidden();
  await page.locator('#menu-button').click();
  await expect(page.locator('#collection-close')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-view="encyclopedia"]')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#collection-close')).toBeFocused();
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await expect(page.locator('#collection-title')).toHaveText('図鑑');
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#collection-back')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-view="encyclopedia"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-view="storage"]')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('#collection-title')).toHaveText('生けす');
  await page.locator('#collection-back').click();
  await expect(page.locator('[data-view="storage"]')).toBeFocused();
  for (const [view, label] of [['sound', 'サウンド設定'], ['help', 'ヘルプ']]) {
    const card = page.locator(`[data-view="${view}"]`);
    const before = await card.boundingBox();
    await card.hover();
    await expect(card).toHaveCSS('background-color', 'rgb(58, 83, 90)');
    expect(await card.boundingBox()).toEqual(before);
    await card.focus();
    await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    await expect(card).toBeFocused();
    await expect(card).toHaveCSS('outline-color', 'rgb(242, 201, 108)');
    await expect(card).toHaveCSS('outline-width', '3px');
    await expect(card).toHaveCSS('outline-offset', '3px');
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await expect(card).toHaveCSS('background-color', 'rgb(39, 60, 66)');
    expect(await card.boundingBox()).toEqual(before);
    await page.mouse.up();
    await expect(page.locator('#collection-title')).toHaveText(label);
    await page.locator('#collection-back').click();
    await expect(page.locator(`[data-view="${view}"]`)).toBeFocused();
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#scene')).toBeFocused();
});

test('touch: representative portrait, landscape and text enlargement keep the last card reachable after rotation', async ({ createContext }, info) => {
  const context = await createContext({ viewport: { width: 390, height: 844 }, hasTouch: true,
    isMobile: true, deviceScaleFactor: 0.5, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('./');
  await expect(page.locator('#status')).toBeHidden();
  await page.locator('#menu-button').tap();
  const observations = [];
  for (const viewport of [{ width: 360, height: 740 }, { width: 320, height: 568 },
    { width: 844, height: 390 }, { width: 568, height: 320 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await applyTextAndInsets(page);
    for (const [view, label] of [['sound', 'サウンド設定'], ['help', 'ヘルプ']]) {
      const card = page.locator(`[data-view="${view}"]`);
      await reachable(card);
      await card.tap();
      await expect(page.locator('#collection-title')).toHaveText(label);
      await reachable(page.locator('#collection-back'));
      await reachable(page.locator('#collection-close'));
      await page.locator('#collection-back').tap();
      await expect(page.locator(`[data-view="${view}"]`)).toBeFocused();
    }
    await noHorizontalOverflow(page);
    observations.push(await menuMetrics(page));
  }
  await info.attach('rotated-menu-layouts', { body: Buffer.from(JSON.stringify(observations, null, 2)), contentType: 'application/json' });
});

test('day, clear night and fog: restored production environments keep menu labels and hit areas readable', async ({ createContext }, info) => {
  // Existing lighting-save fixture seeds a validated ordinary save before boot;
  // its renderer observer verifies the real scene, without a production hook.
  const samples = [
    { label: 'day', seconds: 90, viewport: { width: 1280, height: 800 }, touch: false },
    { label: 'clear-night', seconds: 270, viewport: { width: 390, height: 844 }, touch: true },
    { label: 'fog-night', seconds: 3971 * 360 + 270, viewport: { width: 568, height: 320 }, touch: true },
  ];
  const observations = [];
  for (const sample of samples) {
    const context = await createContext({ viewport: sample.viewport, hasTouch: sample.touch,
      isMobile: sample.touch, deviceScaleFactor: 0.5, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await setupLighting(page, sample.seconds);
    const firstEnvironment = await page.evaluate(() => window.lightingProbe.first);
    assertEnvironment(firstEnvironment, sample.seconds);
    const environment = await readLighting(page);
    expect(environment.mistVisible).toBe(sample.label === 'fog-night');
    if (sample.label === 'day') expect(environment.sky).toBeGreaterThan(0.9);
    else expect(environment.sky).toBeLessThan(0.1);
    if (sample.label === 'fog-night') await applyTextAndInsets(page);
    await activate(page.locator('#menu-button'), sample.touch);
    await expect(page.locator('.menu-entry-title')).toHaveText(entries.map(([, label]) => label));
    const hits = [];
    for (const [view] of entries) {
      const card = page.locator(`[data-view="${view}"]`);
      hits.push(await reachable(card));
      await expect(card).toHaveCSS('color', 'rgb(244, 242, 230)');
      await expect(card).toHaveCSS('background-color', ['sound', 'help'].includes(view) ? 'rgb(48, 71, 77)' : 'rgb(33, 74, 64)');
    }
    await noHorizontalOverflow(page);
    await page.locator('.menu-entry').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`menu-${sample.label}.png`), scale: 'css' });
    observations.push({ label: sample.label, seconds: sample.seconds, firstEnvironment, environment,
      layout: await menuMetrics(page), hits });
    await activate(page.locator('#collection-close'), sample.touch);
    await expect(page.locator('#scene')).toBeFocused();
  }
  await info.attach('menu-environment-observations', { body: Buffer.from(JSON.stringify(observations, null, 2)), contentType: 'application/json' });
});

for (const touch of [false, true]) {
  test(`${touch ? 'touch' : 'mouse'} UI fixture: detail, confirmation and disappearing-row navigation preserve domain operations`, async ({ createContext }) => {
    const context = await createContext({ viewport: { width: 568, height: 320 }, hasTouch: touch, isMobile: touch });
    const page = await context.newPage();
    await openUIFixture(page);
    await applyTextAndInsets(page);
    // Setup uses the existing real-domain fixture, not a production state hook.
    await page.evaluate(async () => {
      const { FISH_SPECIES, calculateFishWeightKg } = await import('/barb/src/game/fish-species.js');
      for (const index of [8, 20, 35]) {
        const fish = FISH_SPECIES[index], lengthCm = fish.weight.referenceLengthCm;
        fixture.collection.register({ schemaVersion: 1, id: `navigation-discovery-${index}`, speciesId: fish.id,
          lengthCm, weightKg: calculateFishWeightKg(fish.id, lengthCm), caughtAt: '2026-01-01T00:00:00Z' });
      }
      for (const id of ['navigation-old', 'navigation-middle', 'navigation-new']) {
        fixture.collection.register({ schemaVersion: 1, id, speciesId: 'black-bass', lengthCm: 40,
          weightKg: 1, caughtAt: '2026-01-01T00:00:00Z' });
        fixture.collection.store(id);
      }
      fixture.fund(1000);
    });
    const click = locator => activate(locator, touch);
    await click(page.locator('#menu-button'));
    await click(page.locator('[data-view="encyclopedia"]'));
    const slot = page.locator('button.fish-card[data-slot="35"]');
    await slot.scrollIntoViewIfNeeded();
    const listTop = await page.locator('#collection-content').evaluate(element => element.scrollTop);
    expect(listTop).toBeGreaterThan(0);
    await click(slot);
    await expect(page.locator('.fish-detail')).toBeVisible();
    await click(page.locator('#collection-back'));
    await expect(slot).toBeFocused();
    await expect.poll(async () => Math.abs(await page.locator('#collection-content').evaluate(element => element.scrollTop) - listTop)).toBeLessThanOrEqual(1);
    await click(page.locator('#collection-back'));
    await click(page.locator('[data-view="equipment"]'));
    const reel = page.locator('[data-upgrade="reel"]');
    await reel.scrollIntoViewIfNeeded();
    const equipmentTop = await page.locator('#collection-content').evaluate(element => element.scrollTop);
    await click(reel);
    await expect(page.locator('#collection-title')).toHaveText('アップグレード確認');
    await click(page.locator('#cancel-upgrade'));
    await expect(reel).toBeFocused();
    await expect.poll(async () => Math.abs(await page.locator('#collection-content').evaluate(element => element.scrollTop) - equipmentTop)).toBeLessThanOrEqual(1);
    await expect(page.locator('#collection-wallet')).toHaveText('所持金 1,000 Value');
    await click(page.locator('#collection-back'));
    await click(page.locator('[data-view="storage"]'));
    await click(page.locator('[data-catch-id="navigation-middle"] .sell-stored'));
    await expect(page.locator('[data-catch-id="navigation-middle"]')).toHaveCount(0);
    await expect(page.locator('[data-catch-id="navigation-old"] .sell-stored')).toBeFocused();
    await click(page.locator('[data-catch-id="navigation-old"] .sell-stored'));
    await expect(page.locator('[data-catch-id="navigation-new"] .sell-stored')).toBeFocused();
    await click(page.locator('[data-catch-id="navigation-new"] .sell-stored'));
    await expect(page.locator('.stored-fish')).toHaveCount(0);
    await expect(page.locator('#collection-title')).toBeFocused();
    expect(await page.evaluate(() => fixture.collection.catches.length)).toBe(7);
    expect(await page.evaluate(() => fixture.collection.encyclopedia.reduce((sum, entry) => sum + entry.count, 0))).toBe(7);
    await noHorizontalOverflow(page);
  });
}

test('UI fixture: every save status retains full live text and short-landscape controls', async ({ createContext }, info) => {
  const context = await createContext({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await openUIFixture(page);
  await applyTextAndInsets(page);
  await page.evaluate(async () => {
    const { createSaveStatus } = await import('/barb/src/ui/save-status.js');
    window.navigationSaveStatus = createSaveStatus();
  });
  await page.locator('#menu-button').tap();
  const states = [
    [{ phase: 'saved' }, '保存済み', 'このブラウザに保存済みです。'],
    [{ phase: 'dirty' }, '未保存の変更あり', '未保存の変更があります。自動保存を待っています。'],
    [{ phase: 'failed', code: 'quota-exceeded' }, '保存失敗・進行は未保存', '保存容量が不足しています。今回の進行は保存できていません。以前の保存は保持し、再試行します。'],
    [{ phase: 'failed' }, '保存失敗・進行は未保存', '保存に失敗しました。今回の進行は保存できていません。以前の保存は保持し、再試行します。'],
    [{ phase: 'unavailable', canSave: true }, '保存不可・進行は未保存', '現在は保存機能を利用できません。今回の進行は未保存です。以前の保存を保持し、再試行します。'],
    [{ phase: 'unavailable', canSave: false }, '保存不可・進行は未保存', '保存機能を利用できません。今回の進行は保存されません。ブラウザの保存許可を確認して再読み込みしてください。'],
    [{ phase: 'protected' }, '破損・未対応／保存停止', '保存データが破損、未対応、または安全に復元できないため保護しています。今回の進行は保存されません。'],
    [{ phase: 'protected', code: 'generation-exhausted' }, '破損・未対応／保存停止', '保存世代の上限に達したため保存を停止しています。以後の進行は保存されません。既存の記録は保持しています。'],
    [{ phase: 'conflict' }, '他タブと競合・保存停止', '他のタブから保存が変更されました。上書きを防ぐため自動保存を停止しています。このタブの進行は未保存です。タブを閉じて再読み込みしてください。'],
    [{ phase: 'backup', restoredFromBackup: true }, 'バックアップから復元', 'バックアップの古い記録から復元しました。このブラウザに保存済みです。'],
    [{ phase: 'restored', restoredFromBackup: true }, 'バックアップから復元', 'バックアップの古い記録から復元しました。このブラウザに保存済みです。'],
  ];
  for (const [status, compact, explanation] of states) {
    await page.evaluate(value => navigationSaveStatus.update(value), status);
    await expect(page.locator('#save-status')).toHaveText(compact);
    await expect(page.locator('#collection-save-status')).toHaveText(explanation);
    await expect(page.locator('#catch-save-status')).toHaveText(explanation);
    await expect(page.locator('#collection-save-status')).toHaveAttribute('role', 'status');
    await expect(page.locator('#collection-save-status')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('#collection-save-status')).toHaveAttribute('data-phase', status.phase);
    await page.locator('#collection-save-status').scrollIntoViewIfNeeded();
    await expect(page.locator('#collection-save-status')).toBeInViewport();
    await noHorizontalOverflow(page);
    await reachable(page.locator('#collection-close'));
    await reachable(page.locator('[data-view="achievements"]'));
    await page.locator('[data-view="achievements"]').tap();
    await reachable(page.locator('#collection-back'));
    await page.locator('#collection-back').tap();
    await expect(page.locator('[data-view="achievements"]')).toBeFocused();
  }
  await page.locator('#collection-save-status').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('short-save-restored.png'), scale: 'css' });
  await info.attach('save-status-layout', { body: Buffer.from(JSON.stringify(await menuMetrics(page), null, 2)), contentType: 'application/json' });
});
