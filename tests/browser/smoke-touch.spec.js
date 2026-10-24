import { test, expect } from './diagnostics-fixture.js';
import { activateButton } from './input-fixture.js';

test('Touch smoke: boot, sailing end/cancel and primary UI taps', async ({ createContext }) => {
  const context = await createContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 0.5,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('./');
  await expect(page.locator('#scene')).toBeVisible();
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.getByRole('button', { name: '釣りをする' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const cdp = await context.newCDPSession(page);
  for (const release of ['touchEnd', 'touchCancel']) {
    await test.step(`sail and release with ${release}`, async () => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 220, y: 510 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 245, y: 410 }] });
      await expect(page.locator('#joystick')).toBeVisible();
      await expect(page.locator('#motion-label')).toHaveText('航行中');
      await expect.poll(async () => Number(await page.locator('#speed').textContent())).toBeGreaterThan(0);
      await expect(page.locator('#fish-button')).toBeHidden();
      await cdp.send('Input.dispatchTouchEvent', { type: release, touchPoints: [] });
      await expect(page.locator('#joystick')).toBeHidden();
      await expect(page.locator('#motion-label')).toHaveText('停船中');
      await expect(page.locator('#speed')).toHaveText('0.0');
    });
  }

  await activateButton(page.getByRole('button', { name: '釣りをする' }), true);
  await expect(page.locator('#motion-label')).toHaveText('釣り視点');
  await expect(page.locator('#reticle')).toBeVisible();
  await activateButton(page.getByRole('button', { name: '操船に戻る' }), true);
  await expect(page.locator('#motion-label')).toHaveText('停船中');
  await activateButton(page.locator('#menu-button'), true);
  await expect(page.locator('#collection-dialog')).toBeVisible();
  await activateButton(page.locator('#collection-close'), true);
  await expect(page.locator('#collection-dialog')).toBeHidden();
  await expect(page.locator('#error')).toBeHidden();
  expect(errors).toEqual([]);
});
