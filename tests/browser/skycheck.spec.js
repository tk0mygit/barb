import { test, expect } from './diagnostics-fixture.js';
import { setup, tick, read, assertEnvironment } from './day-night-fixture.js';
import { observeRenderer, separated, fishingInput } from './mobile-capture.js';
import { installAudioProbe, audioSnapshot } from './audio-fixture.js';
import { createGameClock } from '../../src/game/game-clock.js';
import { sampleAudioMix } from '../../src/audio/audio-mix.js';
import { getNightFogProfile } from '../../src/world/night-fog.js';
import { serializeSaveData } from '../../src/game/save-data.js';

const key = 'barb.play.preferences.v1';
const button = page => page.locator('#day-night-skip');
const activate = (locator, touch = false) => touch ? locator.tap() : locator.click();
const slots = page => page.evaluate(() => ['barb.save.v1.slotA', 'barb.save.v1.slotB'].map(k => localStorage.getItem(k)));
const latestSave = async page => (await slots(page)).filter(Boolean).map(JSON.parse).sort((a, b) => b.generation - a.generation)[0].data;
const profiles = [
  { name: 'PC', viewport: { width: 1000, height: 700 }, touch: false },
  { name: 'touch portrait', viewport: { width: 390, height: 844 }, touch: true },
  { name: 'touch landscape', viewport: { width: 568, height: 320 }, touch: true },
];
let pageErrors;
test.beforeEach(() => { pageErrors = []; });
test.afterEach(() => { expect(pageErrors).toEqual([]); });

async function boot(page, seconds = 90, { enabled = true, audio = false, observeFailure = false } = {}) {
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(({ key, enabled, audio }) => {
    if (!sessionStorage.getItem('skycheck-seeded')) {
      if (enabled) localStorage.setItem(key, JSON.stringify({ version: 1, dayNightSkip: true }));
      if (audio) localStorage.setItem('barb.audio.preferences.v1', JSON.stringify({ version: 1, enabled: true, volume: 60 }));
      sessionStorage.setItem('skycheck-seeded', 'yes');
    }
  }, { key, enabled, audio });
  if (audio) await page.addInitScript(installAudioProbe, {});
  await observeRenderer(page);
  if (observeFailure) await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(window, '__THREE_DEVTOOLS__');
    Object.defineProperty(window, '__THREE_DEVTOOLS__', { configurable: true, get: descriptor.get,
      set(value) {
        descriptor.set(value);
        value.addEventListener('observe', ({ detail: renderer }) => {
          if (!renderer.isWebGLRenderer) return;
          const render = renderer.render;
          renderer.render = function(...args) {
            if (window.skycheckFailFrame) throw new Error('test-only render failure');
            return render.apply(this, args);
          };
        });
      },
    });
  });
  await setup(page, seconds);
}

async function playScreen(page, touch = false) {
  await activate(page.locator('#menu-button'), touch);
  await activate(page.locator('[data-view="settings"]'), touch);
  await expect(page.locator('#collection-title')).toHaveText('設定');
  await activate(page.locator('[data-view="play"]'), touch);
  await expect(page.locator('#collection-title')).toHaveText('プレイ設定');
}

async function assertIcon(page, target) {
  await expect(button(page)).toHaveAccessibleName(target === 'night' ? '夜まで進める' : '昼まで進める');
  await expect(button(page)).toHaveText('');
  await expect(button(page)).not.toHaveAttribute('title');
  await expect(button(page).locator(`[data-skip-icon="${target === 'night' ? 'moon' : 'sun'}"]`)).toBeVisible();
  await expect(button(page).locator(`[data-skip-icon="${target === 'night' ? 'sun' : 'moon'}"]`)).toBeHidden();
}

for (const profile of profiles) {
  test(`${profile.name}: settings hierarchy, native parent focus, audio preservation and reload`, async ({ createContext }) => {
    const context = await createContext({ viewport: profile.viewport, hasTouch: profile.touch,
      isMobile: profile.touch, deviceScaleFactor: .5, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await boot(page, 90, { enabled: false, audio: true });
    await expect(button(page)).toBeHidden();
    const original = await slots(page);
    await playScreen(page, profile.touch);
    await expect(page.locator('#day-night-skip-toggle')).toHaveText('昼夜スキップ：オフ');
    await expect(page.locator('#day-night-skip-toggle')).toHaveAttribute('aria-pressed', 'false');
    await activate(page.locator('#day-night-skip-toggle'), profile.touch);
    await expect(page.locator('#day-night-skip-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect(await button(page).evaluate(el => el.hidden)).toBe(false);
    await activate(page.locator('#collection-back'), profile.touch);
    await expect(page.locator('[data-view="play"]')).toBeFocused();
    await activate(page.locator('[data-view="sound"]'), profile.touch);
    await expect(page.locator('#ambient-toggle')).toHaveText('BGM・自然音：ON');
    await expect(page.locator('#ambient-volume')).toHaveValue('60');
    await activate(page.locator('#collection-back'), profile.touch);
    await expect(page.locator('[data-view="sound"]')).toBeFocused();
    await activate(page.locator('#collection-back'), profile.touch);
    await expect(page.locator('[data-view="settings"]')).toBeFocused();
    await expect(page.locator('#collection-title')).toHaveText('湖の記録');
    expect(await slots(page)).toEqual(original);
    await page.keyboard.press('Escape');
    await expect(page.locator('#scene')).toBeFocused();
    await expect(button(page)).toBeVisible();
    await playScreen(page, profile.touch);
    await activate(page.locator('#day-night-skip-toggle'), profile.touch);
    expect(await button(page).evaluate(el => el.hidden)).toBe(true);
    await activate(page.locator('#day-night-skip-toggle'), profile.touch);
    await page.reload(); await tick(page);
    await expect(button(page)).toBeVisible();
    await playScreen(page, profile.touch);
    await expect(page.locator('#day-night-skip-toggle')).toHaveText('昼夜スキップ：オン');
    expect(await page.evaluate(() => document.querySelectorAll('dialog[open]').length)).toBe(1);
    await page.keyboard.press('Escape'); await expect(page.locator('#scene')).toBeFocused();
  });

  test(`${profile.name}: 10-second boundary, icon-only layout, all input blocked and fresh controls restored`, async ({ createContext }, info) => {
    const context = await createContext({ viewport: profile.viewport, hasTouch: profile.touch,
      isMobile: profile.touch, deviceScaleFactor: .5, reducedMotion: 'reduce' });
    const page = await context.newPage(); await boot(page, 0);
    await page.addStyleTag({ content: ':root { --safe-top: 8px; --safe-right: 12px; --safe-bottom: 8px; --safe-left: 12px; }' });
    await assertIcon(page, 'night');
    const rects = await page.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      return { skip: box('#day-night-skip'), header: box('.masthead'), actions: box('.action-panel'), compass: box('.compass') };
    });
    expect(rects.skip.width).toBe(44); expect(rects.skip.height).toBe(44);
    expect(rects.skip.left).toBeGreaterThanOrEqual(12); expect(rects.skip.top).toBeGreaterThanOrEqual(8);
    expect(rects.skip.right).toBeLessThanOrEqual(profile.viewport.width - 12);
    expect(rects.skip.bottom).toBeLessThanOrEqual(profile.viewport.height - 8);
    for (const other of [rects.header, rects.actions, rects.compass]) expect(separated(rects.skip, other)).toBe(true);
    await page.screenshot({ path: info.outputPath('skycheck-layout.png'), scale: 'css' });
    const before = await read(page), camera = await page.evaluate(() => window.mobileProbe.camera);
    const checkpoint = JSON.parse(serializeSaveData(await latestSave(page)));
    await activate(button(page), profile.touch);
    await expect(page.locator('#app')).toHaveAttribute('data-time-skipping', 'true');
    await expect(button(page)).toBeDisabled(); await expect(button(page)).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#menu-button')).toBeDisabled(); await expect(page.locator('#fish-button')).toBeDisabled();
    // Deliberately invalid target events are separate from the native inputs.
    for (const selector of ['#day-night-skip', '#menu-button', '#fish-button', '#return-button', '#cast-button']) {
      await page.locator(selector).dispatchEvent('click');
    }
    await page.keyboard.down('w'); await page.keyboard.press('Escape'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
    if (profile.touch) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 230, y: 190 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 270, y: 100 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(600, 350); await page.mouse.down(); await page.mouse.move(700, 250); await page.mouse.up();
    }
    const menuBox = await page.locator('#menu-button').boundingBox();
    await page.mouse.click(menuBox.x + menuBox.width / 2, menuBox.y + menuBox.height / 2);
    await page.clock.fastForward(1000);
    const middle = await read(page);
    expect(middle.mistTime - before.mistTime).toBeGreaterThan(17);
    expect(middle.mistTime - before.mistTime).toBeLessThanOrEqual(18);
    assertEnvironment(middle, middle.mistTime);
    expect(middle.boat).toEqual(before.boat); expect(middle.boatSpeed).toBe(0); expect(middle.waterTime).toBe(before.waterTime);
    expect(await page.evaluate(() => window.mobileProbe.camera)).toEqual(camera);
    await expect(page.locator('#collection-dialog')).toBeHidden(); await expect(page.locator('#catch-dialog')).toBeHidden();
    await expect(page.locator('#joystick')).toBeHidden(); await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'inactive');
    for (let i = 0; i < 9; i++) await page.clock.fastForward(1000);
    await expect(page.locator('#app')).toHaveAttribute('data-time-skipping', 'false');
    expect((await read(page)).mistTime).toBe(180);
    await assertIcon(page, 'day'); await expect(button(page)).toBeEnabled(); await expect(page.locator('#scene')).toBeFocused();
    await page.keyboard.down('w'); await tick(page); // repeated held key still cannot sail
    await expect(page.locator('#motion-label')).toHaveText('停船中');
    expect((await read(page)).boat).toEqual(before.boat);
    await page.keyboard.up('w'); await page.keyboard.down('w'); await tick(page);
    await expect(page.locator('#motion-label')).toHaveText('航行中'); await expect(button(page)).toBeDisabled();
    const normalStart = (await read(page)).mistTime;
    await button(page).dispatchEvent('click'); await tick(page);
    expect((await read(page)).mistTime - normalStart).toBeCloseTo(.25, 1);
    await page.keyboard.up('w');
    await expect.poll(async () => { await tick(page); return page.locator('#motion-label').textContent(); }).toBe('停船中');
    await activate(page.locator('#fish-button'), profile.touch); await tick(page);
    await expect(button(page)).toBeHidden();
    await button(page).dispatchEvent('click'); await tick(page);
    await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'ready');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    const saved = await latestSave(page);
    expect(saved.settings).toEqual({}); expect(saved.collection).toEqual(checkpoint.collection); expect(saved.achievements).toEqual(checkpoint.achievements);
    await info.attach('skip-input-environment', { body: Buffer.from(JSON.stringify({ before, middle, camera, rects, saved }, null, 2)), contentType: 'application/json' });
  });
}

test.use({ deviceScaleFactor: .5 });

for (const reason of ['blur', 'hidden', 'pagehide']) {
  test(`${reason}: cancel immediately, do not bank inactive time, require another explicit skip`, async ({ page }) => {
    await boot(page, 90); await button(page).click(); await tick(page);
    const at = (await read(page)).mistTime;
    await page.evaluate(reason => {
      if (reason === 'hidden') { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
      else window.dispatchEvent(new Event(reason));
    }, reason);
    await expect(page.locator('#app')).toHaveAttribute('data-time-skipping', 'false');
    await expect(button(page)).toBeDisabled();
    await page.clock.fastForward(600000); expect((await read(page)).mistTime).toBe(at);
    await page.evaluate(reason => {
      if (reason === 'hidden') { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }
      else window.dispatchEvent(new Event(reason === 'blur' ? 'focus' : 'pageshow'));
    }, reason);
    await tick(page);
    const resumed = (await read(page)).mistTime;
    expect(resumed - at).toBeCloseTo(.25, 1);
    await expect(button(page)).toBeEnabled();
    await button(page).click(); await page.clock.fastForward(10000);
    expect((await read(page)).mistTime).toBe(180);
    await expect(page.locator('#app')).toHaveAttribute('data-time-skipping', 'false');
  });
}

test('mid-skip reload preserves the actual clock and toggle, resumes at 1x with the same environment', async ({ page }) => {
  await boot(page, 4 * 360 + 220); await button(page).click(); await tick(page);
  const before = await read(page);
  await page.reload(); await tick(page);
  const saved = await latestSave(page), restored = await read(page);
  expect(saved.clock.elapsedSeconds % 3600).toBeCloseTo(before.mistTime, 7);
  expect(restored.mistTime - before.mistTime).toBeCloseTo(.25, 1);
  assertEnvironment(restored, restored.mistTime);
  await expect(button(page)).toBeEnabled(); await assertIcon(page, 'day');
  await expect(button(page)).toHaveAttribute('aria-busy', 'false');
  expect(saved.settings).toEqual({});
});

test('context loss safely releases the skip and leaves every game action unavailable', async ({ page }) => {
  await boot(page); await button(page).click(); await tick(page);
  const before = await read(page);
  await page.locator('#scene').dispatchEvent('webglcontextlost', { cancelable: true });
  await expect(page.locator('#error')).toContainText('描画が中断');
  await expect(page.locator('#app')).toHaveAttribute('data-time-skipping', 'false');
  await expect(button(page)).toBeHidden(); await expect(page.locator('#menu-button')).toBeDisabled(); await expect(page.locator('#fish-button')).toBeDisabled();
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
  await expect(button(page)).toBeHidden(); await expect(page.locator('#fish-button')).toBeDisabled();
  await page.clock.fastForward(600000); expect(await read(page)).toEqual(before);
});

test('a native dialog opening race cancels the skip before the next clock update', async ({ page }) => {
  await boot(page); await button(page).click(); await tick(page);
  const at = (await read(page)).mistTime;
  await page.locator('#collection-dialog').evaluate(dialog => dialog.showModal());
  await tick(page);
  await expect(page.locator('#app')).toHaveAttribute('data-time-skipping', 'false');
  await page.clock.fastForward(600000); expect((await read(page)).mistTime).toBe(at);
  await page.locator('#collection-dialog').evaluate(dialog => dialog.close()); await tick(page);
  expect((await read(page)).mistTime - at).toBeCloseTo(.25, 1);
  await expect(button(page)).toBeEnabled();
});

const nights = new Map();
for (let index = 0; nights.size < 3; index++) if (!nights.has(getNightFogProfile(index).fogType)) nights.set(getNightFogProfile(index).fogType, index);
test.describe('environment samples', () => {
test.use({ deviceScaleFactor: 1 });
for (const [type, index] of nights) {
  test(`${type}: intermediate normal rendering/audio, night-to-day boundary and stable GPU allocation`, async ({ page }) => {
    // Standard DPR for environmental samples; the control tests alone lower it.
    const start = index * 360 + 220;
    await boot(page, start, { audio: true });
    await button(page).click();
    const resources = await page.evaluate(() => window.mobileProbe.resources);
    const samples = [];
    for (let i = 0; i < 4; i++) {
      await tick(page);
      const actual = await read(page); samples.push(actual);
      assertEnvironment(actual, actual.mistTime);
      const expected = sampleAudioMix(createGameClock(undefined, { elapsedSeconds: actual.mistTime }).state), audio = await audioSnapshot(page);
      expect(audio.sources).toBe(3);
      for (const kind of ['day', 'night', 'nature']) expect(audio.gains[kind]).toBeCloseTo(expected[kind], 6);
      const current = await page.evaluate(() => window.mobileProbe.resources);
      for (const field of ['geometries', 'textures', 'programs']) expect(current[field]).toBe(resources[field]);
    }
    expect(new Set(samples.map(sample => sample.mistTime)).size).toBe(4);
    await page.clock.fastForward(9000);
    expect((await read(page)).mistTime).toBe((index + 1) * 360 % 3600);
    await assertIcon(page, 'night'); await expect(button(page)).toBeEnabled();
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    expect((await latestSave(page)).clock.elapsedSeconds).toBe((index + 1) * 360);
  });
}
});

test('a render exception cancels the skip, clears inert state and stops the failed renderer', async ({ page }) => {
  await boot(page, 90, { observeFailure: true }); await button(page).click(); await tick(page);
  await page.evaluate(() => { window.skycheckFailFrame = true; }); await tick(page);
  await expect(page.locator('#error')).toContainText('描画が中断');
  await expect(page.locator('#app')).toHaveAttribute('data-time-skipping', 'false');
  expect(await page.locator('#scene').evaluate(canvas => canvas.inert)).toBe(false);
  await expect(page.locator('#menu-button')).toBeDisabled(); await expect(button(page)).toBeHidden();
  const before = await read(page); await page.clock.fastForward(600000); expect(await read(page)).toEqual(before);
});

test('a sub-second skip cannot chain through a double click or a held activation key', async ({ page }) => {
  await boot(page, 179); await button(page).focus();
  await page.keyboard.down('Space'); await page.keyboard.up('Space'); await tick(page);
  expect((await read(page)).mistTime).toBe(180); await assertIcon(page, 'day');
  await button(page).dispatchEvent('click', { detail: 2 });
  await page.keyboard.down('Space'); await tick(page); await page.keyboard.down('Space'); await tick(page);
  await expect(page.locator('#app')).toHaveAttribute('data-time-skipping', 'false');
  expect((await read(page)).mistTime).toBeCloseTo(180.5, 1);
  await page.keyboard.up('Space'); await button(page).click(); await tick(page);
  await expect(page.locator('#app')).toHaveAttribute('data-time-skipping', 'true');
});

test('storage corruption and quota/security failures default OFF while session toggles remain usable', async ({ page }) => {
  await page.addInitScript(key => {
    localStorage.setItem(key, '{"version":1,"dayNightSkip":"true"}');
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) { if (name === key) throw new DOMException('full', 'QuotaExceededError'); return write.call(this, name, value); };
  }, key);
  await boot(page, 90, { enabled: false });
  await expect(button(page)).toBeHidden();
  const before = await slots(page);
  await playScreen(page); await page.locator('#day-night-skip-toggle').click();
  await expect(page.locator('#day-night-skip-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#collection-close').click(); await expect(button(page)).toBeVisible();
  expect(await slots(page)).toEqual(before);
  await page.reload(); await tick(page); await expect(button(page)).toBeHidden();
  expect(await page.evaluate(() => document.querySelector('#error').hidden)).toBe(true);
});

test('another tab synchronizes ON/OFF, invalid values and removal immediately without game-save writes', async ({ page, context }) => {
  await boot(page, 90, { enabled: false });
  const other = await context.newPage();
  // Same-origin blank resource avoids starting a second game/autosave owner.
  await other.route('**/barb/preferences-peer.html', route => route.fulfill({ body: '<!doctype html><title>preferences peer</title>', contentType: 'text/html' }));
  await other.goto('./preferences-peer.html');
  const before = await slots(page);
  await other.evaluate(key => localStorage.setItem(key, JSON.stringify({ version: 1, dayNightSkip: true })), key);
  await expect(button(page)).toBeVisible();
  await page.bringToFront(); await button(page).click(); await tick(page);
  await other.evaluate(key => localStorage.setItem(key, JSON.stringify({ version: 1, dayNightSkip: false })), key);
  await expect(button(page)).toBeHidden(); await expect(page.locator('#app')).toHaveAttribute('data-time-skipping', 'false');
  await other.evaluate(key => localStorage.setItem(key, JSON.stringify({ version: 1, dayNightSkip: true })), key);
  await expect(button(page)).toBeVisible();
  await other.evaluate(key => localStorage.setItem(key, 'broken'), key); await expect(button(page)).toBeHidden();
  await other.evaluate(key => localStorage.removeItem(key), key); await expect(button(page)).toBeHidden();
  expect(await slots(page)).toEqual(before);
});

test('localStorage access SecurityError leaves the game playable and settings usable for the session', async ({ page }) => {
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { configurable: true,
    get() { throw new DOMException('denied', 'SecurityError'); } }));
  // This path cannot seed a game save; exercise the ordinary new-game boot.
  await page.goto('./'); await expect(page.locator('#status')).toBeHidden(); await expect(page.locator('#error')).toBeHidden();
  await expect(button(page)).toBeHidden(); await playScreen(page);
  await page.locator('#day-night-skip-toggle').click(); await page.locator('#collection-close').click();
  await expect(button(page)).toBeVisible(); await expect(button(page)).toBeEnabled();
  await playScreen(page); await page.locator('#day-night-skip-toggle').click(); await page.locator('#collection-close').click();
  await expect(button(page)).toBeHidden(); await expect(page.locator('#fish-button')).toBeEnabled();
});

test('preparation/aim/bite/fight and QTE cannot start a skip or receive an 18x frame', async ({ page }) => {
  await boot(page); await page.locator('#fish-button').click(); await tick(page);
  await page.locator('#cast-button').click();
  await expect(page.locator('#app')).toHaveAttribute('data-cast-preparing', 'true');
  await button(page).dispatchEvent('click'); await tick(page);
  await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'aim');
  await button(page).dispatchEvent('click'); await page.locator('#cancel-cast').click(); await tick(page);
  const input = await fishingInput(page, false);
  await input.bite(); await button(page).dispatchEvent('click');
  await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'bite');
  await input.hook();
  await expect(button(page)).toBeHidden();
  const at = (await read(page)).mistTime;
  await button(page).dispatchEvent('click'); await tick(page);
  expect((await read(page)).mistTime - at).toBeCloseTo(.25, 1);
  await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'fight');
  await expect(button(page)).toHaveAttribute('aria-busy', 'false');
});
