import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { test, expect } from './diagnostics-fixture.js';
import { installPausedClock } from './clock-fixture.js';
import { individualFor, productInput, historicalSave, saveKeys } from './qte-production-fixture.js';
import { encounterModel, getRodEncounterModifiers } from '../../src/game/encounter-production.js';
import { calculateSalePrice } from '../../src/game/fish-sales.js';

const root = new URL('../../', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const money = value => `${value.toLocaleString('ja-JP')} 通貨`;
const latest = page => page.evaluate(keys => keys.map(key => localStorage.getItem(key)).filter(Boolean)
  .map(JSON.parse).sort((a, b) => b.generation - a.generation)[0], saveKeys);

// No request routing, source replacement, returned gameplay handle or state
// injection. Only pre-start clock/RNG/save fixtures and native canvas inputs.
async function openPublicBuild(page, save) {
  const main = readFileSync(new URL('src/main.js', root), 'utf8');
  expect(main).toMatch(/\nstartGame\(\{ qteEnabled: true \}\);\s*$/);
  const html = readFileSync(new URL('dist/index.html', root));
  const bundleUrl = html.toString().match(/<script type="module"[^>]* src="([^"]+)"/)[1];
  expect(bundleUrl).toMatch(/^\/barb\/assets\/[^/]+\.js$/);
  const bundle = readFileSync(new URL(`dist/${bundleUrl.slice('/barb/'.length)}`, root));
  expect(bundle.toString()).not.toMatch(/qte-production\.html|qteProduct|qteFixture|productDrawQueue/);
  await installPausedClock(page);
  await page.addInitScript(({ save, keys }) => {
    Math.random = () => window.publicDrawQueue?.length ? window.publicDrawQueue.shift() : .5;
    if (save && !sessionStorage.getItem('public-save-seeded')) {
      localStorage.setItem(keys[0], JSON.stringify({ storageVersion: 1, generation: 7, data: save }));
      sessionStorage.setItem('public-save-seeded', 'yes');
    }
  }, { save, keys: saveKeys });
  const bundleResponse = page.waitForResponse(response => new URL(response.url()).pathname === bundleUrl);
  const response = await page.goto('./');
  const servedBundle = await bundleResponse;
  expect(response.ok()).toBe(true); expect(servedBundle.ok()).toBe(true);
  expect(hash(await response.body())).toBe(hash(html));
  expect(hash(await servedBundle.body())).toBe(hash(bundle));
  await page.clock.fastForward(32);
  await expect(page.locator('#status')).toBeHidden(); await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('.qte-hud')).toHaveCount(1); await expect(page.locator('.qte-hud')).toBeHidden();
  expect(await page.evaluate(() => [typeof window.qteProduct, typeof window.qteFixture])).toEqual(['undefined', 'undefined']);
  return { sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim(),
    sourceTree: execFileSync('git', ['rev-parse', 'HEAD:src'], { cwd: root }).toString().trim(),
    mainSha256: hash(main), htmlSha256: hash(html), bundleUrl, bundleSha256: hash(bundle), url: response.url() };
}

const observe = page => page.evaluate(() => {
  const hud = document.querySelector('.qte-hud'), target = document.querySelector('.qte-target');
  const region = document.querySelector('.qte-gesture').getBoundingClientRect();
  const circle = target.getBoundingClientRect();
  return { phase: document.querySelector('#fishing-panel').dataset.phase, tension: document.querySelector('#line-tension').value,
    visible: !hud.hidden, mode: hud.dataset.state, operation: hud.dataset.operation,
    direction: document.querySelector('.qte-arrow').dataset.direction,
    remaining: document.querySelector('.qte-timer span').textContent,
    region: { left: region.left, right: region.right, top: region.top, bottom: region.bottom },
    target: target.hidden ? { x: (region.left + region.right) / 2, y: (region.top + region.bottom) / 2 }
      : { x: (circle.left + circle.right) / 2, y: (circle.top + circle.bottom) / 2 } };
});

async function castAndHook(page, input, operation) {
  const { species, lengthCm } = individualFor(operation);
  await input.click(page.locator('#fish-button')); await page.clock.fastForward(250);
  await input.click(page.locator('#cast-button')); await page.clock.fastForward(250);
  await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'aim');
  const p = await page.evaluate(() => ({ x: innerWidth * .6, y: innerHeight * .48 }));
  await input.down(p); await input.up(); await page.clock.fastForward(250);
  for (let n = 0; n < 8 && (await observe(page)).phase === 'cast'; n++) await page.clock.fastForward(250);
  await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'lure');
  const conditions = await page.locator('#fishing-conditions').evaluate(el => ({
    depthM: Number(el.dataset.depthM), timeOfDay: el.dataset.timeOfDay }));
  let roll = 0;
  for (const row of encounterModel.getProbabilities('minnow', conditions, getRodEncounterModifiers(1))) {
    if (row.speciesId === species.id) { roll += row.probability / 2; break; }
    roll += row.probability;
  }
  await page.evaluate(draws => { window.publicDrawQueue = draws; }, [roll,
    Math.min(1 - Number.EPSILON, (lengthCm - species.minLengthCm) / (species.maxLengthCm - species.minLengthCm))]);
  for (let n = 0; n < 160 && (await observe(page)).phase !== 'bite'; n++) await page.clock.fastForward(250);
  await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'bite');
  await input.down(p); await input.up(); await page.clock.fastForward(16);
  await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'fight');
  return { p, species, lengthCm };
}

async function reelUntil(page, input, p, predicate) {
  for (let n = 0; n < 500; n++) {
    const s = await observe(page);
    if (predicate(s)) { await input.up(); return s; }
    expect(['fight', 'landing'], JSON.stringify(s)).toContain(s.phase);
    if (!input.held && s.tension < .35) await input.down(p);
    else if (input.held && s.tension > .6) await input.up();
    await page.clock.fastForward(250);
  }
  throw new Error('Public fight did not reach the expected UI state');
}

async function operate(page, input, warning, success) {
  expect(warning.mode).toBe('warning');
  for (let n = 0; n < 12 && (await observe(page)).mode !== 'active'; n++) await page.clock.fastForward(100);
  const before = await observe(page); expect(before.mode).toBe('active');
  // The selected large fish has the unchanged shortest 0.5s non-tap window.
  expect(Number.parseFloat(before.remaining)).toBeLessThanOrEqual(before.operation === 'tap' ? 2 : .5);
  const v = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }[before.direction] ?? [0, 0];
  const distance = before.operation === 'swipe' ? 80 : before.operation === 'flick' ? 50 : 0;
  const start = { x: before.target.x - v[0] * distance / 2, y: before.target.y - v[1] * distance / 2 };
  const end = { x: before.target.x + v[0] * distance / 2, y: before.target.y + v[1] * distance / 2 };
  expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.id, start)).toBe('scene');
  if (success) for (let n = 0; n < (before.operation === 'tap' ? 3 : 1); n++) {
    await page.clock.fastForward(10); await input.down(start);
    if (distance) await input.move(end);
    await page.clock.fastForward(20); await input.up();
  }
  const pending = await observe(page); expect(pending.mode).toBe('active');
  // Step to the finite cut; never infer success merely from provisional taps.
  for (let n = 0; n < 24 && !['success', 'failure'].includes((await observe(page)).mode); n++) await page.clock.fastForward(100);
  const after = await observe(page); expect(after.mode).toBe(success ? 'success' : 'failure');
  for (let n = 0; n < 4 && (await observe(page)).visible; n++) await page.clock.fastForward(250);
  expect((await observe(page)).visible).toBe(false);
  return { warning, before, pending, after };
}

for (const touch of [false, true]) for (const operation of ['flick', 'swipe', 'tap', 'target']) {
  test(`public build ON ${touch ? 'touch' : 'mouse'} ${operation}: new/V1/V2 → four-operation provider → catch/sale → V2 → ON revisit`, async ({ createContext }, info) => {
    const context = await createContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1000, height: 700 },
      hasTouch: touch, isMobile: touch, deviceScaleFactor: .5 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const save = operation === 'flick' ? historicalSave(1) : operation === 'swipe' ? historicalSave(2) : null;
    const proof = await openPublicBuild(page, save);
    const originalRaw = await page.evaluate(key => localStorage.getItem(key), saveKeys[0]);
    if (save) {
      expect((await latest(page))).toEqual({ storageVersion: 1, generation: 7, data: save });
      expect(await page.evaluate(key => localStorage.getItem(key), saveKeys[1])).toBeNull();
    } else expect(await latest(page)).toBeUndefined();
    const input = await productInput(page, touch), { p, species, lengthCm } = await castAndHook(page, input, operation);
    const successes = operation === 'flick' ? 1 : operation === 'swipe' ? 2 : 3;
    const evidence = [];
    for (let index = 0; index < 3; index++) {
      const warning = await reelUntil(page, input, p, s => s.visible && s.mode === 'warning');
      if (index === 0) expect(warning.operation).toBe(operation);
      evidence.push(await operate(page, input, warning, index < successes));
    }
    await reelUntil(page, input, p, s => s.phase === 'result');
    await expect(page.locator('#catch-species')).toHaveText(species.name);
    await expect(page.locator('#catch-length')).toHaveText(`${lengthCm.toFixed(1)} cm`);
    await page.clock.fastForward(1250);
    const caught = await latest(page), record = caught.data.collection.catches.at(-1);
    expect(record.qteSuccessCount).toBe(successes);
    if (save) {
      expect(caught.generation).toBe(8);
      expect(await page.evaluate(key => localStorage.getItem(key), saveKeys[0])).toBe(originalRaw);
    }
    const price = calculateSalePrice(record), base = calculateSalePrice({ ...record, qteSuccessCount: 0 });
    await expect(page.locator('#catch-sale-price')).toHaveText(`売却価格 ${money(price)}`);
    await expect(page.locator('#catch-qte-bonus')).toHaveText(`QTE成功${successes}回／ボーナス+${money(price - base)}`);
    if (touch) await input.click(page.locator('#sell-catch'));
    else {
      await input.click(page.locator('#close-catch')); await page.clock.fastForward(32);
      await input.click(page.locator('#menu-button')); await input.click(page.locator('[data-view="storage"]'));
      await expect(page.locator('.stored-price')).toHaveText(`売却価格 ${money(price)}`);
      if (operation === 'tap' || operation === 'target') {
        await input.click(page.locator('#sell-all')); await input.click(page.locator('#confirm-sale'));
      } else await input.click(page.locator('.sell-stored'));
      await input.click(page.locator('#collection-close'));
    }
    await page.clock.fastForward(1250);
    const saved = (await latest(page)).data;
    expect(saved.saveVersion).toBe(2);
    expect(saved.collection.catches.at(-1)).toMatchObject({ id: record.id, qteSuccessCount: successes, salePrice: price, disposition: 'sold' });
    expect(saved.collection.wallet).toEqual({ balance: (save ? 777 : 0) + price, lifetimeSales: (save ? 777 : 0) + price });
    if (save) {
      expect(saved.collection.catches[0]).toEqual({ ...save.collection.catches[0], qteSuccessCount: 0 });
      for (const award of save.achievements.unlocked) expect(saved.achievements.unlocked).toContainEqual(award);
    }
    await page.goto('./'); await page.clock.fastForward(32);
    await expect(page.locator('#status')).toBeHidden(); await expect(page.locator('.qte-hud')).toHaveCount(1);
    await expect(page.locator('.qte-hud')).toBeHidden();
    expect(await page.evaluate(() => [typeof window.qteProduct, typeof window.qteFixture])).toEqual(['undefined', 'undefined']);
    expect((await latest(page)).data.collection).toEqual(saved.collection);
    expect((await latest(page)).data.achievements).toEqual(saved.achievements);
    // A second real hook proves restored V2 is still ON, with no live QTE
    // restored from the previous fight. No catch or success state is assigned.
    const revisit = await castAndHook(page, input, operation);
    const nextWarning = await reelUntil(page, input, revisit.p, s => s.visible && s.mode === 'warning');
    expect(nextWarning.operation).toBe(operation); expect(errors).toEqual([]);
    const native = await page.evaluate(() => window.e2eDiagnostics.events.filter(e => e.target === 'scene'));
    expect(native.some(e => e.type === 'pointerdown' && e.trusted && e.pointerType === (touch ? 'touch' : 'mouse'))).toBe(true);
    await info.attach('public-build-on-proof', { body: JSON.stringify({ proof, evidence, native, caught, saved, nextWarning }), contentType: 'application/json' });
  });
}
