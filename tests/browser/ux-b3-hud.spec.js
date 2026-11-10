import { test, expect } from './diagnostics-fixture.js';
import { installPausedClock } from './clock-fixture.js';
import { openUIFixture } from './ui-fixture.js';
import { NORMAL_BUYER_DIALOGUE } from '../../src/game/buyer-lines.js';
import { NORMAL_ACHIEVEMENTS } from '../../src/game/achievements.js';

const longestBuyer = NORMAL_BUYER_DIALOGUE.flatMap(category => category.lines)
  .reduce((a, b) => a.text.length > b.text.length ? a : b);
const longestAward = NORMAL_ACHIEVEMENTS.reduce((a, b) => a.name.length > b.name.length ? a : b);
const separated = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
const profiles = [
  { id: 'portrait', width: 390, height: 844 },
  { id: 'short', width: 568, height: 320 },
  { id: 'short20', width: 568, height: 320, computed20: true },
];

async function readNoticeLayout(page) {
  return page.evaluate(() => {
    const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
    const rect = e => ({ id: e.id || e.className, ...e.getBoundingClientRect().toJSON() });
    const notices = [...document.querySelectorAll('#spot-status, #sale-notice, #achievement-notice')].filter(visible)
      .map(e => ({ ...rect(e), text: e.textContent, scrollWidth: e.scrollWidth, clientWidth: e.clientWidth,
        scrollHeight: e.scrollHeight, clientHeight: e.clientHeight, pointerEvents: getComputedStyle(e).pointerEvents }));
    const paint = [...document.querySelectorAll('.wordmark, .header-tools, #fishing-state, #fishing-conditions, #fishing-note, #hint')]
      .filter(visible).map(rect);
    const buttons = [...document.querySelectorAll('#menu-button, .bottom-bar button')].filter(visible).map(e => {
      const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { ...rect(e), lureId: e.dataset.lureId, hit: hit === e || e.contains(hit) };
    });
    return { width: innerWidth, height: innerHeight, notices, paint, buttons };
  });
}

for (const profile of profiles) for (const warning of [false, true]) {
  test(`UX-B3 UI ${profile.id}: point/sale/long award${warning ? ', saved warning and recovery note' : ''} preserve text, targets and deadlines`, async ({ createContext }, info) => {
    const context = await createContext({ viewport: { width: profile.width, height: profile.height },
      hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
    const page = await context.newPage(); await installPausedClock(page);
    const categoryIndex = NORMAL_BUYER_DIALOGUE.findIndex(category => category.lines.includes(longestBuyer));
    const lines = NORMAL_BUYER_DIALOGUE[categoryIndex].lines;
    await page.addInitScript(rolls => {
      crypto.getRandomValues = a => { a[0] = Math.floor((rolls.shift() ?? 0) * 2 ** 32); return a; };
    }, [categoryIndex ? .9 : 0, (lines.indexOf(longestBuyer) + .5) / lines.length]);
    await openUIFixture(page);
    await page.evaluate(async ({ computed20, warning, award }) => {
      const { createHUD } = await import('./src/ui/hud.js');
      const { createFishingSpotsHUD } = await import('./src/ui/fishing-spots-hud.js');
      const { getFishingSpotStatus } = await import('./src/game/fishing-spots.js');
      const { createCastNotices } = await import('./src/ui/cast-notices.js');
      const { createSaveStatus } = await import('./src/ui/save-status.js');
      if (innerHeight <= 420) for (const [edge, v] of Object.entries({ top: 8, bottom: 8, left: 12, right: 12 })) {
        document.documentElement.style.setProperty(`--safe-${edge}`, `${v}px`);
      }
      if (computed20) {
        document.documentElement.style.fontSize = '20px';
        for (const e of document.querySelectorAll('#fishing-panel p, #fight-gauge label, #tension-value, #hint, #fishing-note, .action-panel button, #spot-name, #spot-effect, #sale-notice')) {
          e.style.setProperty('font-size', '20px', 'important');
        }
      }
      fixture.baseHUD = createHUD({ onFish() {}, onReturn() {} });
      fixture.baseHUD.update({ mode: 'fishing', speed: 0, heading: 0 });
      if (warning) {
        // Exercise the existing view-change message through legal domain APIs.
        fixture.fishing.prepare({ x: 0, z: -55 }, 0);
        fixture.fishing.cast(); fixture.fishing.cancelForViewChange();
        createSaveStatus().update({ phase: 'failed', code: 'quota-exceeded', restoredFromBackup: true, canSave: true });
      }
      fixture.fishingHUD.update(fixture.fishing, true, { timeOfDay: 'day', cycleProgress: .25 });
      createFishingSpotsHUD().update(getFishingSpotStatus({ x: 0, z: -55 }));
      fixture.achievementNotice.notify([award]);
      fixture.fund(300, true);
      fixture.castNotices = createCastNotices();
      window.uxB3LayoutFits = fixture.castNotices.update(null, false);
    }, { computed20: profile.computed20, warning, award: longestAward });
    const layout = await readNoticeLayout(page);
    await info.attach('actual-notice-layout', { body: JSON.stringify(layout, null, 2), contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath('notices.png') });
    expect(await page.evaluate(() => window.uxB3LayoutFits), JSON.stringify(layout)).toBe(true);
    expect(layout.notices).toHaveLength(3);
    for (const [i, notice] of layout.notices.entries()) {
      expect(notice.left).toBeGreaterThanOrEqual(profile.height <= 420 ? 24 : 12);
      expect(notice.right).toBeLessThanOrEqual(profile.width - (profile.height <= 420 ? 24 : 12));
      expect(notice.top).toBeGreaterThanOrEqual(profile.height <= 420 ? 20 : 12);
      expect(notice.bottom).toBeLessThanOrEqual(profile.height - (profile.height <= 420 ? 20 : 12));
      expect(notice.scrollWidth).toBeLessThanOrEqual(notice.clientWidth);
      expect(notice.scrollHeight).toBeLessThanOrEqual(notice.clientHeight);
      expect(notice.pointerEvents).toBe('none');
      for (const other of layout.notices.slice(0, i)) expect(separated(notice, other), `${notice.id}/${other.id}`).toBe(true);
      for (const obstacle of [...layout.paint, ...layout.buttons]) expect(separated(notice, obstacle), `${notice.id}/${obstacle.id}`).toBe(true);
    }
    for (const button of layout.buttons) {
      expect(button.width).toBeGreaterThanOrEqual(44); expect(button.height).toBeGreaterThanOrEqual(44); expect(button.hit).toBe(true);
    }
    await expect(page.locator('#sale-notice')).toHaveText(`1匹を売却 · +300 Value\n買取人「${longestBuyer.text}」`);
    await expect(page.locator('#achievement-notice strong')).toHaveText(longestAward.name);
    if (warning) {
      await expect(page.locator('#fishing-note')).toHaveText('外界の変更を検知したためルアーを回収した。');
      await expect(page.locator('#save-status')).toContainText('保存失敗・進行は未保存');
    }
    for (const id of ['minnow', 'crankbait', 'worm', 'spinnerbait']) {
      await page.locator(`[data-lure-id="${id}"]`).tap();
      // The UI fixture has no application rAF. Render the domain selection
      // made by the native tap, without changing that selection or any input.
      await page.evaluate(() => fixture.fishingHUD.update(fixture.fishing, true, { timeOfDay: 'day', cycleProgress: .25 }));
      await expect(page.locator(`[data-lure-id="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
    }
    await page.locator('#menu-button').tap(); await page.locator('#collection-close').tap();
    await page.clock.fastForward(4999); await expect(page.locator('#sale-notice')).toBeVisible();
    await page.clock.fastForward(1); await expect(page.locator('#sale-notice')).toBeHidden();
    // Queued first-catch award gets its own unchanged visible turn.
    await expect(page.locator('#achievement-notice strong')).toHaveText('始まり');
  });
}
