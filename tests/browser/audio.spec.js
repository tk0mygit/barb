import { test, expect } from './diagnostics-fixture.js';
import { setup, tick } from './day-night-fixture.js';
import { installAudioProbe, audioSnapshot, attachAudioDiagnostics, soundScreen } from './audio-fixture.js';
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

for (const touch of [false, true]) {
  test(`${touch ? 'touch' : 'mouse'}: pending resume is retried by a real button click; late results cannot replace running playback`, async ({ createContext }, info) => {
    const context = await createContext({ viewport: { width: 390, height: 844 }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 0.5 });
    const page = await context.newPage();
    await prefs(page, enabled); await page.addInitScript(installAudioProbe, { pending: true }); await setup(page, 90);
    const activate = locator => touch ? locator.tap() : locator.click();
    try {
      await soundScreen(page, touch);
      await expect(page.locator('#ambient-status')).toContainText('音声を開始しています');
      await expect(page.locator('#ambient-retry')).toBeVisible();
      const waiting = await audioSnapshot(page);
      expect(waiting.states).toEqual(['suspended']); expect(waiting.sources).toBe(0);
      expect(waiting.attempts.length).toBeGreaterThan(1);
      expect(waiting.attempts.every(attempt => attempt.status === 'pending' && attempt.active)).toBe(true);
      // A preference change must not allow an old completion to resurrect OFF.
      await activate(page.locator('#ambient-toggle'));
      await expect(page.locator('#ambient-status')).toHaveText('OFF');
      await page.evaluate(() => window.audioProbe.attempts[0].resolve());
      await expect(page.locator('#ambient-status')).toHaveText('OFF');
      expect((await audioSnapshot(page)).sources).toBe(0);
      await activate(page.locator('#ambient-toggle'));
      await expect(page.locator('#ambient-status')).toContainText('音声を開始しています');
      const pendingResumes = (await audioSnapshot(page)).resumes;
      await activate(page.locator('#ambient-retry'));
      await expect(page.locator('#ambient-status')).toContainText('音声を開始しています');
      await expect(page.locator('#ambient-retry')).toBeVisible();
      expect((await audioSnapshot(page)).resumes).toBe(pendingResumes + 1);
      const oldAttempts = (await audioSnapshot(page)).attempts.filter(attempt => attempt.status === 'pending').map(attempt => attempt.id);
      const beforeRetry = (await audioSnapshot(page)).resumes;
      await page.evaluate(() => { window.audioProbe.pending = false; });
      await activate(page.locator('#ambient-retry'));
      await expect(page.locator('#ambient-status')).toContainText('一時停止中');
      const retried = await audioSnapshot(page);
      expect(retried.resumes).toBe(beforeRetry + 1); expect(retried.states).toEqual(['running']);
      expect(await page.evaluate(() => window.audioProbe.events.some(event => event.type === 'click' && event.target === 'ambient-retry' && event.trusted))).toBe(true);
      await page.evaluate(ids => ids.forEach((id, index) => {
        const attempt = window.audioProbe.attempts[id];
        if (index % 2) attempt.resolve(); else attempt.reject();
      }), oldAttempts);
      await expect(page.locator('#ambient-status')).toContainText('一時停止中');
      await activate(page.locator('#collection-close')); await tick(page);
      const playing = await audioSnapshot(page);
      expect(playing.gains).toEqual({ day: 1, night: 0, nature: 0 });
      expect(playing.states).toEqual(['running']); expect(playing.startedSources).toBe(3);
      expect(playing.gainNodes).toBe(4); expect(playing.destinationConnected).toBe(true);
      expect(playing.totalSources).toBe(3); expect(playing.buffers).toBe(3);
      await soundScreen(page, touch);
      await expect(page.locator('#ambient-status')).toContainText('一時停止中');
      await expect(page.locator('#ambient-retry')).toBeHidden();
    } finally { await attachAudioDiagnostics(page, info); }
  });

  test(`${touch ? 'touch' : 'mouse'}: a visible trusted interaction clears stale startup blur without a focus event`, async ({ createContext }, info) => {
    const context = await createContext({ viewport: { width: 390, height: 844 }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 0.5 });
    const page = await context.newPage();
    await prefs(page, enabled); await page.addInitScript(installAudioProbe, {});
    await page.addInitScript(() => {
      Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false });
      // Model the missing window-focus notification reported by some mobile hosts.
      window.addEventListener('focus', event => { if (event.target === window) event.stopImmediatePropagation(); }, true);
    });
    const startup = setup(page, 90);
    try {
      await page.waitForURL('**/barb/');
      await expect(page.locator('#fish-button')).toBeEnabled();
      expect((await audioSnapshot(page)).contexts).toBe(0);
      const clock = () => page.evaluate(() => window.lightingProbe.last.mistTime);
      const before = await clock();
      await page.clock.fastForward(600000); expect(await clock()).toBe(before);
      // The first game update also dismisses the startup overlay, so perform
      // this real input before setup's normal ready assertion can complete.
      if (touch) await page.locator('#fish-button').tap(); else await page.locator('#fish-button').click();
      await tick(page); await startup;
      expect(await clock()).toBeGreaterThan(before); expect(await clock()).toBeLessThan(before + 1);
      await soundScreen(page, touch);
      await expect(page.locator('#ambient-status')).toContainText('一時停止中');
      const menuClock = await clock();
      await page.clock.fastForward(600000); expect(await clock()).toBe(menuClock);
      if (touch) await page.locator('#collection-close').tap(); else await close(page);
      await tick(page); const playing = await audioSnapshot(page);
      expect(playing.gains).toEqual({ day: 1, night: 0, nature: 0 });
      expect(playing.states).toEqual(['running']); expect(playing.startedSources).toBe(3);
      expect(playing.resumes).toBe(1);
      expect(await clock()).toBeGreaterThan(menuClock); expect(await clock()).toBeLessThan(menuClock + 1);
    } finally { await attachAudioDiagnostics(page, info); }
  });

  test(`native Chromium ${touch ? 'touch' : 'mouse'}: activation event order and the complete production output graph`, async ({ createContext }, info) => {
    const context = await createContext({ viewport: { width: 390, height: 844 }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 0.5 });
    const page = await context.newPage();
    await page.addInitScript(installAudioProbe, { native: true });
    const cdp = await context.newCDPSession(page);
    const inspect = async fn => {
      const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
        expression: `(${fn.toString()})()`, returnByValue: true, userGesture: false,
      });
      if (exceptionDetails) throw Error(exceptionDetails.text);
      return result.value;
    };
    try {
      // Playwright page.evaluate grants a synthetic user gesture. This case
      // avoids the shared setup's evaluations and inspects through CDP without
      // activation until the first native input.
      await page.goto('./');
      await expect.poll(() => inspect(() => document.querySelector('#status').hidden)).toBe(true);
      // Trace/readiness tooling can activate Chromium's page. Wait for its
      // actual transient-activation expiry without invoking page.evaluate.
      await expect.poll(() => inspect(() => ({ contexts: window.audioProbe.contexts.length, active: navigator.userActivation.isActive })))
        .toEqual({ contexts: 0, active: false });
      const button = await inspect(() => {
        const button = document.querySelector('#menu-button'), box = button.getBoundingClientRect();
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        return { x, y, enabled: !button.disabled, visible: box.width > 0 && box.height > 0,
          hit: document.elementFromPoint(x, y)?.closest('button')?.id };
      });
      expect(button.enabled).toBe(true); expect(button.visible).toBe(true); expect(button.hit).toBe('menu-button');
      if (touch) await page.touchscreen.tap(button.x, button.y); else await page.mouse.click(button.x, button.y);
      if (touch) await page.locator('[data-view="sound"]').tap(); else await page.locator('[data-view="sound"]').click();
      if (touch) await page.locator('#ambient-toggle').tap(); else await page.locator('#ambient-toggle').click();
      await expect(page.locator('#ambient-status')).toContainText('一時停止中');
      if (touch) await page.locator('#collection-close').tap(); else await close(page);
      await expect.poll(async () => {
        const output = await audioSnapshot(page);
        return { states: output.states, sources: output.startedSources, gains: output.gainNodes, destination: output.destinationConnected,
          masterPositive: output.master > 0 };
      }).toEqual({ states: ['running'], sources: 3, gains: 4, destination: true, masterPositive: true });
      const output = await audioSnapshot(page);
      expect(output.contexts).toBe(1); expect(output.buffers).toBe(3);
      expect(output.attempts.every(attempt => attempt.active && attempt.status === 'resolved')).toBe(true);
      const construction = await page.evaluate(() => window.audioProbe.events.find(event => event.type === 'context-created'));
      expect(construction.active).toBe(true);
      const firstInput = output.attempts[0]?.input ?? construction.input;
      expect(['pointerdown', 'click', 'pointerup']).toContain(firstInput);
      const menuEvents = await page.evaluate(() => window.audioProbe.events.filter(event => event.target === 'menu-button'));
      const order = menuEvents.map(event => event.type);
      expect(order.indexOf('pointerdown')).toBeLessThan(order.indexOf('pointerup'));
      expect(order.indexOf('pointerup')).toBeLessThan(order.indexOf('click'));
      if (touch) {
        expect(order.indexOf('touchstart')).toBeGreaterThan(order.indexOf('pointerdown'));
        expect(order.indexOf('touchend')).toBeGreaterThan(order.indexOf('pointerup'));
        expect(menuEvents.find(event => event.type === 'pointerdown').active).toBe(false);
        expect(menuEvents.find(event => event.type === 'pointerup').active).toBe(true);
        expect(['pointerup', 'click']).toContain(firstInput);
      } else {
        expect(menuEvents.find(event => event.type === 'pointerdown').active).toBe(true);
      }
      expect(await page.evaluate(() => window.audioProbe.nodes.filter(n => n.audioProbeType === 'source').every(n => n.loop && n.started && n.buffer?.duration === 24))).toBe(true);
    } finally { await attachAudioDiagnostics(page, info); }
  });
}

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
