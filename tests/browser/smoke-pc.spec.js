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
  await Promise.all([
    expect(page.locator('#scene')).toBeVisible(),
    expect(page.locator('#status')).toBeHidden(),
    expect(page.locator('#error')).toBeHidden(),
    expect(page.locator('#motion-label')).toHaveText('停船中'),
    expect(page.locator('#hint')).toBeHidden(),
    expect(page.locator('#hint')).toHaveText(''),
    expect(page.getByRole('button', { name: '釣りをする' })).toBeEnabled(),
  ]);

  await page.mouse.move(650, 400);
  await page.mouse.down();
  await page.mouse.move(650, 280, { steps: 6 });
  await Promise.all([
    expect(page.locator('#joystick')).toBeVisible(),
    expect(page.locator('#motion-label')).toHaveText('航行中'),
    expect.poll(async () => Number(await page.locator('#speed').textContent())).toBeGreaterThan(0),
    expect(page.locator('#fish-button')).toBeHidden(),
  ]);

  await page.mouse.up();
  await Promise.all([
    expect(page.locator('#joystick')).toBeHidden(),
    expect(page.locator('#motion-label')).toHaveText('停船中'),
    expect(page.locator('#speed')).toHaveText('0.0'),
  ]);
  await activateButton(page.getByRole('button', { name: '釣りをする' }));
  await Promise.all([
    expect(page.locator('#motion-label')).toHaveText('釣り視点'),
    expect(page.locator('#fishing-state')).toHaveText('キャスト前'),
    expect(page.locator('#hint')).toBeHidden(),
    expect(page.locator('#reticle')).toBeVisible(),
    expect(page.getByRole('button', { name: '操船に戻る' })).toBeEnabled(),
    expect(page.locator('#error')).toBeHidden(),
  ]);
  expect(errors).toEqual([]);
});
