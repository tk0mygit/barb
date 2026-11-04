import { test, expect } from './diagnostics-fixture.js';
import { installPausedClock } from './clock-fixture.js';
import { openUIFixture } from './ui-fixture.js';
import { NORMAL_ACHIEVEMENTS } from '../../src/game/achievements.js';

const layouts = [
  { name: 'PC', viewport: { width: 1000, height: 700 }, touch: false },
  { name: 'short portrait', viewport: { width: 320, height: 568 }, touch: true },
  { name: 'landscape', viewport: { width: 568, height: 320 }, touch: true },
];

for (const { name, viewport, touch } of layouts) {
  test(`${name}: hidden notice has no box; text-only award passes input and expires at 5 seconds`, async ({ createContext }) => {
    const context = await createContext({ viewport, hasTouch: touch, isMobile: touch });
    const page = await context.newPage();
    await installPausedClock(page);
    await openUIFixture(page);
    const notice = page.locator('#achievement-notice');
    async function expectNoBox() {
      await expect(notice).toBeHidden();
      expect(await notice.evaluate(el => ({ hidden: el.hidden, display: getComputedStyle(el).display,
        rects: el.getClientRects().length, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height,
        text: el.textContent }))).toEqual({ hidden: true, display: 'none', rects: 0, width: 0, height: 0, text: '' });
    }
    await expectNoBox();
    await page.evaluate(() => {
      window.canvasPresses = 0;
      document.querySelector('#scene').addEventListener('pointerdown', () => window.canvasPresses++);
      fixture.fund(300);
    });
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText('実績を解除した始まり');
    await expect(notice.locator('span')).toHaveText('実績を解除した');
    await expect(notice.locator('strong')).toHaveText('始まり');
    await expect(notice).toHaveAttribute('role', 'status');
    await expect(notice).toHaveAttribute('aria-live', 'polite');
    await expect(notice).toHaveAttribute('aria-atomic', 'true');
    expect(await notice.ariaSnapshot()).toContain('始まり');
    await expect(notice).toHaveCSS('position', 'fixed');
    await expect(notice).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(notice).toHaveCSS('background-image', 'none');
    await expect(notice).toHaveCSS('border-width', '0px');
    await expect(notice).toHaveCSS('box-shadow', 'none');
    expect(await notice.evaluate(el => getComputedStyle(el).textShadow)).not.toBe('none');
    await expect(notice).toHaveCSS('pointer-events', 'none');
    const box = await notice.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    expect(x).toBeCloseTo(viewport.width / 2, 1);
    expect(y).toBeCloseTo(viewport.height * 0.35, 1);
    const sizes = await notice.evaluate(el => [...el.children].map(child => parseFloat(getComputedStyle(child).fontSize)));
    expect(sizes[0]).toBeGreaterThanOrEqual(12); expect(sizes[0]).toBeLessThanOrEqual(14);
    expect(sizes[1]).toBeGreaterThanOrEqual(24); expect(sizes[1]).toBeLessThanOrEqual(30);
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).id, { x, y })).toBe('scene');
    if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
    expect(await page.evaluate(() => window.canvasPresses)).toBe(1);
    await page.clock.fastForward(4999); await expect(notice).toBeVisible();
    await page.clock.fastForward(1); await expectNoBox();
    // A hidden notice stays boxless after both directions of modal reparenting.
    const click = locator => touch ? locator.tap() : locator.click();
    await click(page.locator('#menu-button')); await expect(page.locator('#collection-dialog')).toBeVisible();
    expect(await notice.evaluate(el => el.parentElement.id)).toBe('collection-dialog');
    await expectNoBox();
    await click(page.locator('#collection-close')); await expect(page.locator('#collection-dialog')).toBeHidden();
    expect(await notice.evaluate(el => el.parentElement.id)).toBe('app'); await expectNoBox();
  });

  test(`${name}: notice host is settled before modal buttons can be targeted`, async ({ createContext }) => {
    const context = await createContext({ viewport, hasTouch: touch, isMobile: touch });
    const page = await context.newPage();
    await installPausedClock(page);
    await openUIFixture(page);
    await page.evaluate(() => fixture.fund(300, true));
    // Also cover the catch modal: showModal()/close() must return with the
    // notice already in its final host, without waiting for a queued toggle.
    expect(await page.evaluate(() => {
      const dialog = document.querySelector('#catch-dialog'), notice = document.querySelector('#achievement-notice');
      dialog.showModal(); const opened = notice.parentElement.id;
      dialog.close(); return { opened, closed: notice.parentElement.id };
    })).toEqual({ opened: 'catch-dialog', closed: 'app' });
    const positions = await page.evaluate(() => new Promise(resolve => {
      const dialog = document.querySelector('#collection-dialog');
      const snapshot = () => {
        const button = document.querySelector('[data-view="storage"]'), rect = button.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          host: document.querySelector('#achievement-notice').parentElement.id };
      };
      let opened;
      dialog.addEventListener('toggle', () => resolve({ opened, settled: snapshot() }), { once: true });
      // Capture the same coordinate window a fast input driver can observe:
      // the opening handler returned, but the queued toggle has not run yet.
      document.querySelector('#menu-button').click();
      document.querySelector('[data-view="storage"]').scrollIntoView({ block: 'nearest' });
      opened = snapshot();
    }));
    expect(positions.opened.host).toBe('collection-dialog');
    expect(positions.settled).toEqual(positions.opened);
    const { x, y, width, height } = positions.opened;
    if (touch) await page.touchscreen.tap(x + width / 2, y + height / 2);
    else await page.mouse.click(x + width / 2, y + height / 2);
    await expect(page.locator('#collection-title')).toHaveText('生けす');
    await expect(page.locator('#sell-all')).toBeDisabled();
    await expect(page.locator('.stored-fish')).toHaveCount(0);
    await expect(page.locator('#achievement-notice')).toContainText('始まり');
    expect(await page.evaluate(() => fixture.achievements.unlockedCount)).toBe(1);
  });
}

test('opacity alone fades at 0/600/4400/5000ms; queued and later awards each start a new effect', async ({ page }) => {
  await installPausedClock(page); await openUIFixture(page);
  const notice = page.locator('#achievement-notice');
  await page.evaluate(() => fixture.collection.register({ schemaVersion: 1, id: 'big', speciesId: 'arowana',
    lengthCm: 100, weightKg: 1, caughtAt: '2026-01-01T00:00:00Z' }));
  const effect = await notice.evaluate(el => {
    window.firstNoticeAnimation = el.getAnimations()[0];
    const effect = window.firstNoticeAnimation.effect;
    return { duration: effect.getTiming().duration, easing: effect.getTiming().easing,
      frames: effect.getKeyframes().map(({ offset, opacity, ...rest }) => ({ offset, opacity,
        properties: Object.keys(rest).filter(key => !['easing', 'composite', 'computedOffset'].includes(key)) })) };
  });
  expect(effect).toEqual({ duration: 5000, easing: 'linear', frames: [
    { offset: 0, opacity: '0', properties: [] }, { offset: 0.12, opacity: '1', properties: [] },
    { offset: 0.88, opacity: '1', properties: [] }, { offset: 1, opacity: '0', properties: [] },
  ] });
  // Sample the browser's actual rendered effect, independently of the timer's
  // virtual clock. No animation frame or sleep is needed to read each sample.
  const samples = await notice.evaluate(el => {
    const animation = window.firstNoticeAnimation; animation.pause();
    return [0, 300, 600, 2500, 4400, 4700, 5000].map(time => {
      animation.currentTime = time;
      return { opacity: Number(getComputedStyle(el).opacity), box: el.getBoundingClientRect().toJSON() };
    });
  });
  expect(samples.map(sample => sample.opacity)).toEqual([0, 0.5, 1, 1, 1, 0.5, 0]);
  for (const sample of samples) expect(sample.box).toEqual(samples[0].box);
  await page.clock.fastForward(1500);
  // A later award joins behind both pending awards, even if its ID is sent twice.
  await page.evaluate(() => {
    const award = { id: 'presentation-only-later', name: '通知キュー検証' };
    fixture.achievementNotice.notify([award, award]);
  });
  await expect(notice.locator('strong')).toHaveText('始まり');
  await page.clock.fastForward(3499); await expect(notice.locator('strong')).toHaveText('始まり');
  await page.clock.fastForward(1); await expect(notice.locator('strong')).toHaveText('特異個体');
  expect(await notice.evaluate(el => {
    const animation = el.getAnimations()[0];
    window.secondNoticeAnimation = animation;
    return animation !== window.firstNoticeAnimation && animation.currentTime < 600;
  })).toBe(true);
  await page.clock.fastForward(4999); await expect(notice.locator('strong')).toHaveText('特異個体');
  await page.clock.fastForward(1); await expect(notice.locator('strong')).toHaveText('通知キュー検証');
  expect(await notice.evaluate(el => el.getAnimations()[0] !== window.secondNoticeAnimation)).toBe(true);
  await page.clock.fastForward(4999); await expect(notice).toBeVisible();
  await page.clock.fastForward(1); await expect(notice).toBeHidden();
  expect(await notice.evaluate(el => el.getAnimations().length)).toBe(0);
});

for (const touch of [false, true]) test(`${touch ? 'touch' : 'PC'}: modal moves preserve viewport position, layout, scroll and live text`, async ({ createContext }, info) => {
  const context = await createContext({ viewport: touch ? { width: 320, height: 568 } : { width: 1000, height: 700 },
    hasTouch: touch, isMobile: touch });
  const page = await context.newPage(); await installPausedClock(page); await openUIFixture(page);
  const notice = page.locator('#achievement-notice');
  const click = locator => touch ? locator.tap() : locator.click();
  await click(page.locator('#menu-button')); await click(page.locator('[data-view="achievements"]'));
  const content = page.locator('#collection-content');
  await content.evaluate(el => { el.scrollTop = el.scrollHeight; });
  async function geometry(dialogId) {
    return page.evaluate(dialogId => {
      const dialog = document.getElementById(dialogId);
      return { dialog: dialog.getBoundingClientRect().toJSON(), scrollTop: dialog.scrollTop,
        scrollHeight: dialog.scrollHeight, contentScroll: document.querySelector('#collection-content').scrollTop,
        buttons: [...dialog.querySelectorAll('button')].map(button => button.getBoundingClientRect().toJSON()) };
    }, dialogId);
  }
  const before = await geometry('collection-dialog');
  // Call the presentation API, keeping domain progress and menu content fixed.
  await page.evaluate(() => fixture.achievementNotice.notify([{ id: 'modal-notice', name: 'ノスタルジア' }]));
  expect(await geometry('collection-dialog')).toEqual(before);
  const initial = await notice.boundingBox();
  await page.evaluate(() => {
    window.noticeNode = document.querySelector('#achievement-notice');
    window.noticeName = window.noticeNode.lastChild;
    window.noticeEffect = window.noticeNode.getAnimations()[0];
    window.noticeTextMutations = [];
    new MutationObserver(records => window.noticeTextMutations.push(...records.map(record => record.type)))
      .observe(window.noticeNode, { subtree: true, childList: true, characterData: true });
  });
  await page.clock.fastForward(1000);
  await click(page.locator('#collection-close'));
  expect(await notice.boundingBox()).toEqual(initial);
  // Exercise both state-preserving moveBefore and the append fallback.
  await page.evaluate(() => { document.querySelector('#catch-dialog').moveBefore = undefined; document.querySelector('#catch-dialog').showModal(); });
  expect(await notice.evaluate(el => el.parentElement.id)).toBe('catch-dialog');
  expect(await notice.boundingBox()).toEqual(initial);
  const catchWithNotice = await geometry('catch-dialog');
  expect(await notice.ariaSnapshot()).toContain('ノスタルジア');
  expect(await page.locator('#catch-dialog').ariaSnapshot()).toContain('実績を解除した');
  await page.screenshot({ path: info.outputPath('notice-in-catch.png') });
  // Hit-test the native button, including when the fixed text crosses its area.
  const button = page.locator('#close-catch'); await button.scrollIntoViewIfNeeded();
  expect(await button.evaluate(el => { const box = el.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('button')?.id;
  })).toBe('close-catch');
  await click(button); await click(page.locator('#menu-button'));
  await click(page.locator('[data-view="achievements"]'));
  await content.evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect(await notice.boundingBox()).toEqual(initial);
  expect(await geometry('collection-dialog')).toEqual(before);
  expect(await notice.evaluate(el => el === window.noticeNode && el.lastChild === window.noticeName
    && el.getAnimations()[0] === window.noticeEffect)).toBe(true);
  expect(await page.evaluate(() => window.noticeTextMutations)).toEqual([]);
  await page.clock.fastForward(3999); await expect(notice).toBeVisible();
  await page.clock.fastForward(1); await expect(notice).toBeHidden();
  expect(await geometry('collection-dialog')).toEqual(before);
  await click(page.locator('#collection-close'));
  await page.evaluate(() => document.querySelector('#catch-dialog').showModal());
  // The notice never contributed to the catch modal's scroll extent or layout.
  expect(await geometry('catch-dialog')).toEqual(catchWithNotice);
});

test('reduced motion stays readable for 5 seconds; all names and long text fit safe portrait/landscape viewports', async ({ createContext }, info) => {
  const context = await createContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    reducedMotion: 'reduce' });
  const page = await context.newPage(); await installPausedClock(page); await openUIFixture(page);
  const notice = page.locator('#achievement-notice');
  const names = [...NORMAL_ACHIEVEMENTS.map(entry => entry.name), '長い実績名の表示を確認するための折り返しテキスト'.repeat(3)];
  const profiles = [
    { width: 390, height: 844, insets: { top: 44, bottom: 34, left: 0, right: 0 } },
    { width: 844, height: 390, insets: { top: 0, bottom: 21, left: 44, right: 44 } },
    { width: 320, height: 568, insets: { top: 44, bottom: 34, left: 0, right: 0 } },
    { width: 568, height: 320, insets: { top: 0, bottom: 21, left: 44, right: 24 } },
  ];
  for (const [index, profile] of profiles.entries()) {
    await page.setViewportSize({ width: profile.width, height: profile.height });
    await page.evaluate(insets => Object.entries(insets).forEach(([edge, value]) =>
      document.documentElement.style.setProperty(`--safe-${edge}`, `${value}px`)), profile.insets);
    await page.evaluate(({ index, names }) => fixture.achievementNotice.notify(names.map((name, n) =>
      ({ id: `layout-${index}-${n}`, name }))), { index, names });
    for (const name of names) {
      await expect(notice.locator('strong')).toHaveText(name);
      await expect(notice).toHaveCSS('opacity', '1');
      expect(await notice.evaluate(el => el.getAnimations().length)).toBe(0);
      const box = await notice.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(profile.insets.left + 16);
      expect(box.x + box.width).toBeLessThanOrEqual(profile.width - profile.insets.right - 16);
      expect(box.y).toBeGreaterThanOrEqual(profile.insets.top + 12);
      expect(box.y + box.height).toBeLessThanOrEqual(profile.height - profile.insets.bottom - 12);
      expect(box.x + box.width / 2).toBeCloseTo((profile.insets.left + profile.width - profile.insets.right) / 2, 1);
      expect(box.y + box.height / 2).toBeCloseTo(profile.height * 0.35, 1);
      expect(await notice.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      if (name === names.at(-1)) await page.screenshot({ path: info.outputPath(`long-notice-${profile.width}x${profile.height}.png`) });
      await page.clock.fastForward(4999); await expect(notice).toHaveCSS('opacity', '1');
      await page.clock.fastForward(1);
    }
    await expect(notice).toBeHidden();
  }
});

test('awards unlocked while hidden wait for a full visible turn; a short background visit keeps the current deadline', async ({ page }) => {
  await installPausedClock(page); await openUIFixture(page);
  const notice = page.locator('#achievement-notice');
  async function visibility(hidden) {
    await page.evaluate(hidden => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  }
  await visibility(true);
  await page.evaluate(() => fixture.fund(300));
  await page.clock.fastForward(60000); await expect(notice).toBeHidden();
  await visibility(false); await expect(notice.locator('strong')).toHaveText('始まり');
  await page.clock.fastForward(1000); await visibility(true);
  await page.clock.fastForward(500); await visibility(false);
  await expect(notice.locator('strong')).toHaveText('始まり');
  await page.clock.fastForward(3499); await expect(notice).toBeVisible();
  await page.clock.fastForward(1); await expect(notice).toBeHidden();
});

for (const { name, viewport, touch } of layouts) test(`${name}: cast notice placement preserves the achievement anchor and effect`, async ({ createContext }) => {
  const context = await createContext({ viewport, hasTouch: touch, isMobile: touch });
  const page = await context.newPage(); await installPausedClock(page); await openUIFixture(page);
  await page.evaluate(async () => {
    const { createCastNotices } = await import('./src/ui/cast-notices.js');
    fixture.castNotices = createCastNotices();
    fixture.fund(300, true);
  });
  const result = await page.evaluate(() => {
    const notice = document.querySelector('#achievement-notice'), effect = notice.getAnimations()[0];
    const initial = notice.getBoundingClientRect().toJSON();
    const positions = [];
    for (const mode of ['preparing', 'cast', 'ready']) {
      const app = document.querySelector('#app');
      app.dataset.castPreparing = String(mode === 'preparing'); app.dataset.castView = String(mode === 'cast');
      fixture.castNotices.update({ left: 100, top: innerHeight * 0.6, right: 140, bottom: innerHeight * 0.6 + 40 }, mode !== 'ready');
      positions.push(notice.getBoundingClientRect().toJSON());
    }
    return { initial, positions, style: notice.getAttribute('style'), sameEffect: effect === notice.getAnimations()[0] };
  });
  for (const box of result.positions) expect(box).toEqual(result.initial);
  expect(result.style).toBeNull(); expect(result.sameEffect).toBe(true);
  // With no movable notices, even a water marker underneath this text must not
  // cause presentation code to reject a valid cast or consume the award.
  expect(await page.evaluate(() => {
    document.querySelector('#sale-notice').hidden = true;
    const bounds = document.querySelector('#achievement-notice').getBoundingClientRect().toJSON();
    return fixture.castNotices.update(bounds, true);
  })).toBe(true);
  await expect(page.locator('#achievement-notice strong')).toHaveText('始まり');
});
