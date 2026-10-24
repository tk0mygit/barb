import { test, expect } from '@playwright/test';
import { installPausedClock } from './clock-fixture.js';
import { openUIFixture } from './ui-fixture.js';

const layouts = [
  { name: 'PC', viewport: { width: 1000, height: 700 }, touch: false },
  { name: 'short portrait', viewport: { width: 320, height: 568 }, touch: true },
  { name: 'landscape', viewport: { width: 568, height: 320 }, touch: true },
];

for (const { name, viewport, touch } of layouts) {
  test(`${name}: hidden notice has no box; one award passes input and expires at 3.5 seconds`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
    const page = await context.newPage();
    await installPausedClock(page);
    await openUIFixture(page);
    const notice = page.locator('#achievement-notice');
    async function expectNoBox() {
      await expect(notice).toBeHidden();
      expect(await notice.evaluate(el => ({ hidden: el.hidden, display: getComputedStyle(el).display,
        rects: el.getClientRects().length, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height,
        text: el.textContent }))).toEqual({ hidden: true, display: 'none', rects: 0, width: 0, height: 0, text: '' });
    }
    await expectNoBox();
    await page.evaluate(() => {
      window.canvasPresses = 0;
      document.querySelector('#scene').addEventListener('pointerdown', () => window.canvasPresses++);
      fixture.fund(300);
    });
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText('実績解除初めての一匹');
    await expect(notice).toHaveCSS('pointer-events', 'none');
    if (name === 'short portrait') await expect(notice).toHaveCSS('display', 'flex');
    const box = await notice.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).id, { x, y })).toBe('scene');
    if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
    expect(await page.evaluate(() => window.canvasPresses)).toBe(1);
    await page.clock.fastForward(3499); await expect(notice).toBeVisible();
    await page.clock.fastForward(1); await expectNoBox();
    // A hidden notice stays boxless after both directions of modal reparenting.
    const click = locator => touch ? locator.tap() : locator.click();
    await click(page.locator('#menu-button')); await expect(page.locator('#collection-dialog')).toBeVisible();
    expect(await notice.evaluate(el => el.parentElement.id)).toBe('collection-dialog');
    await expectNoBox();
    await click(page.locator('#collection-close')); await expect(page.locator('#collection-dialog')).toBeHidden();
    expect(await notice.evaluate(el => el.parentElement.id)).toBe('app'); await expectNoBox();
    await context.close();
  });

  test(`${name}: notice host is settled before modal buttons can be targeted`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
    const page = await context.newPage();
    await installPausedClock(page);
    await openUIFixture(page);
    await page.evaluate(() => fixture.fund(300, true));
    // Also cover the catch modal: showModal()/close() must return with the
    // notice already in its final host, without waiting for a queued toggle.
    expect(await page.evaluate(() => {
      const dialog = document.querySelector('#catch-dialog'), notice = document.querySelector('#achievement-notice');
      dialog.showModal(); const opened = notice.parentElement.id;
      dialog.close(); return { opened, closed: notice.parentElement.id };
    })).toEqual({ opened: 'catch-dialog', closed: 'app' });
    const positions = await page.evaluate(() => new Promise(resolve => {
      const dialog = document.querySelector('#collection-dialog');
      const snapshot = () => {
        const button = document.querySelector('[data-view="storage"]'), rect = button.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          host: document.querySelector('#achievement-notice').parentElement.id };
      };
      let opened;
      dialog.addEventListener('toggle', () => resolve({ opened, settled: snapshot() }), { once: true });
      // Capture the same coordinate window a fast input driver can observe:
      // the opening handler returned, but the queued toggle has not run yet.
      document.querySelector('#menu-button').click();
      document.querySelector('[data-view="storage"]').scrollIntoView({ block: 'nearest' });
      opened = snapshot();
    }));
    expect(positions.opened.host).toBe('collection-dialog');
    expect(positions.settled).toEqual(positions.opened);
    const { x, y, width, height } = positions.opened;
    if (touch) await page.touchscreen.tap(x + width / 2, y + height / 2);
    else await page.mouse.click(x + width / 2, y + height / 2);
    await expect(page.locator('#collection-title')).toHaveText('保管魚');
    await expect(page.locator('#sell-all')).toBeDisabled();
    await expect(page.locator('.stored-fish')).toHaveCount(0);
    await expect(page.locator('#achievement-notice')).toContainText('初めての一匹');
    expect(await page.evaluate(() => fixture.achievements.unlockedCount)).toBe(1);
    await context.close();
  });
}
