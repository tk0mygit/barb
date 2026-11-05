import { test, expect } from './diagnostics-fixture.js';
import { installPausedClock } from './clock-fixture.js';
import { openUIFixture } from './ui-fixture.js';
import { NORMAL_BUYER_DIALOGUE } from '../../src/game/buyer-lines.js';

async function installBuyerRandom(page, rolls = []) {
  await page.addInitScript(rolls => {
    window.buyerRandomRolls = rolls;
    window.buyerRandomCalls = 0;
    crypto.getRandomValues = array => {
      window.buyerRandomCalls++;
      array[0] = Math.floor((window.buyerRandomRolls.shift() ?? 0) * 2 ** 32);
      return array;
    };
  }, rolls);
}

async function assertNotices(page, visible) {
  for (const id of ['sale-notice', 'collection-sale-notice']) {
    expect(await page.locator(`#${id}`).evaluate(el => el.hidden)).toBe(!visible);
    if (!visible) await expect(page.locator(`#${id}`)).toHaveText('');
  }
}
test.describe('notification lifecycle', () => {
test.beforeEach(async ({ page }) => {
  await installPausedClock(page);
  await installBuyerRandom(page);
  await openUIFixture(page);
});

test('both notices expire at 5 seconds without animation frames or hiding the wallet', async ({ page }) => {
  await page.evaluate(() => fixture.fund(300, true));
  await assertNotices(page, true);
  await expect(page.locator('#sale-notice')).toContainText('1匹を売却 · +300 Value\n買取人「');
  await page.clock.fastForward(4999); await assertNotices(page, true);
  await page.clock.fastForward(1); await assertNotices(page, false);
  await expect(page.locator('#wallet-balance')).toHaveText('300 Value');
  await page.locator('#menu-button').click();
  await expect(page.locator('#collection-sale-notice')).toBeHidden();
  await expect(page.locator('#collection-wallet')).toHaveText('所持金 300 Value');
});

test('new sales restart the deadline, including while the menu is paused and reopened', async ({ page }) => {
  await page.evaluate(() => fixture.fund(300, true));
  await page.clock.fastForward(4000);
  await page.locator('#menu-button').click();
  await page.evaluate(() => fixture.fund(800, true));
  await expect(page.locator('#collection-sale-notice')).toContainText('+800 Value');
  await page.clock.fastForward(1000); await assertNotices(page, true);
  await page.locator('#collection-close').click();
  await page.clock.fastForward(3999); await assertNotices(page, true);
  await page.locator('#menu-button').click();
  await page.clock.fastForward(1); await assertNotices(page, false);
  await page.locator('#collection-close').click(); await page.locator('#menu-button').click();
  await assertNotices(page, false);
  await expect(page.locator('#collection-wallet')).toHaveText('所持金 1,100 Value');
});

test('restoration checks wall time even when the timeout has not run', async ({ page }) => {
  for (const event of ['visibilitychange', 'focus', 'pageshow', 'menu']) {
    await page.evaluate(() => fixture.fund(100, true));
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); });
    // Move only Date; emulate a background tab with a throttled timeout.
    await page.clock.setSystemTime(new Date(await page.evaluate(() => Date.now() + 6000)));
    await page.evaluate(event => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      if (event === 'menu') document.querySelector('#menu-button').click();
      else (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event));
    }, event);
    await assertNotices(page, false);
    if (event === 'menu') await page.locator('#collection-close').click();
  }
  await expect(page.locator('#wallet-balance')).toHaveText('400 Value');
});

test('hideNotice clears both displays and invalidates the old timer before another sale', async ({ page }) => {
  await page.evaluate(() => fixture.fund(100, true));
  await page.clock.fastForward(4000);
  await page.evaluate(() => fixture.salesHUD.hideNotice()); await assertNotices(page, false);
  await page.evaluate(() => fixture.fund(300, true));
  await page.clock.fastForward(1000); await assertNotices(page, true);
  await page.clock.fastForward(4000); await assertNotices(page, false);
  await expect(page.locator('#wallet-balance')).toHaveText('400 Value');
});

test('duplicate and failed receipts do not draw or extend the current notification', async ({ page }) => {
  await page.evaluate(() => { window.receipt = fixture.fund(100, true); });
  const first = await page.locator('#sale-notice').textContent();
  await page.clock.fastForward(4000);
  await page.evaluate(() => {
    fixture.salesHUD.notify(window.receipt);
    fixture.salesHUD.notify(fixture.collection.sellUnassigned(window.receipt.ids[0]));
  });
  expect(await page.evaluate(() => window.buyerRandomCalls)).toBe(2);
  await expect(page.locator('#sale-notice')).toHaveText(first);
  await page.clock.fastForward(1000); await assertNotices(page, false);
  await page.evaluate(() => fixture.fund(100, true));
  expect(await page.evaluate(() => window.buyerRandomCalls)).toBe(4);
  expect(await page.locator('#sale-notice').textContent()).not.toBe(first);
});
});

const longest = NORMAL_BUYER_DIALOGUE.flatMap(category => category.lines).reduce((a, b) => a.text.length > b.text.length ? a : b);
for (const profile of [
  { id: 'pc', width: 800, height: 600, touch: false },
  { id: 'portrait', width: 390, height: 844, touch: true },
  { id: 'landscape', width: 844, height: 390, touch: true },
]) {
  test(`longest approved line fits both notices and leaves native controls usable (${profile.id})`, async ({ createContext }, info) => {
    const context = await createContext({ viewport: { width: profile.width, height: profile.height }, hasTouch: profile.touch, isMobile: profile.touch });
    const page = await context.newPage();
    await installPausedClock(page);
    const categoryIndex = NORMAL_BUYER_DIALOGUE.findIndex(category => category.lines.includes(longest));
    const category = NORMAL_BUYER_DIALOGUE[categoryIndex];
    await installBuyerRandom(page, [categoryIndex ? 0.9 : 0, (category.lines.indexOf(longest) + 0.5) / category.lines.length]);
    await openUIFixture(page);
    await page.evaluate(() => fixture.fund(300, true));
    const message = `1匹を売却 · +300 Value\n買取人「${longest.text}」`;
    async function assertFit(id) {
      await expect(page.locator(`#${id}`)).toBeVisible();
      await expect(page.locator(`#${id}`)).toHaveText(message);
      const geometry = await page.locator(`#${id}`).evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom,
          horizontalOverflow: element.scrollWidth - element.clientWidth,
          verticalOverflow: element.scrollHeight - element.clientHeight };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0); expect(geometry.right).toBeLessThanOrEqual(profile.width);
      expect(geometry.top).toBeGreaterThanOrEqual(0); expect(geometry.bottom).toBeLessThanOrEqual(profile.height);
      expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1); expect(geometry.verticalOverflow).toBeLessThanOrEqual(1);
    }
    await assertFit('sale-notice');
    expect(await page.locator('#sale-notice').evaluate(element => {
      const bounds = element.getBoundingClientRect(), target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return getComputedStyle(element).pointerEvents === 'none' && !element.contains(target);
    })).toBe(true);
    const click = locator => profile.touch ? locator.tap() : locator.click();
    await click(page.locator('#menu-button')); await assertFit('collection-sale-notice');
    for (const id of ['collection-close', 'collection-back']) {
      if (await page.locator(`#${id}`).isHidden()) continue;
      expect(await page.locator(`#${id}`).evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.closest('button')?.id;
      })).toBe(id);
    }
    await click(page.locator('[data-view="storage"]'));
    await expect(page.locator('#sell-all')).toBeVisible(); await expect(page.locator('#sell-all')).toBeDisabled();
    await assertFit('collection-sale-notice');
    await page.screenshot({ path: info.outputPath('longest-buyer-line.png') });
    await click(page.locator('#collection-close')); await expect(page.locator('#collection-dialog')).toBeHidden();
    await page.clock.fastForward(5000); await assertNotices(page, false);
  });
}
