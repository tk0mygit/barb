import { test, expect } from './diagnostics-fixture.js';
import { installPausedClock } from './clock-fixture.js';
import { openUIFixture } from './ui-fixture.js';

async function assertNotices(page, visible) {
  for (const id of ['sale-notice', 'collection-sale-notice']) {
    expect(await page.locator(`#${id}`).evaluate(el => el.hidden)).toBe(!visible);
    if (!visible) await expect(page.locator(`#${id}`)).toHaveText('');
  }
}
test.beforeEach(async ({ page }) => {
  await installPausedClock(page);
  await openUIFixture(page);
});

test('both notices expire at 5 seconds without animation frames or hiding the wallet', async ({ page }) => {
  await page.evaluate(() => fixture.fund(300, true));
  await assertNotices(page, true);
  await expect(page.locator('#sale-notice')).toContainText('1匹を売却 · +300 通貨\n買取人「');
  await page.clock.fastForward(4999); await assertNotices(page, true);
  await page.clock.fastForward(1); await assertNotices(page, false);
  await expect(page.locator('#wallet-balance')).toHaveText('300 通貨');
  await page.locator('#menu-button').click();
  await expect(page.locator('#collection-sale-notice')).toBeHidden();
  await expect(page.locator('#collection-wallet')).toHaveText('所持金 300 通貨');
});

test('new sales restart the deadline, including while the menu is paused and reopened', async ({ page }) => {
  await page.evaluate(() => fixture.fund(300, true));
  await page.clock.fastForward(4000);
  await page.locator('#menu-button').click();
  await page.evaluate(() => fixture.fund(800, true));
  await expect(page.locator('#collection-sale-notice')).toContainText('+800 通貨');
  await page.clock.fastForward(1000); await assertNotices(page, true);
  await page.locator('#collection-close').click();
  await page.clock.fastForward(3999); await assertNotices(page, true);
  await page.locator('#menu-button').click();
  await page.clock.fastForward(1); await assertNotices(page, false);
  await page.locator('#collection-close').click(); await page.locator('#menu-button').click();
  await assertNotices(page, false);
  await expect(page.locator('#collection-wallet')).toHaveText('所持金 1,100 通貨');
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
  await expect(page.locator('#wallet-balance')).toHaveText('400 通貨');
});

test('hideNotice clears both displays and invalidates the old timer before another sale', async ({ page }) => {
  await page.evaluate(() => fixture.fund(100, true));
  await page.clock.fastForward(4000);
  await page.evaluate(() => fixture.salesHUD.hideNotice()); await assertNotices(page, false);
  await page.evaluate(() => fixture.fund(300, true));
  await page.clock.fastForward(1000); await assertNotices(page, true);
  await page.clock.fastForward(4000); await assertNotices(page, false);
  await expect(page.locator('#wallet-balance')).toHaveText('400 通貨');
});
