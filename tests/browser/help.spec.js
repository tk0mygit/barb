import { readFileSync } from 'node:fs';
import { test, expect } from './diagnostics-fixture.js';
import { openUIFixture } from './ui-fixture.js';
import { FISH_SPECIES } from '../../src/game/fish-species.js';

const sections = ['プレイ', 'QTE', 'メニュー', 'セーブ'];
const operations = ['flick', 'swipe', 'tap', 'target'];
const labels = ['短く素早くフリック', '長くスワイプ', '3回タップ', 'ターゲットを選択'];
const arrowPath = 'M12 36H53V18L86 50 53 82V64H12Z';
const profiles = [
  { name: 'PC', viewport: { width: 1280, height: 800 }, touch: false },
  { name: 'touch portrait', viewport: { width: 390, height: 844 }, touch: true },
  { name: 'touch narrow', viewport: { width: 320, height: 568 }, touch: true },
  { name: 'touch short enlarged safe', viewport: { width: 568, height: 320 }, touch: true, enlarged: true },
  { name: 'touch landscape', viewport: { width: 844, height: 390 }, touch: true },
];
const activate = (locator, touch) => touch ? locator.tap() : locator.click();

async function enlarge(page) {
  await page.addStyleTag({ content: ':root { font-size:20px; --safe-top:8px; --safe-right:12px; --safe-bottom:8px; --safe-left:12px; }' });
}

async function reachable(locator) {
  await locator.scrollIntoViewIfNeeded();
  const result = await locator.evaluate(element => {
    const r = element.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { width: r.width, height: r.height, inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      receivesEvents: element === hit || element.contains(hit) };
  });
  expect(result.width).toBeGreaterThanOrEqual(44);
  expect(result.height).toBeGreaterThanOrEqual(44);
  expect(result.inside).toBe(true);
  expect(result.receivesEvents).toBe(true);
}

async function layout(page) {
  return page.evaluate(() => {
    const bounds = selector => [...document.querySelectorAll(selector)].map(node => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const pane = document.querySelector('#collection-content');
    return { sections: bounds('.help-section'), rows: bounds('.help-qte-row'), scrollTop: pane.scrollTop,
      clientHeight: pane.clientHeight, scrollHeight: pane.scrollHeight,
      overflow: [...document.querySelectorAll('#collection-dialog, #collection-content, #collection-view, .help-page, .help-section, .help-qte-row')]
        .map(node => ({ className: node.className, width: node.clientWidth, scrollWidth: node.scrollWidth })) };
  });
}

function assertOneColumn(boxes) {
  for (let i = 1; i < boxes.length; i++) {
    expect(Math.abs(boxes[i].x - boxes[0].x)).toBeLessThanOrEqual(1);
    expect(Math.abs(boxes[i].width - boxes[0].width)).toBeLessThanOrEqual(1);
    expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i - 1].y + boxes[i - 1].height - 1);
  }
}

async function passiveFigures(page) {
  const rows = page.locator('.help-qte-row');
  await expect(rows).toHaveCount(4);
  expect(await rows.evaluateAll(nodes => nodes.map(node => node.dataset.operation))).toEqual(operations);
  for (let i = 0; i < labels.length; i++) await expect(rows.nth(i)).toContainText(labels[i]);
  await expect(page.locator('.help-qte-taps')).toHaveText('0/3 ○○○');
  await expect(page.locator('.help-page progress, .help-page canvas, .help-page input, .help-page .qte-hud')).toHaveCount(0);
  for (const operation of ['flick', 'swipe']) {
    const arrows = page.locator(`.help-qte-row[data-operation="${operation}"] .help-qte-arrow-shape`);
    await expect(arrows).toHaveCount(2);
    for (const arrow of await arrows.all()) {
      await expect(arrow).toHaveAttribute('viewBox', '0 0 100 100');
      await expect(arrow.locator('path')).toHaveAttribute('d', arrowPath);
      await expect(arrow).toHaveAttribute('focusable', 'false');
    }
    await expect(arrows.first()).toBeVisible();
    if (operation === 'flick') await expect(arrows.nth(1)).toBeHidden();
    else await expect(arrows.nth(1)).toBeVisible();
  }
  const target = page.locator('.help-qte-target');
  await expect(target).toHaveCount(1);
  await expect(target).toHaveCSS('border-radius', '50%');
  const circle = await target.boundingBox();
  expect(circle.width).toBe(circle.height);
  expect(circle.width).toBeGreaterThan(0);
  expect(await page.locator('.help-qte-figure, .help-qte-figure *').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).pointerEvents === 'none'))).toBe(true);
  for (const figure of await page.locator('.help-qte-figure').all()) await expect(figure).toHaveAttribute('aria-hidden', 'true');
}

for (const profile of profiles) {
  test(`${profile.name}: four complete help sections and four passive examples stay in one column`, async ({ createContext }, info) => {
    const context = await createContext({ viewport: profile.viewport, hasTouch: profile.touch, isMobile: profile.touch,
      deviceScaleFactor: 0.5, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('./');
    await expect(page.locator('#status')).toBeHidden();
    if (profile.enlarged) await enlarge(page);
    await activate(page.locator('#menu-button'), profile.touch);
    const help = page.getByRole('button', { name: 'ヘルプ', exact: true });
    await expect(help).toHaveAccessibleDescription('プレイと操作の基本');
    await reachable(help);
    const parentTop = await page.locator('#collection-content').evaluate(node => node.scrollTop);
    const menuRoles = await page.locator('.menu-entry').evaluateAll(nodes => nodes.filter(node => node.dataset.view !== 'help')
      .map(node => ({ name: node.querySelector('.menu-entry-title').textContent, description: node.querySelector('.menu-entry-description').textContent })));
    const wallet = await page.locator('#collection-wallet').textContent();
    const saveText = await page.locator('#collection-save-status').textContent();
    await activate(help, profile.touch);
    await expect(page.locator('#collection-title')).toHaveText('ヘルプ');
    await expect(page.locator('#collection-title')).toBeFocused();
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    await expect(page.locator('.help-section')).toHaveCount(4);
    await expect(page.locator('.help-section > h3')).toHaveText(sections);
    expect(await page.locator('.help-section').evaluateAll(nodes => nodes.every(node => !node.hidden && getComputedStyle(node).display !== 'none'))).toBe(true);
    await expect(page.locator('.help-page details, .help-page dialog')).toHaveCount(0);
    await expect(page.locator('.help-play-steps dt')).toHaveText(['航行中', '停船中', 'キャスト前', 'キャスト準備',
      '静寂を聴く', 'シグナルを検知した', '抵抗を検知', '個体を回収した']);
    await expect(page.locator('.help-play-steps dd').nth(0)).toContainText('「停船中」からもドラッグで操船を始められます');
    await expect(page.locator('.help-play-steps dd').nth(5)).toHaveText('長押し中ならいったん離し、改めて短くタップしてアワセます。離すだけではアワセになりません。');
    await expect(page.locator('.help-play-steps dd').last()).toContainText('「保管して続ける」か「売却して続ける」');
    await expect(page.locator('.help-page button')).toHaveCount(4);
    await expect(page.locator('.help-menu-roles dt')).toHaveText(menuRoles.map(role => role.name));
    await expect(page.locator('.help-menu-roles dd')).toHaveText(menuRoles.map(role => role.description));
    await expect(page.locator('.qte-hud')).toBeHidden();
    await passiveFigures(page);
    const measured = await layout(page);
    assertOneColumn(measured.sections); assertOneColumn(measured.rows);
    for (const item of measured.overflow) expect(item.scrollWidth, item.className).toBeLessThanOrEqual(item.width);
    const html = await page.locator('#collection-content').innerHTML();
    for (const fish of FISH_SPECIES) {
      expect(html).not.toContain(fish.name); expect(html).not.toContain(fish.description);
      expect(html).not.toContain(fish.image);
    }
    const beforeURL = page.url();
    for (const name of ['play', 'qte', 'menu', 'save']) {
      const jump = page.locator(`[data-help-section="${name}"]`);
      await reachable(jump);
      await activate(jump, profile.touch);
      await expect(page.locator(`#help-${name}`)).toBeFocused();
      await expect(page.locator(`#help-${name}`)).toBeInViewport();
      expect(page.url()).toBe(beforeURL);
    }
    await expect(page.locator('#collection-wallet')).toHaveText(wallet);
    await expect(page.locator('#collection-save-status')).toHaveText(saveText);
    await expect(page.locator('.help-qte-taps')).toHaveText('0/3 ○○○');
    await reachable(page.locator('#collection-back'));
    await reachable(page.locator('#collection-close'));
    await activate(page.locator('#collection-back'), profile.touch);
    await expect(help).toBeFocused();
    await expect.poll(async () => Math.abs(await page.locator('#collection-content').evaluate(node => node.scrollTop) - parentTop)).toBeLessThanOrEqual(1);
    await activate(help, profile.touch);
    await expect.poll(() => page.locator('#collection-content').evaluate(node => node.scrollTop)).toBe(0);
    await activate(page.locator('#collection-close'), profile.touch);
    await expect(page.locator('#scene')).toBeFocused();
    await activate(page.locator('#menu-button'), profile.touch);
    await expect(page.locator('#collection-title')).toHaveText('湖の記録');
    await expect.poll(() => page.locator('#collection-content').evaluate(node => node.scrollTop)).toBe(0);
    await expect(page.locator('.help-page')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('#scene')).toBeFocused();
    await info.attach('help-layout', { body: Buffer.from(JSON.stringify({ profile, parentTop, measured }, null, 2)), contentType: 'application/json' });
  });
}

test('keyboard help jumps and short native touch scrolling preserve the same pane after rotation', async ({ createContext }) => {
  const context = await createContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true,
    deviceScaleFactor: 0.5, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('./'); await expect(page.locator('#status')).toBeHidden();
  await page.locator('#menu-button').click();
  for (const view of ['encyclopedia', 'storage', 'equipment', 'achievements', 'sound', 'help']) {
    await page.keyboard.press('Tab');
    await expect(page.locator(`[data-view="${view}"]`)).toBeFocused();
  }
  await page.keyboard.press('Enter');
  await expect(page.locator('#collection-title')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#collection-close')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-help-section="play"]')).toBeFocused();
  await page.keyboard.press('Tab'); await page.keyboard.press('Space');
  await expect(page.locator('#help-qte')).toBeFocused();
  await page.setViewportSize({ width: 568, height: 320 }); await enlarge(page);
  await page.locator('#help-play').scrollIntoViewIfNeeded();
  const pane = page.locator('#collection-content');
  const before = await pane.evaluate(node => node.scrollTop);
  const bounds = await pane.boundingBox();
  await pane.evaluate(node => {
    const initialTop = node.scrollTop;
    window.helpScrollEnd = new Promise(resolve => {
      const end = () => {
        if (node.scrollTop <= initialTop) return;
        node.removeEventListener('scrollend', end); resolve(node.scrollTop);
      };
      node.addEventListener('scrollend', end);
    });
  });
  const cdp = await context.newCDPSession(page);
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height - 12;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 80 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => pane.evaluate(node => node.scrollTop)).toBeGreaterThan(before);
  expect(await page.evaluate(() => window.helpScrollEnd)).toBeGreaterThan(before);
  await reachable(page.locator('[data-help-section="save"]'));
  await page.locator('[data-help-section="save"]').tap();
  await expect(page.locator('#help-save')).toBeFocused();
  await reachable(page.locator('#collection-back')); await page.locator('#collection-back').tap();
  await expect(page.locator('[data-view="help"]')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.locator('#scene')).toBeFocused();
});

test('UI fixture: help keeps a long real save-status warning, wallet and undiscovered data intact', async ({ createContext }) => {
  const context = await createContext({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const page = await context.newPage(); await openUIFixture(page); await enlarge(page);
  await page.evaluate(async () => {
    const { createSaveStatus } = await import('/barb/src/ui/save-status.js');
    createSaveStatus().update({ phase: 'conflict' });
  });
  await page.locator('#menu-button').tap();
  // The existing fixture deliberately has no ambientAudio. Help remains the
  // last entry while only the conditional sound entry is absent.
  expect(await page.locator('.menu-entry').evaluateAll(nodes => nodes.map(node => node.dataset.view)))
    .toEqual(['encyclopedia', 'storage', 'equipment', 'achievements', 'help']);
  const warning = '他のタブから保存が変更されました。上書きを防ぐため自動保存を停止しています。このタブの進行は未保存です。タブを閉じて再読み込みしてください。';
  const wallet = await page.locator('#collection-wallet').textContent();
  await page.getByRole('button', { name: 'ヘルプ', exact: true }).tap();
  await expect(page.locator('#collection-save-status')).toHaveText(warning);
  await expect(page.locator('#collection-save-status')).toHaveAttribute('role', 'status');
  await expect(page.locator('#collection-save-status')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#collection-save-status')).toHaveAttribute('data-phase', 'conflict');
  await expect(page.locator('#collection-wallet')).toHaveText(wallet);
  await page.locator('#collection-save-status').scrollIntoViewIfNeeded();
  const warningGeometry = await page.locator('#collection-save-status').evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    const pane = document.querySelector('#collection-content');
    const p = pane.getBoundingClientRect();
    return { lines: [...range.getClientRects()].map(r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })),
      pane: { left: p.left, right: p.right }, text: node.textContent, scrollHeight: pane.scrollHeight };
  });
  expect(warningGeometry.text).toBe(warning);
  expect(warningGeometry.lines.length).toBeGreaterThan(1);
  for (const line of warningGeometry.lines) {
    expect(line.left).toBeGreaterThanOrEqual(warningGeometry.pane.left);
    expect(line.right).toBeLessThanOrEqual(warningGeometry.pane.right);
  }
  await page.locator('#help-save').scrollIntoViewIfNeeded();
  await expect(page.locator('#help-save')).toBeInViewport();
  await expect(page.locator('.help-section').last()).toContainText('自動保存を試み');
  await reachable(page.locator('#collection-back'));
  const html = await page.locator('#collection-content').innerHTML();
  for (const fish of FISH_SPECIES) {
    expect(html).not.toContain(fish.name); expect(html).not.toContain(fish.description); expect(html).not.toContain(fish.image);
  }
});

test('UI fixture: rendering help cannot start timers, gameplay input, RNG, storage or WebGL', async ({ page }) => {
  const helpSource = readFileSync(new URL('../../src/ui/help-view.js', import.meta.url), 'utf8');
  const imports = [...helpSource.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map(match => match[1]);
  expect(imports).toEqual(['./qte-glyphs.js']);
  await openUIFixture(page);
  const observation = await page.evaluate(async () => {
    const { renderHelp } = await import('/barb/src/ui/help-view.js');
    const saved = { random: Math.random, setTimeout, setInterval, requestAnimationFrame,
      addEventListener: EventTarget.prototype.addEventListener, getContext: HTMLCanvasElement.prototype.getContext };
    const storage = new Map(['getItem', 'setItem', 'removeItem', 'clear'].map(name => [name, Storage.prototype[name]]));
    const denied = name => () => { throw new Error(`Help attempted ${name}`); };
    const host = document.createElement('div');
    const stateBefore = JSON.stringify(fixture.fishing.state);
    try {
      Math.random = denied('RNG'); window.setTimeout = denied('timeout'); window.setInterval = denied('interval');
      window.requestAnimationFrame = denied('animation frame');
      EventTarget.prototype.addEventListener = function(type, ...args) {
        if (/^(pointer|touch|mouse|key)/.test(type)) throw new Error(`Help attempted input listener: ${type}`);
        return saved.addEventListener.call(this, type, ...args);
      };
      HTMLCanvasElement.prototype.getContext = denied('canvas/WebGL');
      for (const name of storage.keys()) Storage.prototype[name] = denied(`storage.${name}`);
      renderHelp(host, []);
      return { stateUnchanged: JSON.stringify(fixture.fishing.state) === stateBefore,
        headings: [...host.querySelectorAll('.help-section > h3')].map(node => node.textContent),
        taps: host.querySelector('.help-qte-taps').textContent, hud: host.querySelectorAll('.qte-hud,canvas,progress').length };
    } finally {
      Math.random = saved.random; window.setTimeout = saved.setTimeout; window.setInterval = saved.setInterval;
      window.requestAnimationFrame = saved.requestAnimationFrame;
      EventTarget.prototype.addEventListener = saved.addEventListener; HTMLCanvasElement.prototype.getContext = saved.getContext;
      for (const [name, method] of storage) Storage.prototype[name] = method;
    }
  });
  expect(observation).toEqual({ stateUnchanged: true, headings: sections, taps: '0/3 ○○○', hud: 0 });
});
