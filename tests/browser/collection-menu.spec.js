import { test, expect } from '@playwright/test';
import { FISH_SPECIES } from '../../src/game/fish-species.js';

for (const touch of [false, true]) {
  test(`${touch ? 'touch' : 'mouse'}: undiscovered grid, empty storage, pause and safe input resume`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1000, height: 700 }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 0.5 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { Math.random = () => 0.5; });
    await page.goto('./'); await expect(page.locator('#status')).toBeHidden();
    const click = locator => touch ? locator.tap({ force: true }) : locator.click({ force: true });
    await click(page.locator('#menu-button'));
    await expect(page.locator('#collection-dialog')).toBeVisible();
    await expect(page.locator('#collection-notice')).toContainText('再読み込みで失われます');
    await click(page.locator('[data-view="encyclopedia"]'));
    const cards = page.locator('.fish-card');
    await expect(cards).toHaveCount(12);
    expect(await cards.locator('span').allTextContents()).toEqual(Array(12).fill('？？？'));
    expect(await cards.evaluateAll(nodes => nodes.map(node => Number(node.dataset.slot)))).toEqual(FISH_SPECIES.map((_, index) => index));
    await expect(page.locator('.fish-card button, button.fish-card')).toHaveCount(0);
    const content = await page.locator('#collection-content').innerHTML();
    for (const fish of FISH_SPECIES) {
      expect(content).not.toContain(fish.name); expect(content).not.toContain(fish.description);
    }
    expect(new Set(await cards.locator('img').evaluateAll(nodes => nodes.map(node => node.src))).size).toBe(1);
    await page.screenshot({ path: `test-results/encyclopedia-unknown-${touch ? 'touch' : 'mouse'}.png` });
    await click(page.locator('#collection-back')); await click(page.locator('[data-view="storage"]'));
    await expect(page.locator('.collection-empty')).toBeVisible(); await expect(page.locator('.stored-fish')).toHaveCount(0);
    if (touch) {
      await page.setViewportSize({ width: 844, height: 390 });
      for (const id of ['collection-close', 'collection-back']) {
        const box = await page.locator(`#${id}`).boundingBox();
        expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(390);
      }
      await page.screenshot({ path: 'test-results/collection-landscape.png' });
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await click(page.locator('#collection-close'));
    await expect(page.locator('#collection-dialog')).toBeHidden();
    await click(page.locator('#fish-button'));
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    const tick = () => page.clock.fastForward(250);
    const phase = page.locator('#fishing-panel');
    // Opening from aim cancels preparation, so no stale release casts on resume.
    await click(page.locator('#cast-button')); await tick();
    await expect(phase).toHaveAttribute('data-phase', 'aim');
    await click(page.locator('#menu-button'));
    await click(page.locator('#collection-close')); await tick();
    await expect(phase).toHaveAttribute('data-phase', 'ready');

    await click(page.locator('#cast-button')); await tick();
    const cdp = await context.newCDPSession(page);
    const x = touch ? 300 : 500, y = touch ? 420 : 350;
    const down = async () => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }) : (await page.mouse.move(x, y), page.mouse.down());
    const up = () => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) : page.mouse.up();
    await down();
    if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 150 }] });
    else await page.mouse.move(x, y - 150);
    await up(); for (let i = 0; i < 4; i++) await tick();
    await expect(phase).toHaveAttribute('data-phase', 'lure');
    await down(); await tick(); await tick();
    await expect(page.locator('#reel-state')).toHaveText('巻き取り中');
    // Canvas capture/keys are released when the menu opens, including a hold.
    await page.locator('#menu-button').evaluate(button => button.click());
    await up();
    const before = await page.locator('#fishing-conditions').getAttribute('data-cycle-progress');
    const distance = await page.locator('#line-distance').textContent();
    await page.locator('#scene').evaluate(canvas => {
      canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 99, pointerType: 'mouse', button: 0 }));
    });
    await page.clock.fastForward(60000);
    await expect(phase).toHaveAttribute('data-phase', 'lure');
    await expect(page.locator('#line-distance')).toHaveText(distance);
    await expect(page.locator('#fishing-conditions')).toHaveAttribute('data-cycle-progress', before);
    if (touch) await click(page.locator('#collection-close')); else await page.keyboard.press('Escape');
    await tick();
    await expect(phase).toHaveAttribute('data-phase', 'lure');
    await expect(page.locator('#reel-state')).toHaveText('待機中');
    await expect(page.locator('#line-distance')).toHaveText(distance);
    const after = Number(await page.locator('#fishing-conditions').getAttribute('data-cycle-progress'));
    expect(after - Number(before)).toBeCloseTo(0.25 / 360, 4);
    // Pause the one-second hook window too, then safely resume into a fight.
    for (let i = 0; i < 60 && await phase.getAttribute('data-phase') === 'lure'; i++) await tick();
    await expect(phase).toHaveAttribute('data-phase', 'bite');
    await click(page.locator('#menu-button')); await page.clock.fastForward(60000);
    await click(page.locator('#collection-close')); await down(); await up(); await tick();
    await expect(phase).toHaveAttribute('data-phase', 'fight');
    await down(); await tick(); await tick();
    await page.locator('#menu-button').evaluate(button => button.click()); await up();
    const tension = await page.locator('#line-tension').evaluate(el => el.value);
    await page.clock.fastForward(60000);
    expect(await page.locator('#line-tension').evaluate(el => el.value)).toBe(tension);
    await click(page.locator('#collection-close')); await tick();
    expect(Number(await page.locator('#line-tension').evaluate(el => el.value))).toBeLessThan(Number(tension));
    expect(errors).toEqual([]); await context.close();
  });
}

test('menu freezes a moving boat and releases held steering before resume', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto('./'); await expect(page.locator('#status')).toBeHidden();
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  const tick = () => page.clock.fastForward(250);
  await page.locator('#scene').focus(); await page.keyboard.down('KeyW'); await page.keyboard.down('KeyD');
  for (let i = 0; i < 8; i++) await tick();
  const speed = await page.locator('#speed').textContent();
  expect(Number(speed)).toBeGreaterThan(0);
  const heading = await page.locator('#compass-needle').getAttribute('style');
  await page.locator('#menu-button').evaluate(button => button.click());
  await page.clock.fastForward(60000);
  await expect(page.locator('#speed')).toHaveText(speed);
  await expect(page.locator('#compass-needle')).toHaveAttribute('style', heading);
  await page.locator('#collection-close').click({ force: true });
  for (let i = 0; i < 12; i++) await tick();
  await expect(page.locator('#motion-label')).toHaveText('停船中');
  await expect(page.locator('#compass-needle')).toHaveAttribute('style', heading);
  await page.keyboard.up('KeyW'); await page.keyboard.up('KeyD');
});
