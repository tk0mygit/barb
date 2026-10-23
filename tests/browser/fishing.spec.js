import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { FISH_SPECIES, getFishSpecies, calculateFishWeightKg } from '../../src/game/fish-species.js';
import { getSpeciesProbabilities, sampleFishSpecies } from '../../src/game/fish-encounters.js';

// Keep software WebGL responsive while retaining CSS viewport/touch behavior.
test.use({ deviceScaleFactor: 0.5 });

// Controlled RNG and the real production build. No state-forcing hooks.
async function setup(page) {
  await page.addInitScript(() => { Math.random = () => window.testRandomValue ?? 0.5; });
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
  await expect(page.locator('#lure-picker')).toBeHidden();
  for (const button of await page.locator('#lure-picker button').all()) await expect(button).toBeDisabled();
  await input.down(); await input.move(300, 270);
  await expect(page.locator('#line-distance')).toContainText('着水予測 28.0 m');
  await input.up();
  await expect(phase(page)).toHaveAttribute('data-phase', 'lure');
}
async function hook(page, input, keepPaused = false) {
  // Software WebGL/CDP round trips can exceed the one-second hook window.
  // Advance the real game clock to the bite, then keep it still while sending
  // native pointer input. Do not extend the game's window or force its state.
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  for (let i = 0; i < 120 && await phase(page).getAttribute('data-phase') !== 'bite'; i++) await page.clock.fastForward(250);
  expect(await phase(page).getAttribute('data-phase')).toBe('bite');
  await input.tap();
  await page.clock.fastForward(16);
  await expect(phase(page)).toHaveAttribute('data-phase', 'fight');
  if (!keepPaused) await page.clock.resume();
}
async function assertCatch(page, speciesId, size = 0.5) {
  const species = getFishSpecies(speciesId);
  const length = Math.round((species.minLengthCm + size * (species.maxLengthCm - species.minLengthCm)) * 10) / 10;
  await expect(page.locator('#catch-dialog')).toBeVisible();
  await expect(page.locator('#catch-species')).toHaveText(species.name);
  await expect(page.locator('#catch-length')).toHaveText(`${length.toFixed(1)} cm`);
  await expect(page.locator('#catch-weight')).toHaveText(`${calculateFishWeightKg(species.id, length).toFixed(2)} kg`);
  await expect(page.locator('#catch-image')).toHaveAttribute('alt', `${species.name}の側面イラスト`);
  // Compare the loaded SVG, not just its alt text; Vite may inline small assets.
  const actual = await page.locator('#catch-image').evaluate(async img => {
    await img.decode();
    if (img.naturalWidth <= 0) throw new Error('Image did not load');
    return (await fetch(img.currentSrc)).text();
  });
  const normalize = svg => svg.replaceAll('"', "'").replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
  expect(normalize(actual)).toBe(normalize(readFileSync(new URL(species.image), 'utf8')));
}
async function land(page, input, speciesId) {
  let held = false;
  for (let i = 0; i < 140; i++) {
    const snapshot = await page.evaluate(() => ({ phase: document.querySelector('#fishing-panel').dataset.phase, tension: document.querySelector('#line-tension').value }));
    if (snapshot.phase !== 'fight') {
      if (snapshot.phase === 'landing') await page.screenshot({ path: `test-results/landing-${page.viewportSize().width}.png` });
      break;
    }
    const tension = snapshot.tension;
    if (!held && tension < 0.3) { await input.down(); held = true; }
    else if (held && tension > 0.58) { await input.up(); held = false; }
    await page.clock.fastForward(250);
  }
  if (held) await input.up();
  for (let i = 0; i < 5; i++) await page.clock.fastForward(250);
  await assertCatch(page, speciesId);
  await page.clock.resume();
}

for (const touch of [false, true]) {
  test(`${touch ? 'touch' : 'mouse'}: cancellation, missed hook, retry, flick, fight and catch result`, async ({ browser }) => {
    test.setTimeout(360000);
    const context = await browser.newContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1000, height: 700 }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 0.5 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await setup(page);
    const input = await inputFor(page, touch);
    await input.click(page.locator('#fish-button'));
    await expect(page.locator('#lure-picker button')).toHaveCount(4);
    for (const id of ['minnow', 'spinnerbait', 'crankbait', 'worm']) {
      await input.click(page.locator(`[data-lure-id="${id}"]`));
      await expect(page.locator(`[data-lure-id="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
    }
    const lureId = touch ? 'worm' : 'crankbait';
    await input.click(page.locator(`[data-lure-id="${lureId}"]`));
    await page.waitForTimeout(1000);
    await input.click(page.locator('#cast-button'));
    await input.down(); await input.move(300, 300); await input.cancel();
    if (!touch) await page.mouse.up();
    await expect(phase(page)).toHaveAttribute('data-phase', 'ready');
    await expect(page.locator(`[data-lure-id="${lureId}"]`)).toHaveAttribute('aria-pressed', 'true');
    await cast(page, input);
    await expect(page.locator('#return-button')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(phase(page)).toHaveAttribute('data-phase', 'lure');
    await input.down(); await page.waitForTimeout(400);
    await expect(page.locator('#reel-state')).toHaveText('巻き取り中');
    await input.cancel(); if (!touch) await page.mouse.up();
    await expect(page.locator('#reel-state')).toHaveText('待機中');
    // Bite/fight time is simulation time. Real-time waits can expire before
    // the dt-capped simulation progresses on a slow software GPU.
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
    for (let i = 0; i < 160 && await phase(page).getAttribute('data-phase') !== 'failed'; i++) await page.clock.fastForward(250);
    await expect(phase(page)).toHaveAttribute('data-phase', 'failed');
    for (let i = 0; i < 12 && await phase(page).getAttribute('data-phase') !== 'ready'; i++) await page.clock.fastForward(250);
    await expect(phase(page)).toHaveAttribute('data-phase', 'ready');
    await page.clock.resume();
    await expect(page.locator('#fishing-note')).toContainText('アワセ');
    await cast(page, input);
    // Installed Playwright clocks also virtualize Event.timeStamp. Keep time
    // still across the short native flick, then render its action explicitly.
    const flickPause = await page.evaluate(() => Date.now() + 60000);
    await page.clock.pauseAt(new Date(flickPause));
    await input.flick();
    await page.clock.fastForward(16);
    await expect(page.locator('#reel-state')).toHaveText('ルアーアクション');
    await hook(page, input, true);
    await expect(page.locator('#return-button')).toBeDisabled();
    await expect(page.locator('#lure-picker')).toBeHidden();
    const conditions = await page.locator('#fishing-conditions').evaluate(el => ({ depthM: Number(el.dataset.depthM), timeOfDay: el.dataset.timeOfDay }));
    await land(page, input, sampleFishSpecies(lureId, () => 0.5, conditions).id);
    const caughtName = await page.locator('#catch-species').textContent();
    const caughtLength = await page.locator('#catch-length').textContent();
    const caughtWeight = await page.locator('#catch-weight').textContent();
    await expect(page.locator('#menu-button')).toBeDisabled();
    await page.locator('#menu-button').evaluate(button => button.dispatchEvent(new MouseEvent('click')));
    await expect(page.locator('#collection-dialog')).toBeHidden();
    await page.screenshot({ path: `test-results/${touch ? 'mobile' : 'desktop'}-catch.png` });
    if (touch) await input.click(page.locator('#close-catch')); else await page.keyboard.press('Escape');
    await expect(page.locator('#catch-dialog')).toBeHidden();
    await expect(phase(page)).toHaveAttribute('data-phase', 'ready');
    await expect(page.locator('#lure-picker')).toBeVisible();
    await input.click(page.locator('#menu-button'));
    await input.click(page.locator('[data-view="encyclopedia"]'));
    await expect(page.locator('button.fish-card')).toHaveCount(1);
    await input.click(page.locator('button.fish-card'));
    await expect(page.locator('#collection-title')).toHaveText(caughtName);
    await expect(page.locator('.fish-detail')).toContainText('1匹');
    await expect(page.locator('.fish-detail')).toContainText(caughtLength);
    const fish = FISH_SPECIES.find(item => item.name === caughtName);
    await expect(page.locator('.fish-description')).toHaveText(fish.description);
    await expect(page.locator('.fish-detail')).toContainText(`${fish.basePricePerKg} 通貨/kg`);
    await input.click(page.locator('#collection-back')); await input.click(page.locator('#collection-back'));
    await input.click(page.locator('[data-view="storage"]'));
    await expect(page.locator('.stored-fish')).toHaveCount(1);
    await expect(page.locator('.stored-fish')).toContainText(caughtName);
    await expect(page.locator('.stored-fish')).toContainText(caughtLength);
    await expect(page.locator('.stored-fish')).toContainText(caughtWeight);
    await expect(page.locator('.stored-fish time')).toHaveAttribute('datetime', /T/);
    await page.screenshot({ path: `test-results/${touch ? 'mobile' : 'desktop'}-storage.png` });
    await input.click(page.locator('#collection-close'));
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
  await input.down();
  await page.waitForFunction(() => document.querySelector('#line-tension').value >= 0.3);
  // Sample before cancellation in the same browser turn: a slow automation
  // round trip may otherwise observe tension already relaxed to zero.
  const tension = await page.evaluate(() => {
    const value = document.querySelector('#line-tension').value;
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    return value;
  });
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
  for (const button of await page.locator('#lure-picker button').all()) {
    const bounds = await button.boundingBox();
    expect(bounds.y).toBeGreaterThan(0); expect(bounds.y + bounds.height).toBeLessThan(390);
    await button.tap(); await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
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

test('all 12 species: production cast, hook, fight, matching result image and recast', async ({ page }) => {
  // Twelve complete fights render hundreds of frames on software WebGL.
  test.setTimeout(600000);
  await page.setViewportSize({ width: 800, height: 600 });
  await setup(page); await page.locator('#fish-button').click();
  await expect(phase(page)).toHaveAttribute('data-phase', 'ready');
  // Advance one 250ms frame at a time (the production dt cap). This keeps the
  // full state machine/render/UI live without 12 long wall-clock bite waits.
  // Only clock and RNG are controlled; fish/state/catches are never injected.
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  const input = await inputFor(page, false);
  const tick = () => page.clock.fastForward(250);
  const snapshot = () => page.evaluate(() => ({ phase: document.querySelector('#fishing-panel').dataset.phase, tension: document.querySelector('#line-tension').value }));
  for (const [index, species] of FISH_SPECIES.entries()) {
    // Start alternating day/night phases through elapsed time, so a rollover
    // cannot change the probability interval in the middle of this cast.
    const timeOfDay = index % 2 ? 'night' : 'day';
    const progress = Number(await page.locator('#fishing-conditions').getAttribute('data-cycle-progress'));
    const targetProgress = index % 2 ? 0.5 : 0;
    await page.clock.fastForward(Math.ceil(((targetProgress - progress + 1) % 1) * 360000) + 250);
    await expect(page.locator('#fishing-conditions')).toHaveAttribute('data-time-of-day', timeOfDay);
    const lureId = ['minnow', 'crankbait', 'worm', 'spinnerbait'][index % 4];
    const entries = getSpeciesProbabilities(lureId, { depthM: 12, timeOfDay });
    const selectedIndex = entries.findIndex(entry => entry.speciesId === species.id);
    const roll = entries.slice(0, selectedIndex).reduce((sum, entry) => sum + entry.probability, 0) + entries[selectedIndex].probability / 2;
    await page.evaluate(() => { window.testRandomValue = 0.1; });
    await page.locator(`[data-lure-id="${lureId}"]`).click({ force: true });
    await page.locator('#cast-button').click({ force: true }); await tick();
    await input.down(450, 240); await input.move(450, 90); await input.up();
    for (let i = 0; i < 4; i++) await tick();
    expect((await snapshot()).phase).toBe('lure');
    await expect(page.locator('#fishing-conditions')).toHaveAttribute('data-depth-m', '12');
    await page.evaluate(value => { window.testRandomValue = value; }, roll);
    for (let i = 0; i < 24 && (await snapshot()).phase === 'lure'; i++) await tick();
    expect((await snapshot()).phase).toBe('bite');
    await input.tap(); await tick();
    expect((await snapshot()).phase).toBe('fight');
    let held = false;
    for (let i = 0; i < 100; i++) {
      const s = await snapshot();
      if (s.phase !== 'fight') break;
      if (!held && s.tension < 0.35) { await input.down(); held = true; }
      else if (held && s.tension > 0.65) { await input.up(); held = false; }
      await tick();
    }
    if (held) await input.up();
    expect((await snapshot()).phase).toBe('landing');
    for (let i = 0; i < 5; i++) await tick();
    await assertCatch(page, species.id, roll);
    if (index === 0) await page.locator('#catch-dialog').evaluate(dialog => dialog.close());
    else await page.locator('#close-catch').click({ force: true });
    await tick();
    expect((await snapshot()).phase).toBe('ready');
  }
  await page.locator('#menu-button').click({ force: true });
  await page.locator('[data-view="encyclopedia"]').click({ force: true });
  expect(await page.locator('.fish-card > span').allTextContents()).toEqual(FISH_SPECIES.map(fish => fish.name));
  await expect(page.locator('button.fish-card')).toHaveCount(12);
  await page.screenshot({ path: 'test-results/encyclopedia-discovered.png', animations: 'disabled' });
  await page.locator('#collection-back').click({ force: true });
  await page.locator('[data-view="storage"]').click({ force: true });
  await expect(page.locator('.stored-fish')).toHaveCount(12);
  expect(new Set(await page.locator('.stored-fish').evaluateAll(nodes => nodes.map(node => node.dataset.catchId))).size).toBe(12);
  const scroll = await page.locator('#collection-content').evaluate(el => { el.scrollTop = el.scrollHeight; return { top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight }; });
  expect(scroll.height).toBeGreaterThan(scroll.client); expect(scroll.top).toBeGreaterThan(0);
  await page.locator('#collection-close').click({ force: true });
  await page.clock.resume(); await page.reload(); await expect(page.locator('#status')).toBeHidden();
  await page.locator('#menu-button').click(); await page.locator('[data-view="storage"]').click();
  await expect(page.locator('.stored-fish')).toHaveCount(12);
  await page.locator('#collection-back').click(); await page.locator('[data-view="encyclopedia"]').click();
  expect(await page.locator('.fish-card > span').allTextContents()).toEqual(FISH_SPECIES.map(fish => fish.name));
});
