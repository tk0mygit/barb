import { test, expect } from './diagnostics-fixture.js';
import { openUIFixture } from './ui-fixture.js';
import { biteFish, landFish, updateFishHUD } from './fish-image-driver.js';
import { makePNG } from '../helpers/png-fixture.js';
import { writeFile } from 'node:fs/promises';

const red = [231, 37, 53, 255], blue = [29, 83, 227, 255];
const artwork = rgba => makePNG({ raw: Buffer.from([0, ...rgba]) });
const profiles = [
  { name: 'PC', viewport: { width: 1000, height: 700 }, touch: false },
  { name: 'touch portrait', viewport: { width: 390, height: 844 }, touch: true },
  { name: 'touch landscape', viewport: { width: 844, height: 390 }, touch: true },
];
function deferred() {
  let resolve;
  return { promise: new Promise(yes => { resolve = yes; }), release: () => resolve() };
}
async function setup(page) {
  await page.addInitScript(() => { Math.random = () => window.imageRoll ?? 0; });
  await openUIFixture(page);
}
async function samplePaint(page, testInfo, name) {
  // Read the browser's composited screenshot, never draw the <img> to infer
  // what was painted. This detects retained pixels even with the correct src.
  const frame = page.locator('#catch-image').locator('..');
  const bytes = await frame.screenshot({ path: testInfo.outputPath(`${name}.png`) });
  return page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let redPixels = 0, bluePixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 231 && data[i + 1] === 37 && data[i + 2] === 53) redPixels++;
      if (data[i] === 29 && data[i + 1] === 83 && data[i + 2] === 227) bluePixels++;
    }
    return { redPixels, bluePixels, width: canvas.width, height: canvas.height };
  }, bytes.toString('base64'));
}
async function watchPaints(context, page) {
  // Ack every delivered compositor frame immediately, including the first
  // transition paint. Screenshots taken only after a wait can miss a 1-frame
  // warm-cache flash, so also inspect this stream at everyNthFrame: 1.
  await page.screenshot();
  const cdp = await context.newCDPSession(page), captures = [];
  const listener = event => {
    captures.push(event.data);
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
  };
  cdp.on('Page.screencastFrame', listener);
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  return async () => {
    await cdp.send('Page.stopScreencast'); cdp.off('Page.screencastFrame', listener);
    return page.evaluate(async captures => {
      const frames = [];
      for (const base64 of captures) {
        const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let oldPixels = 0, targetPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] === 231 && pixels[i + 1] === 37 && pixels[i + 2] === 53) oldPixels++;
          if (pixels[i] === 29 && pixels[i + 1] === 83 && pixels[i + 2] === 227) targetPixels++;
        }
        frames.push({ oldPixels, targetPixels });
      }
      return frames;
    }, captures);
  };
}
async function seedAllFish(page) {
  await page.evaluate(async () => {
    const { FISH_SPECIES, calculateFishWeightKg } = await import('/barb/src/game/fish-species.js');
    for (const fish of FISH_SPECIES) {
      const lengthCm = fish.weight.referenceLengthCm;
      fixture.collection.register({ schemaVersion: 1, id: `seed-${fish.id}`, speciesId: fish.id,
        lengthCm, weightKg: calculateFishWeightKg(fish.id, lengthCm), caughtAt: '2026-01-01T00:00:00Z' });
      fixture.collection.store(`seed-${fish.id}`);
    }
  });
}

for (const { name, viewport, touch } of profiles) {
  test(`${name}: painted old-fish frames stay zero during cold delay, warm and same-species results`, async ({ createContext }, testInfo) => {
    const context = await createContext({ viewport, isMobile: touch, hasTouch: touch });
    const page = await context.newPage(); await setup(page);
    const gate = deferred(), frames = [];
    const requests = [];
    await page.route('**/barb/src/assets/fish/*.png', async route => {
      const bass = route.request().url().endsWith('/black-bass.png'); requests.push(route.request().url());
      if (!bass) await gate.promise;
      await route.fulfill({ body: artwork(bass ? red : blue), contentType: 'image/png' });
    });
    const click = locator => touch ? locator.tap() : locator.click();
    expect((await biteFish(page)).phase).toBe('bite');
    // Repeated frame updates must not create repeated prefetches.
    for (let i = 0; i < 10; i++) await updateFishHUD(page);
    expect((await landFish(page)).phase).toBe('result');
    await expect(page.locator('#catch-image')).toBeVisible();
    expect((await samplePaint(page, testInfo, 'previous-bass')).redPixels).toBeGreaterThan(100);
    const size = await page.locator('#catch-image').locator('..').boundingBox();
    await click(page.locator('#close-catch'));
    const finishColdStream = await watchPaints(context, page);
    await biteFish(page, 'bluegill'); const next = await landFish(page);
    await expect(page.locator('#catch-dialog')).toBeVisible();
    await expect(page.locator('#catch-species')).toHaveText('ブルーギル');
    await expect(page.locator('#catch-image-status')).toHaveText('画像を読み込み中…');
    await expect(page.locator('#catch-image')).toBeHidden();
    const pendingSize = await page.locator('#catch-image').locator('..').boundingBox();
    expect([pendingSize.width, pendingSize.height]).toEqual([size.width, size.height]);
    // Explicit successive paint samples under an unresolved network gate.
    for (let i = 0; i < 8; i++) {
      const sample = await samplePaint(page, testInfo, `pending-${i}`); frames.push(sample);
      expect(sample.redPixels).toBe(0); expect(sample.bluePixels).toBe(0);
    }
    gate.release(); await expect(page.locator('#catch-image')).toBeVisible();
    const decoded = await samplePaint(page, testInfo, 'decoded-bluegill');
    expect(decoded.redPixels).toBe(0); expect(decoded.bluePixels).toBeGreaterThan(100); frames.push(decoded);
    const coldStream = await finishColdStream();
    expect(coldStream.length).toBeGreaterThan(0);
    expect(coldStream.every(frame => frame.oldPixels === 0)).toBe(true);
    expect(coldStream.some(frame => frame.targetPixels > 100)).toBe(true);
    for (let i = 0; i < 2; i++) {
      await click(page.locator('#close-catch'));
      await biteFish(page, i ? 'black-bass' : 'bluegill');
      const caught = await landFish(page); expect(caught.catchId).not.toBe(next.catchId);
      await expect(page.locator('#catch-image')).toBeVisible();
      const sample = await samplePaint(page, testInfo, `warm-${i}`);
      expect(i ? sample.redPixels : sample.bluePixels).toBeGreaterThan(100);
      expect(i ? sample.bluePixels : sample.redPixels).toBe(0);
    }
    await click(page.locator('#close-catch'));
    const finishWarmStream = await watchPaints(context, page);
    await biteFish(page, 'bluegill'); await landFish(page);
    await expect(page.locator('#catch-image')).toBeVisible();
    expect((await samplePaint(page, testInfo, 'warm-different-bluegill')).bluePixels).toBeGreaterThan(100);
    const warmStream = await finishWarmStream();
    expect(warmStream.length).toBeGreaterThan(0);
    expect(warmStream.every(frame => frame.oldPixels === 0)).toBe(true);
    expect(warmStream.some(frame => frame.targetPixels > 100)).toBe(true);
    expect(requests.filter(url => url.endsWith('/black-bass.png'))).toHaveLength(1);
    expect(requests.filter(url => url.endsWith('/bluegill.png'))).toHaveLength(1);
    const evidence = { viewport, frames, coldStream, warmStream,
      observedOldFishFrames: frames.filter(frame => frame.redPixels > 0).length,
      scope: 'composited PNG samples and every delivered CDP compositor frame, with immediate ACK; held cold request and warm transition; CDP may drop frames, not real-device frame coverage' };
    const path = testInfo.outputPath('painted-frame-evidence.json');
    await writeFile(path, JSON.stringify(evidence, null, 2));
    await testInfo.attach('painted-frame-evidence', { path, contentType: 'application/json' });
  });
}

test('pending images cannot resurrect after button/Esc/native close, sale, inactivity or a newer catch', async ({ page }, testInfo) => {
  await setup(page);
  for (const [index, action] of ['button', 'Escape', 'native', 'sale', 'inactive'].entries()) {
    const gate = deferred();
    const species = ['bluegill', 'rainbow-trout', 'catfish', 'iwana', 'walleye'][index];
    await page.route(`**/barb/src/assets/fish/${species}.png`, async route => {
      await gate.promise; await route.fulfill({ body: artwork(blue), contentType: 'image/png' });
    });
    await page.route('**/barb/src/assets/fish/black-bass.png', route => route.fulfill({ body: artwork(red), contentType: 'image/png' }));
    await biteFish(page, species); const old = await landFish(page);
    await expect(page.locator('#catch-image-status')).toBeVisible();
    if (action === 'button') await page.locator('#close-catch').click();
    if (action === 'Escape') await page.keyboard.press('Escape');
    if (action === 'native') await page.locator('#catch-dialog').evaluate(dialog => dialog.close());
    if (action === 'sale') await page.locator('#sell-catch').click();
    if (action === 'inactive') await updateFishHUD(page, false);
    await updateFishHUD(page);
    await expect(page.locator('#catch-dialog')).toBeHidden();
    await biteFish(page); const fresh = await landFish(page); expect(fresh.catchId).not.toBe(old.catchId);
    await expect(page.locator('#catch-image')).toBeVisible();
    const response = page.waitForResponse(response => response.url().endsWith(`/${species}.png`));
    gate.release(); await response;
    // Flush old fetch+decode completion, then sample the actual new frame.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const sample = await samplePaint(page, testInfo, `late-${action}`);
    expect(sample.redPixels).toBeGreaterThan(100); expect(sample.bluePixels).toBe(0);
    expect(await page.evaluate(id => fixture.collection.catches.find(record => record.id === id).disposition, old.catchId))
      .toBe(action === 'sale' ? 'sold' : 'stored');
    await page.locator('#close-catch').click();
  }
});

test('decode gate and errors keep placeholder dimensions; retry, sale and progress still work', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      await decode.call(this);
      if (this.src.endsWith('/bluegill.png')) await new Promise(resolve => { window.releaseDecode = resolve; });
    };
  });
  await setup(page);
  let fail = true;
  await page.route('**/barb/src/assets/fish/*.png', route => {
    if (route.request().url().endsWith('/catfish.png') && fail) return route.abort('failed');
    return route.fulfill({ body: artwork(blue), contentType: 'image/png' });
  });
  await biteFish(page, 'bluegill'); await landFish(page);
  await page.waitForFunction(() => Boolean(window.releaseDecode));
  await expect(page.locator('#catch-image-status')).toHaveText('画像を読み込み中…');
  const before = await page.locator('#catch-image').locator('..').boundingBox();
  expect((await samplePaint(page, testInfo, 'decode-pending')).bluePixels).toBe(0);
  await page.evaluate(() => window.releaseDecode()); await expect(page.locator('#catch-image')).toBeVisible();
  expect(await page.locator('#catch-image').locator('..').boundingBox()).toEqual(before);
  await page.locator('#close-catch').click();
  await biteFish(page, 'catfish'); await landFish(page);
  await expect(page.locator('#catch-image-status')).toHaveText('画像を表示できません');
  await expect(page.locator('#catch-image')).toBeHidden();
  const sample = await samplePaint(page, testInfo, 'fetch-failed'); expect(sample.bluePixels).toBe(0);
  await page.locator('#sell-catch').click(); await expect(page.locator('#catch-dialog')).toBeHidden();
  expect(await page.evaluate(() => fixture.collection.wallet.balance)).toBeGreaterThan(0);
  fail = false; await biteFish(page, 'catfish'); await landFish(page);
  await expect(page.locator('#catch-image')).toBeVisible();
  expect((await samplePaint(page, testInfo, 'retry-success')).bluePixels).toBeGreaterThan(100);
});

test('a missed hook invalidates the pending encounter without showing a result or blocking the next catch', async ({ page }, testInfo) => {
  await setup(page);
  const gate = deferred();
  await page.route('**/barb/src/assets/fish/bluegill.png', async route => {
    await gate.promise; await route.fulfill({ body: artwork(blue), contentType: 'image/png' });
  });
  await page.route('**/barb/src/assets/fish/black-bass.png', route => route.fulfill({ body: artwork(red), contentType: 'image/png' }));
  await biteFish(page, 'bluegill');
  await page.evaluate(() => fixture.fishing.step(1.1)); await updateFishHUD(page);
  await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'failed');
  await expect(page.locator('#catch-dialog')).toBeHidden();
  const response = page.waitForResponse(response => response.url().endsWith('/bluegill.png'));
  gate.release(); await response;
  await page.evaluate(() => fixture.fishing.step(2)); await updateFishHUD(page);
  await biteFish(page); await landFish(page); await expect(page.locator('#catch-image')).toBeVisible();
  const pixels = await samplePaint(page, testInfo, 'after-missed-hook');
  expect(pixels.redPixels).toBeGreaterThan(100); expect(pixels.bluePixels).toBe(0);
  expect(await page.evaluate(() => fixture.collection.catches.length)).toBe(1);
});

for (const { name, viewport, touch } of profiles) for (const view of ['encyclopedia', 'storage']) {
  test(`${name}: ${view} prioritizes visible frames and bounds concurrency; scrolling and detail load`, async ({ createContext }) => {
    const context = await createContext({ viewport, isMobile: touch, hasTouch: touch });
    const page = await context.newPage(); await setup(page); await seedAllFish(page);
    const first = deferred(), rest = deferred(), requests = [];
    await page.route('**/barb/src/assets/fish/*.png', async route => {
      requests.push(route.request().url());
      await (requests.length === 1 ? first.promise : rest.promise);
      await route.fulfill({ body: artwork(blue), contentType: 'image/png' });
    });
    const click = locator => touch ? locator.tap() : locator.click();
    await click(page.locator('#menu-button')); await click(page.locator(`[data-view="${view}"]`));
    const images = page.locator('#collection-content img');
    await expect.poll(() => requests.length).toBe(1);
    const initial = await images.evaluateAll(nodes => {
      const root = document.querySelector('#collection-content').getBoundingClientRect();
      return nodes.map(image => {
        const box = image.getBoundingClientRect();
        return { visible: box.bottom > root.top && box.top < root.bottom, src: image.getAttribute('src'), loading: image.loading, priority: image.fetchPriority };
      });
    });
    expect(initial[0]).toMatchObject({ visible: true, loading: 'eager', priority: 'high' });
    expect(initial.filter(image => image.src)).toHaveLength(1);
    for (const image of initial.slice(1)) { expect(image.src).toBeNull(); expect(image.loading).toBe('lazy'); }
    const visibleCount = initial.filter(image => image.visible).length;
    first.release();
    await expect.poll(() => requests.length).toBe(1 + Math.min(2, visibleCount - 1));
    const secondWave = await images.evaluateAll(nodes => nodes.map(image => ({ src: image.getAttribute('src'), loading: image.loading })));
    for (const [index, image] of secondWave.entries()) {
      if (image.src) { expect(initial[index].visible).toBe(true); expect(image.loading).toBe('eager'); }
      else expect(image.loading).toBe('lazy');
    }
    rest.release();
    await images.last().scrollIntoViewIfNeeded();
    await expect(images.last()).toHaveAttribute('src', /.+/);
    await images.last().evaluate(image => image.decode());
    if (view === 'encyclopedia') {
      await click(page.locator('button.fish-card').last());
      await expect(page.locator('.fish-detail img')).toHaveAttribute('loading', 'eager');
      await expect(page.locator('.fish-detail img')).toHaveAttribute('fetchpriority', 'high');
      await page.locator('.fish-detail img').evaluate(image => image.decode());
    }
  });
}
