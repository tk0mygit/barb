import { test, expect } from './diagnostics-fixture.js';
import { installPausedClock } from './clock-fixture.js';

// Keep real production DOM, input and rendering; only time is controlled.
test.use({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 0.5 });

async function observeOpening(page) {
  await installPausedClock(page);
  await page.addInitScript(() => {
    window.openingProbe = { starts: [], hides: [] };
    new MutationObserver(records => {
      for (const record of records) {
        if (record.target.id !== 'opening-title') continue;
        if (!record.target.hidden && record.oldValue !== null) window.openingProbe.starts.push(performance.now());
        if (record.target.hidden && record.oldValue === null) window.openingProbe.hides.push(performance.now());
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['hidden'], attributeOldValue: true });
  });
}

async function assertOpening(page) {
  await page.clock.runFor(16);
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#opening-title')).toBeVisible();
  await expect(page.locator('#opening-logo')).toHaveText('BARB');
  await expect(page.locator('#opening-copy')).toHaveText('かつての湖とあなたの記録。');
  await expect(page.locator('.masthead .wordmark')).toBeVisible();
  await expect(page.locator('#fish-button')).toBeEnabled();
  expect(await page.locator('body').innerText()).not.toMatch(/水の上に、|FIND YOUR STILLNESS|風に揺れる森/);
  expect(await page.evaluate(() => window.openingProbe.starts.length)).toBe(1);
}

async function advanceToOpeningAge(page, age) {
  const elapsed = await page.evaluate(() => performance.now() - window.openingProbe.starts[0]);
  expect(elapsed).toBeLessThanOrEqual(age);
  await page.clock.fastForward(age - elapsed);
}

async function assertExpired(page) {
  await expect(page.locator('#opening-title')).toBeHidden();
  expect(await page.locator('#opening-title').evaluate(element => ({ hidden: element.hidden,
    display: getComputedStyle(element).display, rects: element.getClientRects().length,
    animations: element.getAnimations().length }))).toEqual({ hidden: true, display: 'none', rects: 0, animations: 0 });
  expect(await page.evaluate(() => window.openingProbe.hides[0] - window.openingProbe.starts[0])).toBe(3000);
}

test('opening waits for successful initialization, lasts 3 seconds, and replays on reload only', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await observeOpening(page);
  let release, requested;
  const gate = new Promise(resolve => { release = resolve; });
  const request = new Promise(resolve => { requested = resolve; });
  await page.route('**/barb/assets/index-*.js', async route => {
    requested();
    await gate;
    await route.continue();
  });
  await page.goto('./', { waitUntil: 'commit' });
  try {
    await request;
    await expect(page.locator('#status')).toBeVisible();
    await expect(page.locator('#opening-title')).toBeHidden();
    await page.clock.fastForward(5000);
    await expect(page.locator('#opening-title')).toBeHidden();
    expect(await page.evaluate(() => window.openingProbe.starts)).toEqual([]);
  } finally { release(); }
  await page.waitForLoadState('load');
  await assertOpening(page);

  const animation = await page.locator('#opening-title').evaluate(element => {
    const effect = element.getAnimations()[0].effect;
    return { duration: effect.getTiming().duration, easing: effect.getTiming().easing,
      frames: effect.getKeyframes().map(({ offset, opacity }) => ({ offset, opacity })) };
  });
  expect(animation).toEqual({ duration: 3000, easing: 'linear', frames: [
    { offset: 0, opacity: '0' }, { offset: 0.2, opacity: '1' },
    { offset: 0.8, opacity: '1' }, { offset: 1, opacity: '0' },
  ] });
  await expect(page.locator('#opening-title')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: info.outputPath('opening-desktop.png') });
  expect(await page.locator('#opening-logo').evaluate(element => {
    const box = element.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.id;
  })).toBe('scene');

  // Native UI remains available during the presentation, without restarting it.
  await page.locator('#fish-button').click();
  await page.clock.runFor(16);
  await expect(page.locator('#motion-label')).toHaveText('釣り視点');
  await expect(page.locator('#opening-title')).toBeVisible();
  await advanceToOpeningAge(page, 2999);
  await expect(page.locator('#opening-title')).toBeVisible();
  await page.clock.fastForward(1);
  await assertExpired(page);
  await page.locator('#return-button').click();
  await page.clock.runFor(16);
  await page.locator('#menu-button').click();
  await expect(page.locator('#collection-dialog')).toBeVisible();
  await page.locator('#collection-close').click();
  await expect(page.locator('#opening-title')).toBeHidden();
  expect(await page.evaluate(() => window.openingProbe.starts.length)).toBe(1);

  await page.reload();
  await assertOpening(page);
  await advanceToOpeningAge(page, 3000);
  await assertExpired(page);
  expect(errors).toEqual([]);
});

test('reduced motion keeps the copy readable through touch rotation and safe insets', async ({ createContext }, info) => {
  const context = await createContext({ viewport: { width: 390, height: 844 }, isMobile: true,
    hasTouch: true, deviceScaleFactor: 0.5, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await observeOpening(page);
  await page.goto('./');
  await assertOpening(page);
  await expect(page.locator('#opening-title')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('#opening-title')).toHaveCSS('opacity', '1');
  const profiles = [
    { id: 'portrait', width: 390, height: 844, insets: { top: 44, right: 0, bottom: 34, left: 0 } },
    { id: 'landscape', width: 844, height: 390, insets: { top: 0, right: 44, bottom: 21, left: 44 } },
    { id: 'small-landscape', width: 568, height: 320, insets: { top: 0, right: 44, bottom: 21, left: 44 } },
    { id: 'small-portrait', width: 320, height: 568, insets: { top: 44, right: 0, bottom: 34, left: 0 } },
  ];
  for (const profile of profiles) {
    await page.setViewportSize({ width: profile.width, height: profile.height });
    await page.evaluate(insets => Object.entries(insets).forEach(([edge, value]) =>
      document.documentElement.style.setProperty(`--safe-${edge}`, `${value}px`)), profile.insets);
    const layout = await page.locator('.opening-content').evaluate(element => ({
      content: element.getBoundingClientRect().toJSON(), scroll: document.documentElement.scrollWidth,
      text: document.querySelector('#opening-copy').getBoundingClientRect().toJSON(),
    }));
    for (const box of [layout.content, layout.text]) {
      expect(box.left).toBeGreaterThanOrEqual(profile.insets.left + 24);
      expect(box.top).toBeGreaterThanOrEqual(profile.insets.top + 24);
      expect(box.right).toBeLessThanOrEqual(profile.width - profile.insets.right - 24);
      expect(box.bottom).toBeLessThanOrEqual(profile.height - profile.insets.bottom - 24);
    }
    expect(layout.content.x + layout.content.width / 2).toBeCloseTo(
      (profile.insets.left + profile.width - profile.insets.right) / 2, 1);
    expect(layout.content.y + layout.content.height / 2).toBeCloseTo(
      (profile.insets.top + profile.height - profile.insets.bottom) / 2, 1);
    expect(layout.scroll).toBe(profile.width);
    await expect(page.locator('#opening-copy')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`opening-${profile.id}.png`) });
  }
  await page.locator('#fish-button').tap();
  await page.clock.runFor(16);
  await expect(page.locator('#motion-label')).toHaveText('釣り視点');
  await expect(page.locator('#opening-title')).toBeVisible();
  await advanceToOpeningAge(page, 2999);
  await expect(page.locator('#opening-copy')).toBeVisible();
  await page.clock.fastForward(1);
  await assertExpired(page);
  expect(await page.evaluate(() => window.openingProbe.starts.length)).toBe(1);
});

test('initialization failure keeps the existing error visible without showing the opening', async ({ page }) => {
  await observeOpening(page);
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      return type === 'webgl2' ? null : getContext.call(this, type, ...args);
    };
  });
  await page.goto('./');
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#error')).toContainText('3D表示を開始できませんでした。');
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#fish-button')).toBeDisabled();
  await expect(page.locator('#menu-button')).toBeDisabled();
  await page.clock.fastForward(5000);
  await expect(page.locator('#opening-title')).toBeHidden();
  await expect(page.locator('#error')).toBeVisible();
  expect(await page.evaluate(() => window.openingProbe.starts)).toEqual([]);
});

test('WebGL context loss dismisses an active opening immediately in favor of the error', async ({ page }) => {
  await observeOpening(page);
  await page.goto('./');
  await assertOpening(page);
  await page.evaluate(() => document.querySelector('#scene').getContext('webgl2')
    .getExtension('WEBGL_lose_context').loseContext());
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#error')).toHaveText('描画が中断されました。ページを再読み込みしてください。');
  await expect(page.locator('#opening-title')).toBeHidden();
  await page.clock.fastForward(5000);
  await expect(page.locator('#opening-title')).toBeHidden();
});
