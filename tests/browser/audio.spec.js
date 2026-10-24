import { test, expect } from './diagnostics-fixture.js';
import { setup, tick } from './day-night-fixture.js';
import { installAudioProbe, audioSnapshot, soundScreen } from './audio-fixture.js';
import { createGameClock } from '../../src/game/game-clock.js';
import { sampleAudioMix } from '../../src/audio/audio-mix.js';

const key = 'barb.audio.preferences.v1';
test.use({ deviceScaleFactor: 0.5 });
const enabled = { version: 1, enabled: true, volume: 60 };
const prefs = async (page, value) => page.addInitScript(({ key, value }) => {
  if (!sessionStorage.getItem('audio-seeded')) { localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('audio-seeded', 'yes'); }
}, { key, value });
const close = page => page.locator('#collection-close').click();
const progress = page => page.locator('#fishing-conditions').getAttribute('data-cycle-progress').then(Number);
const assertMix = async page => {
  const seconds = (await progress(page)) * 360;
  const expected = sampleAudioMix(createGameClock(undefined, { elapsedSeconds: seconds }).state);
  // Match audio against the real surface-fog clock and optical amount.
  const denseFade = await page.evaluate(() => window.lightingProbe.denseFade ?? 0);
  expected.day *= 1 - denseFade; expected.night *= 1 - denseFade; expected.nature = denseFade;
  const actual = await audioSnapshot(page);
  expect(actual.sources).toBe(3);
  for (const kind of ['day', 'night', 'nature']) expect(actual.gains[kind]).toBeCloseTo(expected[kind], 6);
  return actual;
};

for (const size of [{ width: 1000, height: 700, touch: false }, { width: 320, height: 568, touch: true }, { width: 568, height: 320, touch: true }]) {
  test(`OFF default, explicit ON/volume, menu pause, restore and touch layout ${size.width}x${size.height}`, async ({ createContext }, info) => {
    const { touch, width, height } = size;
    const context = await createContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 0.5 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(installAudioProbe, {}); await setup(page, 90);
    expect((await audioSnapshot(page)).contexts).toBe(0);
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
    if (touch) await page.locator('#fish-button').tap(); else await page.locator('#fish-button').click();
    await tick(page);
    await soundScreen(page, touch); await tick(page);
    await expect(page.locator('#ambient-toggle')).toHaveText('BGM・自然音：OFF');
    expect((await audioSnapshot(page)).sources).toBe(0);
    const activate = locator => touch ? locator.tap() : locator.click();
    await activate(page.locator('#ambient-toggle'));
    await expect(page.locator('#ambient-status')).toContainText('一時停止中');
    const slider = page.locator('#ambient-volume'); await slider.scrollIntoViewIfNeeded();
    if (touch) {
      const box = await slider.boundingBox(); await page.touchscreen.tap(box.x + box.width * 0.7, box.y + box.height / 2);
    } else { await slider.focus(); await page.keyboard.press('End'); }
    const volume = Number(await slider.inputValue()); expect(volume).toBeGreaterThan(40); expect(volume).toBeLessThanOrEqual(100);
    await expect(slider).toHaveAttribute('aria-valuetext', `${volume}%`);
    await expect(page.locator('#audio-preferences-status')).toHaveText('音声設定を保存しました。');
    await page.locator('#ambient-toggle').scrollIntoViewIfNeeded();
    const path = info.outputPath('sound-settings.png'); await page.screenshot({ path }); await info.attach('sound-settings', { path, contentType: 'image/png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await activate(page.locator('#collection-close')); await tick(page);
    const playing = await assertMix(page); expect(playing.master).toBeCloseTo(0.3 * volume / 100); expect(playing.contexts).toBe(1);
    expect(playing.gestures.every(Boolean)).toBe(true);
    await soundScreen(page, touch); await tick(page); expect((await audioSnapshot(page)).sources).toBe(0);
    const clock = await progress(page); await page.clock.fastForward(600000); expect(await progress(page)).toBe(clock);
    await activate(page.locator('#ambient-toggle')); await tick(page);
    expect((await audioSnapshot(page)).sources).toBe(0);
    await expect(page.locator('#ambient-toggle')).toHaveAttribute('aria-pressed', 'false');
    await page.reload(); await tick(page); expect((await audioSnapshot(page)).contexts).toBe(0);
    await soundScreen(page, touch); await expect(page.locator('#ambient-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#ambient-volume')).toHaveValue(String(volume));
    expect(errors).toEqual([]);
  });
}

test('shared clock twilight/fog, long jumps, composed lifecycle stops and saved ON waits for a gesture', async ({ page }) => {
  await prefs(page, enabled); await page.addInitScript(installAudioProbe, {}); await setup(page, 170);
  expect((await audioSnapshot(page)).contexts).toBe(0);
  await page.locator('#fish-button').click(); await tick(page);
  let before = await assertMix(page); expect(before.contexts).toBe(1);
  for (const dt of [10000, 180000, 546000, 6000, 156000, 6000, 6000, 36000000 + 186000]) {
    await page.clock.fastForward(dt); await assertMix(page);
    expect((await audioSnapshot(page)).totalSources).toBe(3);
  }
  for (const reason of ['blur', 'hidden', 'page']) {
    before = await audioSnapshot(page); const clock = await progress(page);
    await page.evaluate(reason => {
      if (reason === 'blur') window.dispatchEvent(new Event('blur'));
      if (reason === 'hidden') { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
      if (reason === 'page') {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide'));
      }
    }, reason);
    await tick(page); expect((await audioSnapshot(page)).sources).toBe(0);
    await page.clock.fastForward(600000); expect(await progress(page)).toBe(clock);
    await page.evaluate(reason => {
      if (reason === 'blur') window.dispatchEvent(new Event('focus'));
      if (reason === 'hidden') { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }
      if (reason === 'page') {
        delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pageshow'));
      }
    }, reason);
    await tick(page); const after = await assertMix(page);
    expect(after.totalSources).toBe(before.totalSources + 3); expect(after.contexts).toBe(1); expect(after.resumes).toBe(1);
  }
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const slots = await page.evaluate(() => ['barb.save.v1.slotA', 'barb.save.v1.slotB'].map(k => JSON.parse(localStorage.getItem(k))).filter(Boolean));
  for (const slot of slots) { expect(slot.data.saveVersion).toBe(1); expect(slot.data.settings).toEqual({}); }
  const saved = slots.sort((a, b) => b.generation - a.generation)[0];
  await page.reload(); await tick(page); expect((await audioSnapshot(page)).contexts).toBe(0);
  await page.locator('#fish-button').click(); await tick(page); await assertMix(page);
  expect(await progress(page)).toBeCloseTo((saved.data.clock.elapsedSeconds + 0.5) % 360 / 360, 3);
  await page.locator('#scene').evaluate(canvas => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  expect((await audioSnapshot(page)).sources).toBe(0);
  expect(await page.evaluate(() => window.audioProbe.contexts[0].state)).toBe('closed');
});

test('rejection and mobile interruption are silent, visible, retryable and do not auto-resume on focus', async ({ page }) => {
  await prefs(page, enabled); await page.addInitScript(installAudioProbe, { reject: true }); await setup(page, 990);
  await page.locator('#fish-button').click(); await tick(page);
  await soundScreen(page); await tick(page);
  await expect(page.locator('#ambient-status')).toContainText('開始できませんでした');
  expect((await audioSnapshot(page)).sources).toBe(0);
  await page.evaluate(() => { window.audioProbe.reject = false; });
  await page.locator('#ambient-retry').click();
  await expect(page.locator('#ambient-status')).toContainText('一時停止中');
  await close(page); await tick(page); const playing = await assertMix(page); expect(playing.gains.nature).toBe(1);
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.audioProbe.contexts[0].change('interrupted'); });
  await tick(page); expect((await audioSnapshot(page)).sources).toBe(0);
  const resumes = (await audioSnapshot(page)).resumes;
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await tick(page);
  expect((await audioSnapshot(page)).resumes).toBe(resumes);
  // Programmatic menu navigation has no user activation; the retry itself does.
  await page.locator('#menu-button').evaluate(button => button.click());
  await page.locator('[data-view="sound"]').evaluate(button => button.click());
  await expect(page.locator('#ambient-status')).toContainText('中断');
  await page.locator('#ambient-retry').click(); await close(page); await tick(page); await assertMix(page);
  expect((await audioSnapshot(page)).contexts).toBe(1);
});

for (const scenario of ['invalid', 'read-denied', 'write-denied', 'unsupported']) {
  test(`preferences ${scenario}: safe UI, independent game save status`, async ({ page }) => {
    await page.addInitScript(installAudioProbe, { unsupported: scenario === 'unsupported' });
    await page.addInitScript(({ scenario, key }) => {
      if (scenario === 'invalid') localStorage.setItem(key, '{"version":1,"enabled":true,"volume":"99"}');
      const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
      Storage.prototype.getItem = function(k) { if (scenario === 'read-denied' && k === key) throw new DOMException('denied', 'SecurityError'); return get.call(this, k); };
      Storage.prototype.setItem = function(k, v) { if (scenario === 'write-denied' && k === key) throw new DOMException('full', 'QuotaExceededError'); return set.call(this, k, v); };
    }, { scenario, key });
    await setup(page, 90); await soundScreen(page);
    await expect(page.locator('#ambient-toggle')).toHaveAttribute('aria-pressed', 'false');
    if (scenario === 'invalid') await expect(page.locator('#audio-preferences-status')).toContainText('不正');
    if (scenario === 'read-denied') await expect(page.locator('#audio-preferences-status')).toContainText('読み込めません');
    const gameStatus = await page.locator('#save-status').textContent();
    await page.locator('#ambient-toggle').click();
    expect(await page.locator('#save-status').textContent()).toBe(gameStatus);
    if (scenario === 'write-denied') await expect(page.locator('#audio-preferences-status')).toContainText('保存できません');
    if (scenario === 'unsupported') await expect(page.locator('#ambient-status')).toContainText('対応していません');
    await close(page); await tick(page);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect(page.locator('#save-status')).not.toContainText('保存停止');
    expect(await page.evaluate(() => ['barb.save.v1.slotA', 'barb.save.v1.slotB'].map(key => JSON.parse(localStorage.getItem(key))).filter(Boolean).every(slot => slot.data.saveVersion === 1 && Object.keys(slot.data.settings).length === 0))).toBe(true);
    await expect(page.locator('#error')).toBeHidden();
  });
}

test('native Chromium AudioContext unlock and looping sources work through the production UI', async ({ page }) => {
  await page.addInitScript(installAudioProbe, { native: true }); await setup(page, 90, { freeze: false });
  expect(await page.evaluate(() => window.audioProbe.contexts.length)).toBe(0);
  await soundScreen(page); await page.locator('#ambient-toggle').click(); await close(page);
  await expect.poll(() => page.evaluate(() => window.audioProbe.nodes.length)).toBe(3);
  expect(await page.evaluate(() => ({ contexts: window.audioProbe.contexts.length, state: window.audioProbe.contexts[0].state,
    loops: window.audioProbe.nodes.every(n => n.loop && n.buffer?.duration === 24) })))
    .toEqual({ contexts: 1, state: 'running', loops: true });
});

for (const fail of [false, true]) {
  test(`bite notification retains timing and hook input with ambient ON (audio failure=${fail})`, async ({ page }) => {
    await prefs(page, enabled); await page.addInitScript(installAudioProbe, {}); await setup(page, 90);
    await page.locator('#fish-button').click(); await tick(page); await assertMix(page);
    await page.locator('#cast-button').click();
    await page.mouse.move(600, 400); await page.mouse.down(); await page.mouse.move(600, 250); await page.mouse.up();
    for (let i = 0; i < 4; i++) await tick(page);
    const phase = page.locator('#fishing-panel'); await expect(phase).toHaveAttribute('data-phase', 'lure');
    await page.evaluate(fail => { window.audioProbe.failGain = fail; }, fail);
    for (let i = 0; i < 120 && await phase.getAttribute('data-phase') !== 'bite'; i++) await tick(page);
    await expect(phase).toHaveAttribute('data-phase', 'bite');
    const notification = await page.evaluate(() => {
      const oscillator = window.audioProbe.nodes.find(n => n.type === 'oscillator');
      return { count: window.audioProbe.nodes.filter(n => n.type === 'oscillator').length,
        pitch: oscillator?.frequency.value, stopped: oscillator?.stopped };
    });
    expect(notification.count).toBe(1);
    if (!fail) { expect(notification.pitch).toBe(1320); expect(notification.stopped).toBe(true); }
    await page.mouse.down(); await page.mouse.up(); await page.clock.fastForward(16);
    await expect(phase).toHaveAttribute('data-phase', 'fight');
    await expect(page.locator('#error')).toBeHidden();
  });
}

for (const [seconds, mode, bgm, nature] of [[270, '夜のBGM', 1, 0], [2790, '霧の夜のBGM', 1, 0], [630, '濃霧の自然音', 0, 1]]) {
  test(`optical fog at ${seconds}s: ${mode}, independent settings and notification context`, async ({ page }) => {
    await prefs(page, enabled); await page.addInitScript(installAudioProbe, {}); await setup(page, seconds);
    expect((await audioSnapshot(page)).contexts).toBe(0);
    await page.locator('#fish-button').click(); await tick(page);
    const actual = await assertMix(page);
    expect(actual.gains.night).toBe(bgm); expect(actual.gains.nature).toBe(nature);
    await soundScreen(page); await expect(page.locator('#ambient-mode')).toHaveText(`現在の環境：${mode}`);
    expect((await audioSnapshot(page)).contexts).toBe(1);
    await close(page); await tick(page); await assertMix(page);
    expect((await audioSnapshot(page)).contexts).toBe(1);
  });
}
