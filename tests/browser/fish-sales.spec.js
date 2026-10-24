import { test, expect } from './diagnostics-fixture.js';
import { FISH_SPECIES } from '../../src/game/fish-species.js';
import { calculateSalePrice } from '../../src/game/fish-sales.js';
import { BUYER_LINES } from '../../src/game/buyer-lines.js';

const money = value => `${value.toLocaleString('ja-JP')} 通貨`;
for (const touch of [false, true]) {
  test(`${touch ? 'touch' : 'mouse'}: immediate, individual and confirmed bulk sales preserve collection and pause`, async ({ createContext }) => {
    test.setTimeout(180000);
    const context = await createContext({ viewport: touch ? { width: 390, height: 844 } : { width: 800, height: 600 }, isMobile: touch, hasTouch: touch, deviceScaleFactor: 0.5 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { window.fishingRandomCalls = 0; Math.random = () => { window.fishingRandomCalls++; return 0.1; }; });
    await page.goto('./'); await expect(page.locator('#status')).toBeHidden();
    await expect(page.locator('#wallet-balance')).toHaveText(money(0));
    const click = locator => touch ? locator.tap({ force: true }) : locator.click({ force: true });
    await click(page.locator('#fish-button'));
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    // GPU/CDP work can outlast a one-second pause deadline on software WebGL.
    await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
    const tick = () => page.clock.fastForward(250);
    const phase = () => page.locator('#fishing-panel').getAttribute('data-phase');
    const cdp = await context.newCDPSession(page), x = touch ? 300 : 500, y = touch ? 420 : 350;
    const down = async () => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }) : (await page.mouse.move(x, y), page.mouse.down());
    const up = () => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) : page.mouse.up();
    async function catchFish() {
      await click(page.locator('#cast-button')); await tick();
      await down();
      if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 150 }] });
      else await page.mouse.move(x, y - 150);
      await up();
      for (let i = 0; i < 32 && await phase() !== 'bite'; i++) await tick();
      expect(await phase()).toBe('bite');
      await down(); await up(); await tick(); expect(await phase()).toBe('fight');
      let held = false;
      for (let i = 0; i < 100 && await phase() === 'fight'; i++) {
        const tension = await page.locator('#line-tension').evaluate(el => el.value);
        if (!held && tension < 0.35) { await down(); held = true; }
        else if (held && tension > 0.65) { await up(); held = false; }
        await tick();
      }
      if (held) await up();
      expect(await phase()).toBe('landing');
      for (let i = 0; i < 5; i++) await tick();
      await expect(page.locator('#catch-dialog')).toBeVisible();
      const name = await page.locator('#catch-species').textContent();
      const species = FISH_SPECIES.find(fish => fish.name === name);
      const weightKg = parseFloat(await page.locator('#catch-weight').textContent());
      const price = calculateSalePrice({ speciesId: species.id, weightKg });
      const length = await page.locator('#catch-length').textContent();
      await expect(page.locator('#catch-sale-price')).toHaveText(`売却価格 ${money(price)}`);
      await expect(page.locator('#sell-catch')).toBeVisible(); await expect(page.locator('#close-catch')).toBeVisible();
      return { price, name, length };
    }
    const openStorage = async () => {
      await click(page.locator('#menu-button'));
      await expect(page.locator('#collection-dialog')).toBeVisible();
      await expect(page.locator('#collection-title')).toHaveText('湖の記録');
      await click(page.locator('[data-view="storage"]'));
      // Zero rows alone also passes on the wrong screen. Confirm navigation
      // before checking storage counts or the bulk-sale button's state.
      await expect(page.locator('#collection-title')).toHaveText('保管魚');
      await expect(page.locator('#sell-all')).toBeVisible();
    };
    const assertMoney = async value => {
      await expect(page.locator('#wallet-balance')).toHaveText(money(value));
      await expect(page.locator('#collection-wallet')).toHaveText(`所持金 ${money(value)}`);
    };
    const first = await catchFish();
    const draws = await page.evaluate(() => window.fishingRandomCalls);
    await click(page.locator('#sell-catch')); await tick();
    expect(await phase()).toBe('ready'); await assertMoney(first.price);
    expect(await page.evaluate(() => window.fishingRandomCalls)).toBe(draws);
    const notice = await page.locator('#sale-notice').textContent();
    expect(notice).toContain(`+${money(first.price)}`); expect(BUYER_LINES.some(line => notice.includes(line))).toBe(true);
    // Late close, store and duplicate sale events cannot settle the sold fish again.
    await page.evaluate(() => {
      document.querySelector('#catch-dialog').dispatchEvent(new Event('close'));
      document.querySelector('#close-catch').click(); document.querySelector('#sell-catch').click();
    });
    await tick(); await assertMoney(first.price);
    await openStorage(); await expect(page.locator('.stored-fish')).toHaveCount(0);
    await expect(page.locator('#sell-all')).toBeDisabled();
    await click(page.locator('#collection-close'));

    const second = await catchFish(); await click(page.locator('#close-catch')); await tick();
    await openStorage(); await expect(page.locator('.stored-fish')).toHaveCount(1);
    await expect(page.locator('.stored-price')).toHaveText(`売却価格 ${money(second.price)}`);
    const progress = await page.locator('#fishing-conditions').getAttribute('data-cycle-progress');
    const staleButton = await page.locator('.sell-stored').elementHandle();
    await click(page.locator('.sell-stored'));
    let balance = first.price + second.price;
    await assertMoney(balance); await expect(page.locator('.stored-fish')).toHaveCount(0);
    await expect(page.locator('#collection-sale-notice')).toContainText(`+${money(second.price)}`);
    await staleButton.evaluate(button => button.click()); await assertMoney(balance);
    await page.clock.fastForward(60000);
    await expect(page.locator('#fishing-conditions')).toHaveAttribute('data-cycle-progress', progress);
    await click(page.locator('#collection-close')); await tick();

    const third = await catchFish(); await page.keyboard.press('Escape'); await tick();
    const fourth = await catchFish(); await page.locator('#catch-dialog').evaluate(dialog => dialog.close()); await tick();
    expect(await phase()).toBe('ready'); await assertMoney(balance);
    await openStorage(); await expect(page.locator('.stored-fish')).toHaveCount(2);
    await click(page.locator('#sell-all'));
    await expect(page.locator('.sale-confirm-summary')).toHaveText(`2匹を ${money(third.price + fourth.price)} で売却します。`);
    await click(page.locator('#cancel-sale')); await assertMoney(balance);
    await expect(page.locator('.stored-fish')).toHaveCount(2);
    await click(page.locator('#sell-all')); await page.keyboard.press('Escape');
    await expect(page.locator('#collection-dialog')).toBeHidden(); await assertMoney(balance);
    await openStorage(); await expect(page.locator('.stored-fish')).toHaveCount(2);
    await click(page.locator('#sell-all'));
    if (touch) await page.setViewportSize({ width: 844, height: 390 });
    await page.screenshot({ path: `test-results/bulk-confirm-${touch ? 'touch-landscape' : 'mouse'}.png`, animations: 'disabled' });
    const confirm = await page.locator('#confirm-sale').elementHandle();
    await click(page.locator('#confirm-sale')); balance += third.price + fourth.price;
    await assertMoney(balance); await expect(page.locator('.stored-fish')).toHaveCount(0);
    await expect(page.locator('#sell-all')).toBeDisabled();
    await confirm.evaluate(button => button.click()); await assertMoney(balance);
    await expect(page.locator('#collection-sale-notice')).toContainText(`2匹を売却 · +${money(third.price + fourth.price)}`);
    await page.screenshot({ path: `test-results/sold-${touch ? 'touch-landscape' : 'mouse'}.png`, animations: 'disabled' });
    if (touch) await page.setViewportSize({ width: 390, height: 844 });
    await click(page.locator('#collection-back')); await click(page.locator('[data-view="encyclopedia"]'));
    await expect(page.locator('button.fish-card')).toHaveCount(1);
    await click(page.locator('button.fish-card'));
    await expect(page.locator('.fish-detail')).toContainText('4匹');
    await expect(page.locator('.fish-detail')).toContainText(first.length);
    await click(page.locator('#collection-close')); await tick();
    expect(await phase()).toBe('ready');
    await page.clock.resume(); await page.reload(); await expect(page.locator('#status')).toBeHidden();
    await expect(page.locator('#wallet-balance')).toHaveText(money(balance));
    expect(errors).toEqual([]);
  });
}
