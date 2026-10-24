import { test, expect } from './diagnostics-fixture.js';
import { activateButton } from './input-fixture.js';

// Lower only the WebGL backbuffer cost; CSS coordinates and real input timing
// stay unchanged. Image quality is covered by the existing rendering specs.
test.use({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 0.5 });

test('PC smoke: boot, mouse sailing, stop and fishing view', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('./');
  await expect(page.locator('#scene')).toBeVisible();
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#motion-label')).toHaveText('停船中');
  await expect(page.getByRole('button', { name: '釣りをする' })).toBeEnabled();

  await page.mouse.move(650, 400);
  await page.mouse.down();
  await page.mouse.move(650, 280, { steps: 6 });
  await expect(page.locator('#joystick')).toBeVisible();
  await expect(page.locator('#motion-label')).toHaveText('航行中');
  await expect.poll(async () => Number(await page.locator('#speed').textContent())).toBeGreaterThan(0);
  await expect(page.locator('#fish-button')).toBeHidden();

  await page.mouse.up();
  await expect(page.locator('#joystick')).toBeHidden();
  await expect(page.locator('#motion-label')).toHaveText('停船中');
  await expect(page.locator('#speed')).toHaveText('0.0');
  await activateButton(page.getByRole('button', { name: '釣りをする' }));
  await expect(page.locator('#motion-label')).toHaveText('釣り視点');
  await expect(page.locator('#reticle')).toBeVisible();
  await expect(page.getByRole('button', { name: '操船に戻る' })).toBeEnabled();
  await expect(page.locator('#error')).toBeHidden();
  expect(errors).toEqual([]);
});
