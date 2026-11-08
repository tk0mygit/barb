import { test, expect } from './diagnostics-fixture.js';
import { openUIFixture } from './ui-fixture.js';
import { installPausedClock } from './clock-fixture.js';
import { biteFish, landFish, updateFishHUD } from './fish-image-driver.js';
import { FISH_SPECIES } from '../../src/game/fish-species.js';
import { getFishTier } from '../../src/game/fish-rarity.js';

const discovery = page => page.locator('.species-discovery');
const award = page => page.locator('#achievement-notice');
const decorationSelector = '.species-discovery, .discovery-vignette, .discovery-sigil';
test.use({ viewport: { width: 1000, height: 700 } });
async function seekPaint(page, time) {
  return page.locator('#catch-dialog').evaluate(async (dialog, time) => {
    const effects = dialog.getAnimations({ subtree: true }).filter(animation => animation.effect.target.closest('.species-discovery, .discovery-vignette, .discovery-sigil'));
    for (const animation of effects) animation.pause();
    // A subsequent fake-clock catch can be ahead of the compositor timeline.
    // Resolve pending pause tasks before seeking the presented frame.
    await Promise.all(effects.map(animation => animation.ready));
    for (const animation of effects) animation.currentTime = time;
    return effects.length;
  }, time);
}
async function expectClean(page) {
  await expect(page.locator(decorationSelector)).toHaveCount(0);
  expect(await page.locator('#catch-dialog').evaluate(dialog => dialog.getAnimations({ subtree: true })
    .filter(animation => animation.effect.target.closest('.species-discovery, .discovery-vignette, .discovery-sigil')).length)).toBe(0);
}
async function setup(page, { paused = true } = {}) {
  if (paused) await installPausedClock(page);
  await page.addInitScript(() => { Math.random = () => window.imageRoll ?? 0; });
  await openUIFixture(page);
  // Keep native hover transitions out of geometry/pixel comparisons.
  await page.mouse.move(0, 0);
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
    await expect(page.locator('.discovery-vignette')).toHaveCount(1);
    await expect(page.locator('.discovery-vignette')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('.discovery-sigil')).toHaveCount(rare ? 1 : 0);
    if (rare) {
      await expect(page.locator('.discovery-sigil')).toHaveAttribute('aria-hidden', 'true');
      await expect(page.locator('.discovery-sigil path')).toHaveCount(3);
    }
    await expect(root).toHaveCSS('color', rare ? 'rgb(224, 213, 169)' : 'rgb(244, 242, 230)');
    await expect(award(page)).toBeHidden();
    const committed = await page.evaluate(() => ({ count: fixture.collection.catches.length,
      encyclopedia: fixture.collection.encyclopedia.filter(entry => entry.count > 0).length,
      lengthCm: fixture.collection.catches[0].lengthCm,
      unlocked: fixture.achievements.snapshot.unlocked }));
    expect(committed.count).toBe(1); expect(committed.encyclopedia).toBe(1);
    expect(committed.unlocked.map(entry => entry.id)).toEqual(['normal-first-catch',
      ...(committed.lengthCm >= 100 ? ['normal-length-100'] : [])]);
    await expect(page.locator('#catch-image')).toBeVisible();
    await page.screenshot({ path: info.outputPath('result-before-decoration.png'), style: `${decorationSelector} { visibility: hidden !important; }` });
    const times = [0, 200, 600, 800, 940, 1030, 1320, 1400, 1500, 2500, 2999], states = [];
    let elapsed = 0;
    for (const time of times) {
      await page.clock.fastForward(time - elapsed); elapsed = time;
      // WAAPI's compositor clock is separate from Playwright's JS fake clock.
      // Seek each paint effect to the same visible age; JS timeout remains real.
      const animationCount = await seekPaint(page, time);
      expect(animationCount).toBe(rare ? 11 : 7);
      states.push(await root.evaluate((root, time) => {
        const opacity = selector => Number(getComputedStyle(root.querySelector(selector)).opacity);
        return { time, label: opacity('.discovery-label'), name: opacity('.discovery-name'),
          registered: opacity('.discovery-registration'), opacity: Number(getComputedStyle(root).opacity),
          vignette: Number(getComputedStyle(document.querySelector('.discovery-vignette')).opacity),
          sigil: [...document.querySelectorAll('.discovery-sigil path')].map(path => Number(getComputedStyle(path).opacity)),
          effects: root.getAnimations({ subtree: true }).map(animation => animation.effect.getTiming().duration) };
      }, time));
      if ([200, 1030].includes(time)) await page.screenshot({ path: info.outputPath(`discovery-${time}ms.png`) });
      await expect(award(page)).toBeHidden();
    }
    const at = time => states.find(state => state.time === time);
    expect(at(0).label).toBe(1); expect(at(0).name).toBe(0);
    expect(at(600).name).toBeGreaterThan(0); expect(at(1500).registered).toBe(1);
    expect(at(2500).opacity).toBe(1); expect(at(2999).opacity).toBeLessThan(.01);
    expect(at(0).vignette).toBe(0); expect(at(200).vignette).toBe(1);
    expect(at(2500).vignette).toBe(1); expect(at(2999).vignette).toBeLessThan(.01);
    if (rare) {
      expect(at(800).sigil).toEqual([0, 0, 0]);
      expect(at(940).sigil[0]).toBeGreaterThan(at(940).sigil[2]);
      expect(at(1030).sigil.every(opacity => opacity >= .7)).toBe(true);
      expect(at(1320).sigil).toEqual([0, 0, 0]); expect(at(1400).sigil).toEqual([0, 0, 0]);
    } else expect(states.every(state => state.sigil.length === 0)).toBe(true);
    expect(states.every(state => state.effects.every(duration => duration === 3000))).toBe(true);
    await page.clock.fastForward(1); await expect(root).toHaveCount(0);
    await expectClean(page);
    await page.screenshot({ path: info.outputPath('discovery-3000ms-removed.png') });
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
    await expectClean(page);
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
  await setup(page); await visibility(page, true); await catchFish(page, 'peacock-bass');
  await expect(discovery(page)).toBeHidden(); await page.clock.fastForward(60000);
  await expect(page.locator('.discovery-vignette')).toBeHidden();
  await expect(page.locator('.discovery-sigil')).toBeHidden();
  await expect(award(page)).toBeHidden(); await visibility(page, false);
  await expect(discovery(page)).toBeVisible();
  await page.evaluate(() => {
    window.discoveryMutations = 0;
    window.discoveryObserver = new MutationObserver(records => { window.discoveryMutations += records.length; });
    discoveryObserver.observe(document.querySelector('.discovery-accessible'), { childList: true, characterData: true, subtree: true });
  });
  await page.clock.fastForward(600); await visibility(page, true); await page.clock.fastForward(60000);
  await expect(page.locator('.discovery-vignette')).toBeHidden();
  await expect(page.locator('.discovery-sigil')).toBeHidden();
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
  await expectClean(page);
});

test('Rare rotation and motion changes preserve the deadline; Escape during the next stamp removes every effect', async ({ createContext }) => {
  const context = await createContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage(); await setup(page); await catchFish(page, 'peacock-bass');
  await page.clock.fastForward(600);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
  expect(await page.locator('#catch-dialog').evaluate(dialog => {
    const frame = dialog.querySelector('.fish-image-frame').getBoundingClientRect();
    const vignette = dialog.querySelector('.discovery-vignette'), bounds = vignette.getBoundingClientRect();
    const style = getComputedStyle(vignette);
    return Math.abs(bounds.x + parseFloat(style.getPropertyValue('--discovery-focus-x')) - frame.x - frame.width / 2) < .1
      && Math.abs(bounds.y + parseFloat(style.getPropertyValue('--discovery-focus-y')) - frame.y - frame.height * .46) < .1;
  })).toBe(true);
  await page.clock.fastForward(430); await seekPaint(page, 1030);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(discovery(page)).toHaveAttribute('data-reduced-motion', 'true');
  expect(await page.locator('#catch-dialog').evaluate(dialog => dialog.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(page.locator('.discovery-vignette')).toHaveCSS('opacity', '1');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(discovery(page)).toHaveAttribute('data-reduced-motion', 'false');
  expect(await seekPaint(page, 1030)).toBe(11);
  await page.clock.fastForward(1969); await expect(discovery(page)).toBeVisible(); await expect(award(page)).toBeHidden();
  await page.clock.fastForward(1); await expectClean(page); await expect(award(page)).toBeVisible();
  await page.locator('#close-catch').tap(); await page.clock.fastForward(5000);
  await catchFish(page, 'northern-pike'); await page.clock.fastForward(1030); await seekPaint(page, 1030);
  await expect(page.locator('.discovery-sigil')).toBeVisible();
  await page.keyboard.press('Escape'); await expectClean(page);
  await page.clock.fastForward(6000); await expectClean(page);
});

const layouts = [
  { width: 1000, height: 700, touch: false }, { width: 320, height: 568, touch: true },
  { width: 390, height: 844, touch: true }, { width: 844, height: 390, touch: true },
  { width: 568, height: 320, touch: true },
];
for (const { touch, ...viewport } of layouts) {
  test(`${viewport.width}x${viewport.height}: animated focus protects artwork and text, Rare stamp fits behind fish`, async ({ createContext }, info) => {
    const context = await createContext({ viewport, hasTouch: touch, isMobile: touch });
    const page = await context.newPage(); await setup(page);
    await page.addStyleTag({ content: 'html:root { --safe-top: 12px; --safe-right: 8px; --safe-bottom: 14px; --safe-left: 8px; font-size: 20px; }' });
    expect(await page.evaluate(() => ['top', 'right', 'bottom', 'left'].map(edge => getComputedStyle(document.documentElement).getPropertyValue(`--safe-${edge}`).trim()))).toEqual(['12px', '8px', '14px', '8px']);
    const backdrop = await page.locator('#catch-dialog').evaluate(dialog => getComputedStyle(dialog, '::backdrop').backgroundColor);
    for (const speciesId of ['black-bass', 'peacock-bass']) {
      await catchFish(page, speciesId); await expect(page.locator('#catch-image')).toBeVisible();
      await page.mouse.move(0, 0);
      for (const id of ['sell-catch', 'close-catch']) await expect(page.locator(`#${id}`)).toHaveCSS('transform', 'none');
      const geometry = () => page.locator('#catch-dialog').evaluate(dialog => ({
        dialog: dialog.getBoundingClientRect().toJSON(), scroll: dialog.scrollTop,
        fields: [...dialog.querySelectorAll('#catch-species, dl, #catch-sale-price, .catch-actions button')].map(node => node.getBoundingClientRect().toJSON()),
      }));
      const before = await geometry();
      await page.screenshot({ path: info.outputPath(`${speciesId}-before.png`), style: `${decorationSelector} { visibility: hidden !important; }` });
      let elapsed = 0;
      for (const time of [200, 1030, 1500]) {
        await page.clock.fastForward(time - elapsed); elapsed = time; await seekPaint(page, time);
        await page.screenshot({ path: info.outputPath(`${speciesId}-${time}ms.png`) });
      }
      const reading = await page.locator('#catch-dialog').evaluate(dialog => {
        const frame = dialog.querySelector('.fish-image-frame').getBoundingClientRect(), vignette = dialog.querySelector('.discovery-vignette');
        const focus = getComputedStyle(vignette), bounds = vignette.getBoundingClientRect();
        const stamp = dialog.querySelector('.discovery-sigil')?.getBoundingClientRect();
        return { frame: frame.toJSON(), bounds: bounds.toJSON(),
          focusX: parseFloat(focus.getPropertyValue('--discovery-focus-x')) + bounds.x,
          focusY: parseFloat(focus.getPropertyValue('--discovery-focus-y')) + bounds.y,
          backdrop: getComputedStyle(dialog, '::backdrop').backgroundColor,
          // The discovery already repeats the canonical species name. Native
          // focus may scroll the original duplicate h2 outside a short dialog;
          // require the discovery name and registration themselves to fit.
          text: [...dialog.querySelectorAll('.discovery-name, .discovery-registration')].map(node => {
            const box = node.getBoundingClientRect(); return { visible: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth,
              opacity: getComputedStyle(node).opacity };
          }),
          pointer: [...dialog.querySelectorAll('.species-discovery, .species-discovery *, .discovery-vignette, .discovery-sigil, .discovery-sigil *')]
            .every(node => getComputedStyle(node).pointerEvents === 'none'),
          stampFits: !stamp || (stamp.left >= frame.left && stamp.right <= frame.right && stamp.top >= frame.top && stamp.bottom <= frame.bottom) };
      });
      expect(reading.bounds.width).toBeGreaterThan(reading.frame.width);
      expect(reading.bounds.height).toBeGreaterThan(reading.frame.height);
      expect(reading.focusX).toBeCloseTo(reading.frame.x + reading.frame.width / 2, 1);
      expect(reading.focusY).toBeCloseTo(reading.frame.y + reading.frame.height * .46, 1);
      expect(reading.backdrop).toBe(backdrop);
      expect(reading.text).toEqual(Array(2).fill({ visible: true, opacity: '1' }));
      expect(reading.pointer).toBe(true); expect(reading.stampFits).toBe(true);
      // Compare the same paused paint with/without ONLY the background layer.
      // This tests actual pixels without injecting domain or notice state.
      const focused = await page.screenshot();
      await page.locator('.discovery-vignette').evaluate(node => { node.getAnimations()[0].currentTime = 0; });
      const unshaded = await page.screenshot();
      await page.locator('.discovery-vignette').evaluate(node => { node.getAnimations()[0].currentTime = 1500; });
      const pixels = await page.evaluate(async ({ focused, unshaded, frame, bounds }) => {
        const decode = async source => {
          const img = new Image(); img.src = `data:image/png;base64,${source}`; await img.decode();
          const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
          const context = canvas.getContext('2d'); context.drawImage(img, 0, 0); return context;
        };
        const a = await decode(focused), b = await decode(unshaded);
        const sample = (context, x, y) => [...context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data];
        return { center: [a, b].map(context => sample(context, frame.x + frame.width / 2, frame.y + frame.height * .46)),
          edge: [a, b].map(context => sample(context, bounds.x + 8, bounds.y + bounds.height - 8)) };
      }, { focused: focused.toString('base64'), unshaded: unshaded.toString('base64'), frame: reading.frame, bounds: reading.bounds });
      expect(pixels.center[0]).toEqual(pixels.center[1]);
      expect(pixels.edge[0][0] + pixels.edge[0][1] + pixels.edge[0][2]).toBeLessThan(pixels.edge[1][0] + pixels.edge[1][1] + pixels.edge[1][2]);
      await page.clock.fastForward(1500); await expectClean(page);
      expect(await geometry()).toEqual(before);
      await page.screenshot({ path: info.outputPath(`${speciesId}-3000ms.png`) });
      const action = page.locator('#sell-catch'); if (touch) await action.tap(); else await action.click();
      await expect(page.locator('#catch-dialog')).toBeHidden();
      await page.clock.fastForward(10000); await expect(award(page)).toBeHidden();
      await info.attach(`${speciesId}-focus-geometry-and-pixels`, { body: JSON.stringify({ reading, pixels }), contentType: 'application/json' });
    }
  });
}

for (const { touch, ...viewport } of layouts) {
  test(`${viewport.width}x${viewport.height}: reduced motion, safe insets, large text and fixed transparent result controls`, async ({ createContext }, info) => {
    const context = await createContext({ viewport, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce' });
    const page = await context.newPage(); await setup(page);
    await page.addStyleTag({ content: 'html:root { --safe-top: 12px; --safe-right: 8px; --safe-bottom: 14px; --safe-left: 8px; font-size: 20px; }' });
    expect(await page.evaluate(() => ['top', 'right', 'bottom', 'left'].map(edge => getComputedStyle(document.documentElement).getPropertyValue(`--safe-${edge}`).trim()))).toEqual(['12px', '8px', '14px', '8px']);
    // A small Rare exercises the static sigil without also awarding length-100;
    // the existing single-award queue assertion below remains unchanged.
    await catchFish(page, 'peacock-bass');
    const root = discovery(page); await expect(root).toBeVisible();
    expect(await root.evaluate(root => root.getAnimations({ subtree: true }).length)).toBe(0);
    expect(await root.locator('.discovery-name').evaluate(el => getComputedStyle(el).opacity)).toBe('1');
    await expect(page.locator('.discovery-vignette')).toHaveCSS('opacity', '1');
    await expect(page.locator('.discovery-sigil')).toHaveAttribute('data-reduced-motion', 'true');
    expect(await page.locator('.discovery-sigil path').evaluateAll(paths => paths.map(path => getComputedStyle(path).opacity))).toEqual(['0.75', '0.75', '0.75']);
    expect(await page.locator('#catch-dialog').evaluate(dialog => dialog.getAnimations({ subtree: true }).length)).toBe(0);
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
    await expectClean(page);
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
    await expect(page.locator('.discovery-sigil')).toHaveCount(0);
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
