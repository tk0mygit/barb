import { test, expect } from './diagnostics-fixture.js';
import { openUIFixture } from './ui-fixture.js';
import { installPausedClock } from './clock-fixture.js';
import { biteFish, landFish, updateFishHUD } from './fish-image-driver.js';
import { FISH_SPECIES } from '../../src/game/fish-species.js';
import { getFishTier } from '../../src/game/fish-rarity.js';

const discovery = page => page.locator('.species-discovery');
const award = page => page.locator('#achievement-notice');
async function setup(page, { paused = true } = {}) {
  if (paused) await installPausedClock(page);
  await page.addInitScript(() => { Math.random = () => window.imageRoll ?? 0; });
  await openUIFixture(page);
}
async function catchFish(page, speciesId = 'black-bass') {
  expect((await biteFish(page, speciesId)).phase).toBe('bite');
  expect((await landFish(page)).phase).toBe('result');
}
async function visibility(page, hidden) {
  await page.evaluate(hidden => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

for (const speciesId of ['black-bass', 'brown-trout', 'arapaima', FISH_SPECIES.at(-1).id]) {
  test(`${speciesId}: exact 3s discovery, canonical number, motion stages and full ordered 5s awards`, async ({ page }, info) => {
    await setup(page); await catchFish(page, speciesId);
    const fish = FISH_SPECIES.find(fish => fish.id === speciesId), rare = getFishTier(speciesId) === 'Rare';
    const root = discovery(page);
    await expect(root).toBeVisible(); await expect(root).toHaveAttribute('aria-live', 'polite');
    await expect(root.locator('.discovery-label')).toHaveText(rare ? '希少種発見' : '新種発見');
    await expect(root.locator('.discovery-english')).toHaveText(rare ? 'RARE DISCOVERY' : 'NEW SPECIES');
    await expect(root.locator('.discovery-name')).toHaveText(fish.name);
    await expect(root.locator('.discovery-number')).toHaveText(`No.${String(FISH_SPECIES.indexOf(fish) + 1).padStart(2, '0')} / 36`);
    await expect(root.locator('.discovery-registered')).toHaveText('図鑑登録完了');
    await expect(root.locator('.discovery-ripple')).toHaveCount(rare ? 2 : 1);
    await expect(root.locator('.discovery-imprint')).toHaveCount(rare ? 1 : 0);
    await expect(root).toHaveCSS('color', rare ? 'rgb(224, 213, 169)' : 'rgb(244, 242, 230)');
    await expect(award(page)).toBeHidden();
    const committed = await page.evaluate(() => ({ count: fixture.collection.catches.length,
      encyclopedia: fixture.collection.encyclopedia.filter(entry => entry.count > 0).length,
      lengthCm: fixture.collection.catches[0].lengthCm,
      unlocked: fixture.achievements.snapshot.unlocked }));
    expect(committed.count).toBe(1); expect(committed.encyclopedia).toBe(1);
    expect(committed.unlocked.map(entry => entry.id)).toEqual(['normal-first-catch',
      ...(committed.lengthCm >= 100 ? ['normal-length-100'] : [])]);
    const times = [0, 600, 1500, 2500, 2999], states = [];
    let elapsed = 0;
    for (const time of times) {
      await page.clock.fastForward(time - elapsed); elapsed = time;
      // WAAPI's compositor clock is separate from Playwright's JS fake clock.
      // Seek each paint effect to the same visible age; JS timeout remains real.
      states.push(await root.evaluate((root, time) => {
        for (const animation of root.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = time; }
        const opacity = selector => Number(getComputedStyle(root.querySelector(selector)).opacity);
        return { time, label: opacity('.discovery-label'), name: opacity('.discovery-name'),
          registered: opacity('.discovery-registration'), opacity: Number(getComputedStyle(root).opacity),
          effects: root.getAnimations({ subtree: true }).map(animation => animation.effect.getTiming().duration) };
      }, time));
      await expect(award(page)).toBeHidden();
    }
    expect(states[0].label).toBe(1); expect(states[0].name).toBe(0);
    expect(states[1].name).toBeGreaterThan(0); expect(states[2].registered).toBe(1);
    expect(states[3].opacity).toBe(1); expect(states[4].opacity).toBeLessThan(.01);
    expect(states.every(state => state.effects.every(duration => duration === 3000))).toBe(true);
    await page.clock.fastForward(1); await expect(root).toHaveCount(0);
    const ids = committed.unlocked.map(entry => entry.id);
    for (const id of ids) {
      await expect(award(page)).toHaveAttribute('data-achievement-id', id);
      await expect(award(page)).toBeVisible();
      await page.clock.fastForward(4999); await expect(award(page)).toHaveAttribute('data-achievement-id', id);
      await page.clock.fastForward(1);
    }
    await expect(award(page)).toBeHidden();
    await page.evaluate(() => fixture.achievementNotice.notify(fixture.achievements.entries.filter(entry => entry.unlocked)));
    await expect(award(page)).toBeHidden();
    await page.locator('#close-catch').click(); await catchFish(page, speciesId);
    await expect(root).toHaveCount(0); expect(await page.evaluate(() => fixture.collection.catches.length)).toBe(2);
    await info.attach('discovery-timeline', { body: JSON.stringify({ speciesId, rare, committed, states }), contentType: 'application/json' });
  });
}

test('existing visible award resumes its exact remainder; known species awards start promptly', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => fixture.achievementNotice.notify([{ id: 'existing', name: '以前の実績' }]));
  await page.clock.fastForward(1200); await catchFish(page);
  await expect(award(page)).toBeHidden();
  await page.clock.fastForward(3000); await expect(award(page)).toHaveAttribute('data-achievement-id', 'existing');
  await page.clock.fastForward(3799); await expect(award(page)).toHaveAttribute('data-achievement-id', 'existing');
  await page.clock.fastForward(1); await expect(award(page)).toHaveAttribute('data-achievement-id', 'normal-first-catch');
  await page.clock.fastForward(5000); await expect(award(page)).toBeHidden();
  await page.locator('#close-catch').click();
  await page.evaluate(() => {
    for (let n = 1; n < 9; n++) fixture.collection.register({ schemaVersion: 1, id: `known-${n}`, speciesId: 'black-bass',
      lengthCm: 30, weightKg: 1, caughtAt: '2026-11-08T00:00:00Z' });
  });
  await catchFish(page); await expect(discovery(page)).toHaveCount(0);
  await expect(award(page)).toHaveAttribute('data-achievement-id', 'normal-catch-10');
  await page.clock.fastForward(4999); await expect(award(page)).toBeVisible();
  await page.clock.fastForward(1); await expect(award(page)).toBeHidden();
});

for (const action of ['store', 'sale', 'Escape', 'native-close', 'context-lost', 'dispose']) {
  test(`${action} within 100ms cancels the old discovery and releases the queue`, async ({ page }) => {
    await setup(page); await catchFish(page);
    const caught = await page.evaluate(() => fixture.fishing.state.catch);
    await page.clock.fastForward(50);
    if (action === 'store') await page.locator('#close-catch').click();
    else if (action === 'sale') await page.locator('#sell-catch').click();
    else if (action === 'Escape') await page.keyboard.press('Escape');
    else if (action === 'native-close') await page.locator('#catch-dialog').evaluate(dialog => dialog.close());
    else if (action === 'context-lost') await page.locator('#scene').evaluate(canvas => canvas.dispatchEvent(new Event('webglcontextlost')));
    else await page.evaluate(() => fixture.discoveryCoordinator.dispose());
    await expect(discovery(page)).toHaveCount(0);
    await expect(award(page)).toHaveAttribute('data-achievement-id', 'normal-first-catch');
    if (['context-lost', 'dispose'].includes(action)) await page.locator('#close-catch').click();
    expect(await page.evaluate(() => fixture.collection.catches[0].disposition)).toBe(action === 'sale' ? 'sold' : 'stored');
    await page.clock.fastForward(4999); await expect(award(page)).toBeVisible();
    await page.clock.fastForward(1); await expect(award(page)).toBeHidden();
    expect(await page.evaluate(() => fixture.collection.encyclopedia[0].count)).toBe(1);
    if (action !== 'dispose') {
      await page.evaluate(caught => fixture.discoveryCoordinator.showResult(caught), caught);
      await expect(discovery(page)).toHaveCount(0);
      await catchFish(page, 'bluegill'); await expect(discovery(page)).toBeVisible();
    }
  });
}

test('hidden before first presentation and blur/pagehide during it preserve 3 visible seconds without rewriting live text', async ({ page }) => {
  await setup(page); await visibility(page, true); await catchFish(page);
  await expect(discovery(page)).toBeHidden(); await page.clock.fastForward(60000);
  await expect(award(page)).toBeHidden(); await visibility(page, false);
  await expect(discovery(page)).toBeVisible();
  await page.evaluate(() => {
    window.discoveryMutations = 0;
    window.discoveryObserver = new MutationObserver(records => { window.discoveryMutations += records.length; });
    discoveryObserver.observe(document.querySelector('.discovery-accessible'), { childList: true, characterData: true, subtree: true });
  });
  await page.clock.fastForward(600); await visibility(page, true); await page.clock.fastForward(60000);
  await visibility(page, false); await page.clock.fastForward(900);
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.clock.fastForward(60000);
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.clock.fastForward(1000);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    // Main uses the same recovery when a fresh mobile contact repairs a
    // missing browser focus event; it must resume presentation as well.
    fixture.discoveryCoordinator.recoverFocus();
  });
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await page.clock.fastForward(60000);
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow'))); await page.clock.fastForward(499);
  await expect(discovery(page)).toBeVisible(); await expect(award(page)).toBeHidden();
  expect(await page.evaluate(() => window.discoveryMutations)).toBe(0);
  await page.clock.fastForward(1); await expect(discovery(page)).toHaveCount(0); await expect(award(page)).toBeVisible();
});

const layouts = [
  { width: 1000, height: 700, touch: false }, { width: 320, height: 568, touch: true },
  { width: 390, height: 844, touch: true }, { width: 844, height: 390, touch: true },
];
for (const { touch, ...viewport } of layouts) {
  test(`${viewport.width}x${viewport.height}: reduced motion, safe insets, large text and fixed transparent result controls`, async ({ createContext }, info) => {
    const context = await createContext({ viewport, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce' });
    const page = await context.newPage(); await setup(page);
    await page.addStyleTag({ content: ':root { --safe-top: 12px; --safe-right: 8px; --safe-bottom: 14px; --safe-left: 8px; font-size: 20px; }' });
    await catchFish(page, 'red-bellied-piranha');
    const root = discovery(page); await expect(root).toBeVisible();
    expect(await root.evaluate(root => root.getAnimations({ subtree: true }).length)).toBe(0);
    expect(await root.locator('.discovery-name').evaluate(el => getComputedStyle(el).opacity)).toBe('1');
    const before = await page.evaluate(() => ({
      buttons: [...document.querySelectorAll('.catch-actions button')].map(button => button.getBoundingClientRect().toJSON()),
      fields: ['catch-length', 'catch-weight', 'catch-sale-price', 'catch-save-status'].map(id => document.getElementById(id).getBoundingClientRect().toJSON()),
    }));
    const hits = await page.evaluate(() => [...document.querySelectorAll('.catch-actions button')].map(button => {
      const b = button.getBoundingClientRect();
      return { visible: b.top >= 0 && b.bottom <= innerHeight, hit: document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('button') === button };
    }));
    expect(hits).toEqual([{ visible: true, hit: true }, { visible: true, hit: true }]);
    expect(await root.evaluate(root => root.getBoundingClientRect().width <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('static-discovery.png') });
    await page.clock.fastForward(3000); await expect(root).toHaveCount(0);
    const after = await page.evaluate(() => ({
      buttons: [...document.querySelectorAll('.catch-actions button')].map(button => button.getBoundingClientRect().toJSON()),
      fields: ['catch-length', 'catch-weight', 'catch-sale-price', 'catch-save-status'].map(id => document.getElementById(id).getBoundingClientRect().toJSON()),
    }));
    expect(after).toEqual(before);
    if (touch) await page.locator('#sell-catch').tap(); else await page.locator('#close-catch').click();
    await expect(page.locator('#catch-dialog')).toBeHidden();
    // A second distinct discovery exercises a real tap/click while its overlay
    // is still visible, including a previously active achievement's release.
    await catchFish(page, 'bluegill'); await expect(root).toBeVisible();
    if (touch) await page.locator('#sell-catch').tap(); else await page.locator('#sell-catch').click();
    await expect(root).toHaveCount(0); await expect(page.locator('#catch-dialog')).toBeHidden();
    expect(await page.evaluate(() => fixture.collection.catches.at(-1).disposition)).toBe('sold');
    await page.clock.fastForward(5000); await expect(award(page)).toBeHidden();
  });
}

for (const failure of ['delay', '404', 'decode']) {
  test(`image ${failure}: ripple and label survive, controls close immediately and stale completion cannot return`, async ({ page }) => {
    await setup(page);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    if (failure === 'decode') await page.evaluate(() => { HTMLImageElement.prototype.decode = () => Promise.reject(Error('decode failure')); });
    else await page.route('**/barb/src/assets/fish/black-bass.png', async route => {
      if (failure === 'delay') { await gate; return route.fulfill({ status: 404, body: '' }); }
      return route.fulfill({ status: 404, body: '' });
    });
    await catchFish(page);
    await expect(discovery(page).locator('.discovery-label')).toBeVisible();
    await expect(page.locator('#catch-image')).toBeHidden();
    await page.locator('#sell-catch').click(); release();
    await page.clock.fastForward(6000); await updateFishHUD(page);
    await expect(page.locator('#catch-dialog')).toBeHidden(); await expect(discovery(page)).toHaveCount(0);
    expect(await page.evaluate(() => fixture.collection.catches[0].disposition)).toBe('sold');
  });
}

for (const speciesId of ['black-bass', 'arapaima']) test(`${speciesId} real browser compositor: immediate label, scan/name at 0.6s, registration at 1.5s, fade and removal at 3s`, async ({ page }, info) => {
  await setup(page, { paused: false });
  await page.evaluate(() => {
    window.discoveryPaintSamples = [];
    const observer = new MutationObserver(() => {
      const root = document.querySelector('.species-discovery');
      if (!root) return;
      observer.disconnect(); const started = performance.now();
      // Sample the frame presented at/after the deadline. A timer alone can
      // read the previous compositor frame's opacity just before the next paint.
      for (const time of [0, 600, 900, 1500, 2500, 3050]) setTimeout(() => requestAnimationFrame(() => {
        const opacity = selector => Number(getComputedStyle(root.querySelector(selector)).opacity);
        window.discoveryPaintSamples.push({ time, elapsed: performance.now() - started,
          connected: root.isConnected, label: opacity('.discovery-label'), name: opacity('.discovery-name'),
          registered: opacity('.discovery-registration'), opacity: Number(getComputedStyle(root).opacity),
          ripple: opacity('.discovery-ripple') });
      }), time);
    });
    observer.observe(document.querySelector('#catch-dialog'), { childList: true, subtree: true });
  });
  await catchFish(page, speciesId);
  await page.waitForFunction(() => window.discoveryPaintSamples.length === 6);
  const states = await page.evaluate(() => window.discoveryPaintSamples);
  expect(states[0].elapsed).toBeLessThan(500); expect(states[0].label).toBe(1);
  expect(states[1].name).toBeGreaterThan(0); expect(states[3].registered).toBeGreaterThan(.95);
  if (speciesId === 'arapaima') expect(states[2].ripple).toBe(0);
  else expect(states[2].ripple).toBeGreaterThan(0);
  expect(states[4].opacity).toBeGreaterThan(.8); expect(states[5].connected).toBe(false);
  await info.attach('real-compositor-timeline', { body: JSON.stringify(states), contentType: 'application/json' });
});
