import { test, expect } from '@playwright/test';
import { installPausedClock } from './clock-fixture.js';

test('active clock crosses day/night boundaries, pauses with visibility/focus, and lure depth changes on retrieval', async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 800, height: 600 });
  await page.addInitScript(() => { Math.random = () => 0.5; });
  // Freeze the clock before startup; shader compilation may take longer than
  // one real second, so installing/pauseAt after navigation can target the past.
  const now = new Date('2026-01-01T00:00:00Z');
  await installPausedClock(page, now);
  await page.goto('./'); await page.clock.fastForward(250);
  await expect(page.locator('#status')).toBeHidden();
  await page.locator('#fish-button').click(); await page.clock.fastForward(250);
  const display = page.locator('#fishing-conditions');
  await expect(display).toHaveAttribute('data-time-of-day', 'day');
  const tick = () => page.clock.fastForward(250);
  const progress = async () => Number(await display.getAttribute('data-cycle-progress'));
  await page.clock.fastForward(Math.floor((0.5 - await progress()) * 360000) - 100);
  await expect(display).toHaveAttribute('data-time-of-day', 'day');
  await tick(); await expect(display).toHaveAttribute('data-time-of-day', 'night');

  for (const reason of ['blur', 'hidden']) {
    const before = await progress();
    await page.evaluate(reason => {
      if (reason === 'blur') window.dispatchEvent(new Event('blur'));
      else {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      }
    }, reason);
    await page.clock.fastForward(600000);
    expect(await progress()).toBe(before);
    await page.evaluate(reason => {
      if (reason === 'blur') window.dispatchEvent(new Event('focus'));
      else { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }
    }, reason);
    await tick();
    expect(await progress() - before).toBeCloseTo(0.25 / 360, 4);
  }
  await page.clock.fastForward(Math.floor((1 - await progress()) * 360000) - 100);
  await expect(display).toHaveAttribute('data-time-of-day', 'night');
  await tick(); await expect(display).toHaveAttribute('data-time-of-day', 'day');

  // Sail north with actual mouse input. No boat or fishing state is injected.
  await page.locator('#return-button').click({ force: true }); await tick();
  await page.mouse.move(500, 350); await page.mouse.down(); await page.mouse.move(500, 270);
  for (let frame = 0; frame < 60; frame++) await tick();
  await page.mouse.up(); for (let frame = 0; frame < 10; frame++) await tick();
  await expect(page.locator('#motion-label')).toHaveText('停船中');
  await page.locator('#fish-button').click({ force: true }); await tick();
  await page.locator('#cast-button').click({ force: true }); await tick();
  await page.mouse.move(500, 350); await page.mouse.down(); await page.mouse.move(500, 170); await page.mouse.up();
  for (let frame = 0; frame < 4; frame++) await tick();
  await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'lure');
  const initialDepth = Number(await display.getAttribute('data-depth-m'));
  expect(initialDepth).toBeGreaterThan(0); expect(initialDepth).toBeLessThan(8);
  await page.mouse.move(500, 350); await page.mouse.down();
  for (let frame = 0; frame < 12; frame++) await tick();
  await page.mouse.up(); await tick();
  expect(Number(await display.getAttribute('data-depth-m'))).toBeGreaterThan(initialDepth);
  await page.screenshot({ path: 'test-results/depth-after-retrieval.png', animations: 'disabled' });
});
