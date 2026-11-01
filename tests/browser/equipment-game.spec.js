import { test, expect } from './diagnostics-fixture.js';
import { installPausedClock } from './clock-fixture.js';
import { activateButton, expirePublicQte } from './input-fixture.js';

for (const touch of [false, true]) {
  test(`${touch ? 'touch' : 'mouse'}: real sales fund READY/sailing purchases; active fishing remains read-only`, async ({ createContext }) => {
    const context = await createContext({ viewport: touch ? { width: 390, height: 844 } : { width: 800, height: 600 }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 0.5 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      // This is a transaction/input regression, not an image comparison.
      // Bound the software WebGL backbuffer without changing CSS viewport,
      // touch coordinates, simulation steps or the UI screenshot resolution.
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 0.25 });
      Math.random = () => window.testRandomValue ?? 0.1;
    });
    await installPausedClock(page);
    const tick = () => page.clock.fastForward(250);
    await page.goto('./'); await tick();
    await expect(page.locator('#status')).toBeHidden();
    const click = locator => activateButton(locator, touch);
    await click(page.locator('#fish-button')); await tick();
    await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'ready');
    const phase = () => page.locator('#fishing-panel').getAttribute('data-phase');
    const cdp = await context.newCDPSession(page), x = touch ? 300 : 500, y = touch ? 420 : 350;
    const down = async () => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }) : (await page.mouse.move(x, y), page.mouse.down());
    const up = () => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) : page.mouse.up();
    let rodLevel = 1;
    const openEquipment = async () => {
      await click(page.locator('#menu-button'));
      await expect(page.locator('#collection-dialog')).toBeVisible();
      await click(page.locator('[data-view="equipment"]'));
    };
    const closeMenu = () => click(page.locator('#collection-close'));
    async function readOnly() {
      const balance = await page.locator('#wallet-balance').textContent();
      await openEquipment();
      await expect(page.locator('#upgrade-guidance')).toHaveText('操船中、またはキャスト前に強化できます');
      for (const kind of ['rod', 'reel']) {
        await expect(page.locator(`[data-upgrade="${kind}"]`)).toBeDisabled();
        await page.locator(`[data-upgrade="${kind}"]`).dispatchEvent('click');
      }
      await expect(page.locator('#confirm-upgrade')).toHaveCount(0);
      const progress = await page.locator('#fishing-conditions').getAttribute('data-cycle-progress');
      await page.clock.fastForward(6000);
      await expect(page.locator('#fishing-conditions')).toHaveAttribute('data-cycle-progress', progress);
      await expect(page.locator('#wallet-balance')).toHaveText(balance);
      await closeMenu();
    }
    async function cast(checkStates = false) {
      await page.evaluate(() => { window.testRandomValue = 0.1; });
      await click(page.locator('#cast-button')); await tick();
      if (checkStates) {
        expect(await phase()).toBe('aim'); await readOnly(); await tick();
        expect(await phase()).toBe('ready'); // existing preparation cancellation
        await click(page.locator('#cast-button')); await tick();
      }
      await down();
      if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 180 }] });
      else await page.mouse.move(x, y - 180);
      await tick();
      await expect(page.locator('#line-distance')).toHaveText(`着水予測 ${(32 + 2 * (rodLevel - 1)).toFixed(1)} m`);
      await up(); await tick(); expect(await phase()).toBe('cast');
      if (checkStates) await readOnly();
      for (let i = 0; i < 4 && await phase() === 'cast'; i++) await tick();
      expect(await phase()).toBe('lure');
      if (checkStates) await readOnly();
      await page.evaluate(() => { window.testRandomValue = 0.99; });
      for (let i = 0; i < 32 && await phase() !== 'bite'; i++) await tick();
      expect(await phase()).toBe('bite');
      if (checkStates) await readOnly();
    }
    async function land(checkStates = false) {
      await down(); await up(); await tick(); expect(await phase()).toBe('fight');
      if (checkStates) await readOnly();
      let held = false;
      for (let i = 0; i < 140 && await phase() === 'fight'; i++) {
        if (await expirePublicQte(page, up)) { held = false; continue; }
        const tension = await page.locator('#line-tension').evaluate(el => el.value);
        if (!held && tension < 0.35) { await down(); held = true; }
        else if (held && tension > 0.65) { await up(); held = false; }
        await tick();
      }
      if (held) await up();
      expect(await phase()).toBe('landing');
      if (checkStates) await readOnly();
      for (let i = 0; i < 5; i++) await tick();
      await expect(page.locator('#catch-dialog')).toBeVisible();
      if (checkStates) {
        await expect(page.locator('#menu-button')).toBeDisabled();
        await page.locator('#menu-button').dispatchEvent('click');
        await expect(page.locator('#collection-dialog')).toBeHidden();
      }
    }
    await cast(); await land();
    // Reach achievements through a real cast/hook/fight/landing on the shipped
    // build. Capture unlocks before the sale/storage decision.
    await expect(page.locator('#achievement-notice')).toContainText('初めての一匹');
    expect(await page.locator('#achievement-notice').evaluate(el => el.parentElement.id)).toBe('catch-dialog');
    await page.clock.fastForward(3500);
    await expect(page.locator('#achievement-notice')).toBeHidden();
    await click(page.locator('#sell-catch')); await tick(); expect(await phase()).toBe('ready');
    const income = parseInt((await page.locator('#wallet-balance').textContent()).replaceAll(',', ''));
    expect(income).toBeGreaterThanOrEqual(600);
    await openEquipment(); await expect(page.locator('[data-upgrade="rod"]')).toBeEnabled();
    await click(page.locator('[data-upgrade="rod"]')); await click(page.locator('#confirm-upgrade'));
    rodLevel = 2;
    await expect(page.locator('[data-equipment="rod"] h3')).toHaveText('ロッド · Lv.2');
    await expect(page.locator('#achievement-notice')).toContainText('初強化');
    await click(page.locator('#collection-back')); await click(page.locator('[data-view="achievements"]'));
    await expect(page.locator('.achievement-summary')).toHaveText('解除済み 2 / 15');
    await expect(page.locator('[data-achievement-id="normal-first-catch"].achievement-card')).toHaveAttribute('data-unlocked', 'true');
    const pausedProgress = await page.locator('#fishing-conditions').getAttribute('data-cycle-progress');
    await page.clock.fastForward(60000);
    await expect(page.locator('#fishing-conditions')).toHaveAttribute('data-cycle-progress', pausedProgress);
    await expect(page.locator('#achievement-notice')).toBeHidden();
    await closeMenu(); await tick();
    await cast(true); await land(true);
    await click(page.locator('#close-catch')); await tick();
    // A missed hook reaches FAILED, which is also read-only.
    await cast();
    for (let i = 0; i < 5 && await phase() === 'bite'; i++) await tick();
    expect(await phase()).toBe('failed');
    await readOnly(); for (let i = 0; i < 8 && await phase() !== 'ready'; i++) await tick();
    await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'ready');
    await expect(page.locator('#cast-button')).toBeVisible();
    await expect(page.locator('#cast-button')).toBeEnabled();
    await click(page.locator('#return-button')); await tick();
    await openEquipment(); await expect(page.locator('[data-upgrade="reel"]')).toBeEnabled();
    await click(page.locator('[data-upgrade="reel"]')); await click(page.locator('#confirm-upgrade'));
    const money = `${(income - 600).toLocaleString('ja-JP')} 通貨`;
    await expect(page.locator('#wallet-balance')).toHaveText(money);
    await expect(page.locator('#collection-wallet')).toHaveText(`所持金 ${money}`);
    await expect(page.locator('[data-equipment="reel"] h3')).toHaveText('リール · Lv.2');
    await closeMenu(); await page.clock.resume(); await page.reload();
    await expect(page.locator('#status')).toBeHidden(); await openEquipment();
    await expect(page.locator('[data-equipment="rod"] h3')).toHaveText('ロッド · Lv.2');
    await expect(page.locator('[data-equipment="reel"] h3')).toHaveText('リール · Lv.2');
    await expect(page.locator('#wallet-balance')).toHaveText(money);
    await click(page.locator('#collection-back')); await click(page.locator('[data-view="achievements"]'));
    await expect(page.locator('.achievement-summary')).toHaveText('解除済み 2 / 15');
    expect(errors).toEqual([]);
  });
}
