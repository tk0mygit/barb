import { test, expect } from './diagnostics-fixture.js';
import { installPausedClock } from './clock-fixture.js';
import { activateButton, expirePublicQte } from './input-fixture.js';
import { armEncounter, verifyEncounterBite, readFishingEvidence } from './encounter-fixture.js';
import { NORMAL_ACHIEVEMENTS } from '../../src/game/achievements.js';

for (const touch of [false, true]) {
  test(`${touch ? 'touch' : 'mouse'}: real sales fund READY/sailing purchases; active fishing remains read-only`, async ({ createContext }, info) => {
    const context = await createContext({ viewport: touch ? { width: 390, height: 844 } : { width: 800, height: 600 }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 0.5 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      // This is a transaction/input regression, not an image comparison.
      // Bound the software WebGL backbuffer without changing CSS viewport,
      // touch coordinates, simulation steps or the UI screenshot resolution.
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 0.25 });
      Math.random = () => window.testRandomDraws?.length ? window.testRandomDraws.shift() : window.testRandomValue ?? 0.1;
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
    let encounterPlan;
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
      // Restore the pre-6A funding fish/size through the current production
      // interval, independently of the registry's last species or total weight.
      encounterPlan = await armEncounter(page, { speciesId: 'arowana', lengthRoll: 0.99, rodLevel });
      for (let i = 0; i < 32 && await phase() !== 'bite'; i++) await tick();
      expect(await phase()).toBe('bite');
      await verifyEncounterBite(page, encounterPlan);
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
      await Promise.all([
        expect(page.locator('#catch-species')).toHaveText(encounterPlan.name),
        expect(page.locator('#catch-length')).toHaveText(`${encounterPlan.lengthCm.toFixed(1)} cm`),
        expect(page.locator('#catch-weight')).toHaveText(`${encounterPlan.weightKg.toFixed(2)} kg`),
        expect(page.locator('#catch-qte-bonus')).toHaveText('QTE成功0回／ボーナス+0 Value'),
        expect(page.locator('#catch-sale-price')).toHaveText(`売却価格 ${encounterPlan.basePrice.toLocaleString('ja-JP')} Value`),
      ]);
      if (checkStates) {
        await expect(page.locator('#menu-button')).toBeDisabled();
        await page.locator('#menu-button').dispatchEvent('click');
        await expect(page.locator('#collection-dialog')).toBeHidden();
      }
    }
    // Observe the actual first RESULT, including any final 250ms landing tick.
    // This marker reads the DOM only; it does not drive presentation or state.
    await page.locator('#catch-dialog').evaluate(dialog => {
      window.equipmentDiscoveryStart = null;
      const observer = new MutationObserver(() => {
        const discovery = dialog.querySelector('.species-discovery');
        if (!discovery) return;
        const notice = document.querySelector('#achievement-notice');
        window.equipmentDiscoveryStart = { at: performance.now(), catchId: discovery.dataset.catchId,
          phase: document.querySelector('#fishing-panel').dataset.phase, dialogOpen: dialog.open,
          label: discovery.querySelector('.discovery-label').textContent,
          noticeHidden: notice.hidden, noticeText: notice.textContent };
        observer.disconnect();
      });
      observer.observe(dialog, { childList: true, subtree: true });
    });
    await cast(); await land();
    await info.attach('equipment-production-catch', {
      body: JSON.stringify(await readFishingEvidence(page)), contentType: 'application/json',
    });
    // Capture commits immediately, but the first Rare discovery owns the first
    // three visible seconds. Real-time expect polling cannot advance this clock.
    const discovery = page.locator('.species-discovery'), notice = page.locator('#achievement-notice');
    const sequence = [];
    const observe = async stage => {
      const sample = await page.evaluate(stage => {
        const now = performance.now(), notice = document.querySelector('#achievement-notice');
        return { stage, at: now, discoveryAge: now - window.equipmentDiscoveryStart.at,
          discoveryPresent: Boolean(document.querySelector('.species-discovery')),
          noticeHidden: notice.hidden, noticeText: notice.textContent,
          noticeId: notice.dataset.achievementId ?? null, host: notice.parentElement.id,
          opacity: getComputedStyle(notice).opacity, animationTime: notice.getAnimations()[0]?.currentTime ?? null };
      }, stage);
      sequence.push(sample); return sample;
    };
    try {
      const start = await page.evaluate(() => window.equipmentDiscoveryStart);
      sequence.push({ stage: 'discovery-start', ...start });
      expect(start).toMatchObject({ phase: 'result', dialogOpen: true, label: '希少種発見',
        noticeHidden: true, noticeText: '' });
      await expect(page.locator('#catch-dialog')).toBeVisible();
      await expect(discovery).toBeVisible();
      await expect(discovery.locator('.discovery-english')).toHaveText('RARE DISCOVERY');
      await expect(notice).toBeHidden();
      const landed = await observe('after-landing-ticks');
      expect(landed.discoveryAge).toBeLessThan(1500);
      await page.clock.fastForward(1500 - landed.discoveryAge);
      await expect(discovery).toBeVisible(); await expect(notice).toBeHidden();
      const priority = await observe('discovery-priority');
      expect(priority.discoveryAge).toBe(1500);
      await page.clock.fastForward(2999 - priority.discoveryAge);
      await expect(discovery).toBeVisible(); await expect(notice).toBeHidden();
      await observe('discovery-before-deadline');
      await page.clock.fastForward(1);
      await expect(discovery).toHaveCount(0);
      await expect(notice).toContainText('始まり');
      await expect(notice).toBeVisible();
      await expect(notice).toHaveAttribute('data-achievement-id', 'normal-first-catch');
      expect(await notice.evaluate(el => el.parentElement.id)).toBe('catch-dialog');
      await observe('achievement-start');
      // Keep the original opacity and five-second expiry assertions. The full
      // opacity plateau begins 600ms after the award, not when it is first shown.
      await page.clock.fastForward(600);
      await expect(notice).toHaveCSS('opacity', '1');
      expect(await notice.evaluate(el => el.getAnimations()[0].effect.getTiming().duration)).toBe(5000);
      await observe('achievement-opaque');
      await page.screenshot({ path: info.outputPath('achievement-in-production-catch.png') });
      await page.clock.fastForward(5000);
      await expect(notice).toBeHidden();
      await observe('achievement-expired');
    } finally {
      await info.attach('equipment-discovery-achievement-sequence', {
        body: JSON.stringify(sequence, null, 2), contentType: 'application/json',
      });
    }
    await click(page.locator('#sell-catch')); await tick(); expect(await phase()).toBe('ready');
    const income = parseInt((await page.locator('#wallet-balance').textContent()).replaceAll(',', ''));
    expect(income).toBeGreaterThanOrEqual(600);
    await openEquipment(); await expect(page.locator('[data-upgrade="rod"]')).toBeEnabled();
    await click(page.locator('[data-upgrade="rod"]')); await click(page.locator('#confirm-upgrade'));
    rodLevel = 2;
    await expect(page.locator('[data-equipment="rod"] h3')).toHaveText('ロッド · Lv.2');
    await expect(page.locator('#achievement-notice')).toContainText('更新');
    await click(page.locator('#collection-back')); await click(page.locator('[data-view="achievements"]'));
    await expect(page.locator('.achievement-summary')).toHaveText(`解除済み 2 / ${NORMAL_ACHIEVEMENTS.length}`);
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
    const money = `${(income - 600).toLocaleString('ja-JP')} Value`;
    await expect(page.locator('#wallet-balance')).toHaveText(money);
    await expect(page.locator('#collection-wallet')).toHaveText(`所持金 ${money}`);
    await expect(page.locator('[data-equipment="reel"] h3')).toHaveText('リール · Lv.2');
    await closeMenu(); await page.clock.resume(); await page.reload();
    await expect(page.locator('#status')).toBeHidden(); await openEquipment();
    await expect(page.locator('[data-equipment="rod"] h3')).toHaveText('ロッド · Lv.2');
    await expect(page.locator('[data-equipment="reel"] h3')).toHaveText('リール · Lv.2');
    await expect(page.locator('#wallet-balance')).toHaveText(money);
    await click(page.locator('#collection-back')); await click(page.locator('[data-view="achievements"]'));
    await expect(page.locator('.achievement-summary')).toHaveText(`解除済み 2 / ${NORMAL_ACHIEVEMENTS.length}`);
    expect(errors).toEqual([]);
  });
}
