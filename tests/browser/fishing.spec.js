import { test, expect } from '@playwright/test';

// Keep software WebGL responsive while retaining CSS viewport/touch behavior.
test.use({ deviceScaleFactor: 0.5 });

// Fixed RNG, real production build and real elapsed time. No state-forcing hooks.
async function setup(page) {
  await page.addInitScript(() => { Math.random = () => 0.5; });
  await page.goto('./');
  await expect(page.locator('#status')).toBeHidden();
}
const phase = page => page.locator('#fishing-panel');
async function inputFor(page, touch) {
  const cdp = await page.context().newCDPSession(page);
  const touchEvent = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y }] });
  return {
    down: async (x = 300, y = 420) => touch ? touchEvent('touchStart', x, y) : (await page.mouse.move(x, y), page.mouse.down()),
    move: async (x, y) => touch ? touchEvent('touchMove', x, y) : page.mouse.move(x, y),
    tap: async () => {
      const timestamp = Date.now() / 1000;
      if (touch) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 420 }], timestamp });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: timestamp + 0.03 });
      } else {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 300, y: 420, button: 'left', buttons: 1, clickCount: 1, timestamp });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 300, y: 420, button: 'left', buttons: 0, clickCount: 1, timestamp: timestamp + 0.03 });
      }
    },
    flick: async () => {
      const timestamp = Date.now() / 1000;
      if (touch) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 420 }], timestamp });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 340, y: 420 }], timestamp: timestamp + 0.04 });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: timestamp + 0.08 });
      } else {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 300, y: 420, button: 'left', buttons: 1, clickCount: 1, timestamp });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 340, y: 420, button: 'left', buttons: 1, timestamp: timestamp + 0.04 });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 340, y: 420, button: 'left', buttons: 0, clickCount: 1, timestamp: timestamp + 0.08 });
      }
    },
    up: async () => touch ? touchEvent('touchEnd') : page.mouse.up(),
    cancel: async () => touch ? touchEvent('touchCancel') : page.locator('#scene').evaluate(el => el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }))),
    click: async locator => touch ? locator.tap() : locator.click(),
  };
}
async function cast(page, input) {
  await input.click(page.locator('#cast-button'));
  await expect(phase(page)).toHaveAttribute('data-phase', 'aim');
  await input.down(); await input.move(300, 270);
  await expect(page.locator('#line-distance')).toContainText('着水予測 28.0 m');
  await input.up();
  await expect(phase(page)).toHaveAttribute('data-phase', 'lure');
}
async function hook(page, input) {
  // Poll faster than the one-second hook window.
  await expect.poll(() => phase(page).getAttribute('data-phase'), { intervals: [50], timeout: 25000 }).toBe('bite');
  await input.tap();
  await expect(phase(page)).toHaveAttribute('data-phase', 'fight');
}
async function land(page, input) {
  let held = false;
  for (let i = 0; i < 90; i++) {
    const snapshot = await page.evaluate(() => ({ phase: document.querySelector('#fishing-panel').dataset.phase, tension: document.querySelector('#line-tension').value }));
    if (snapshot.phase !== 'fight') {
      if (snapshot.phase === 'landing') await page.screenshot({ path: `test-results/landing-${page.viewportSize().width}.png` });
      break;
    }
    const tension = snapshot.tension;
    if (!held && tension < 0.3) { await input.down(); held = true; }
    else if (held && tension > 0.58) { await input.up(); held = false; }
    await page.waitForTimeout(100);
  }
  if (held) await input.up();
  await expect(page.locator('#catch-dialog')).toBeVisible();
  await expect(page.locator('#catch-species')).toHaveText('ブラックバス');
  await expect(page.locator('#catch-length')).toHaveText('40.0 cm');
  await expect(page.locator('#catch-weight')).toHaveText('1.10 kg');
  expect(await page.locator('#catch-image').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
}

for (const touch of [false, true]) {
  test(`${touch ? 'touch' : 'mouse'}: cancellation, missed hook, retry, flick, fight and catch result`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 0.5 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await setup(page);
    const input = await inputFor(page, touch);
    await input.click(page.locator('#fish-button'));
    await page.waitForTimeout(1000);
    await input.click(page.locator('#cast-button'));
    await input.down(); await input.move(300, 300); await input.cancel();
    if (!touch) await page.mouse.up();
    await expect(phase(page)).toHaveAttribute('data-phase', 'ready');
    await cast(page, input);
    await expect(page.locator('#return-button')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(phase(page)).toHaveAttribute('data-phase', 'lure');
    await input.down(); await page.waitForTimeout(400);
    await expect(page.locator('#reel-state')).toHaveText('巻き取り中');
    await input.cancel(); if (!touch) await page.mouse.up();
    await expect(page.locator('#reel-state')).toHaveText('待機中');
    await expect(phase(page)).toHaveAttribute('data-phase', 'failed', { timeout: 25000 });
    await expect(phase(page)).toHaveAttribute('data-phase', 'ready');
    await expect(page.locator('#fishing-note')).toContainText('アワセ');
    await cast(page, input);
    await input.flick();
    await expect(page.locator('#reel-state')).toHaveText('ルアーアクション');
    await hook(page, input);
    await expect(page.locator('#return-button')).toBeDisabled();
    await land(page, input);
    await page.screenshot({ path: `test-results/${touch ? 'mobile' : 'desktop'}-catch.png` });
    await input.click(page.locator('#close-catch'));
    await expect(page.locator('#catch-dialog')).toBeHidden();
    await expect(phase(page)).toHaveAttribute('data-phase', 'ready');
    await cast(page, input);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test('mouse: blur/lost capture reset aim, over-tension fails and retry works', async ({ page }) => {
  await setup(page);
  const input = await inputFor(page, false);
  await page.locator('#fish-button').click();
  await page.waitForTimeout(1000);
  for (const reason of ['blur', 'lostpointercapture', 'visibilitychange']) {
    await page.locator('#cast-button').click();
    await input.down();
    await page.evaluate(reason => {
      if (reason === 'blur') window.dispatchEvent(new Event('blur'));
      else if (reason === 'visibilitychange') document.dispatchEvent(new Event(reason));
      else document.querySelector('#scene').dispatchEvent(new PointerEvent(reason, { pointerId: 1 }));
      window.dispatchEvent(new Event('focus'));
    }, reason);
    await input.up();
    await expect(phase(page)).toHaveAttribute('data-phase', 'ready');
  }
  await cast(page, input); await hook(page, input);
  await input.down(); await page.waitForTimeout(500);
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
  const tension = await page.locator('#line-tension').evaluate(el => el.value);
  await page.waitForTimeout(500);
  expect(await page.locator('#line-tension').evaluate(el => el.value)).toBeLessThan(tension);
  await input.up(); await input.down();
  await expect(phase(page)).toHaveAttribute('data-phase', 'failed'); await input.up();
  await expect(page.locator('#fishing-note')).toContainText('ラインが切れ');
  await expect(phase(page)).toHaveAttribute('data-phase', 'ready');
  await cast(page, input);
});

test('mobile landscape: prepare/cancel and return controls remain reachable', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(); await setup(page);
  await page.locator('#fish-button').tap();
  await page.locator('#cast-button').tap();
  await expect(phase(page)).toHaveAttribute('data-phase', 'aim');
  await page.locator('#cancel-cast').tap();
  await expect(phase(page)).toHaveAttribute('data-phase', 'ready');
  await page.screenshot({ path: 'test-results/mobile-landscape-fishing.png' });
  await page.locator('#return-button').tap();
  await expect(page.locator('#motion-label')).toHaveText('停船中');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});
